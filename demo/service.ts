import {
  type Call,
  type Value,
  fail,
  getState,
  onCall,
  reply,
  setState
} from 'corona/plugin';
import { notify, onAction } from 'corona/notifications';
import {
  type Rule,
  call as dbusCall,
  getProperty,
  nameHasOwner,
  subscribe
} from 'corona/dbus';
import * as secrets from 'corona/secrets';
import { open, readFile } from 'fs/promises';
import {
  type Redirect,
  listenRedirect,
  onRedirect,
  openUri,
  pickFiles
} from 'corona/desktop';
import { onSleep } from 'corona/power';
import { closePanel, openPanel } from 'corona/surface';
import { get, set, setOptions } from 'corona/settings';
import { t } from 'corona/i18n';
import process, { type ChildProcess } from 'process';
import { type Socket, connect } from 'net';
import { Buffer } from 'buffer';
import type { Context } from 'corona/kit';
import { message } from './util.ts';

const KDECONNECT = 'org.kde.kdeconnect';
const TAILSCALE = '/run/tailscale/tailscaled.sock';
const TEST_URL = 'https://example.com/';

/** What `call(method)` in a view and `corona ipc plugin demo <method>` reach */
const methods: Record<string, (args: Value) => Promise<Value>> = {
  dbus,
  fetch: fetchBoth,
  files,
  ipnBus,
  notify: notifyAndWait,
  oauth,
  pick,
  ping,
  richNotify,
  secret,
  secretSetting,
  settings,
  spawn,
  stdin,
  tailscale,
  time,
  unixFetch
};

/** What the dynamic `favorite` select offers, set by the service at start */
const FAVORITES = [
  { label: 'None', value: 'none' },
  { label: 'Tea', value: 'tea' },
  { label: 'Coffee', value: 'coffee' },
  { label: 'Water', value: 'water' }
];

/** What a service's `cx` has: `sleep` and `timer` */
export default async function main(
  cx: Pick<Context, 'sleep' | 'timer'>
): Promise<void> {
  let beats = 0;
  cx.timer.every(1000, () => {
    if (get('heartbeat')) {
      beats += 1;
      setState('heartbeat', beats);
    }
  });
  // KDE Connect only emits custom signals (battery, reachability, ...)
  void watch({
    bus: 'session',
    pathNamespace: '/modules/kdeconnect',
    sender: KDECONNECT
  });
  try {
    setOptions('favorite', FAVORITES);
  } catch (error) {
    console.warn(`demo: setOptions: ${message(error)}`);
  }
  onSleep(sleepEvent);
  // Not awaited: `notify` waits for a click while other calls go on
  onCall((call) => void answer(call));
}

async function answer({ id, method, args }: Call): Promise<void> {
  const handler = Object.hasOwn(methods, method) ? methods[method] : undefined;
  if (!handler) {
    fail(id, t('error.unknown', { method }));
    return;
  }
  try {
    reply(id, await handler(args));
  } catch (error) {
    fail(id, message(error));
  }
}

/** Pushes what `rule` matches into state `signals`, newest first */
async function watch(rule: Rule): Promise<void> {
  try {
    await subscribe(rule, (signal) => {
      const seen = getState('signals');
      const line = `${signal.member} ${JSON.stringify(signal.args)}`;
      setState(
        'signals',
        [line, ...(Array.isArray(seen) ? seen : [])].slice(0, 8)
      );
    });
  } catch (error) {
    console.warn(`demo: watching ${rule.sender}: ${message(error)}`);
  }
}

async function ping(): Promise<Value> {
  return {
    at: new Date().toISOString(),
    greeting: get('greeting'),
    pong: true
  };
}

/** `date` resolved through the granted PATH */
async function time(): Promise<Value> {
  const out = await process.run('date', ['+%F %T %Z']);
  if (out.code !== 0) {
    throw new Error(out.stderr.trim() || `date exited ${out.code}`);
  }
  return out.stdout.trim();
}

let child: ChildProcess | null = null;

/** A short `sh` loop whose lines stream into state `spawn` */
async function spawn(): Promise<Value> {
  if (child) {
    throw new Error(t('error.running'));
  }
  const script =
    'echo "HOME=$HOME"; for i in 1 2 3 4 5; do echo "line $i"; sleep 1; done; echo bye >&2; exit 3';
  const running = process.spawn('sh', ['-c', script]);
  child = running;
  const lines: string[] = [];
  const publish = (exit: Value, stderr: string | null) =>
    setState('spawn', { exit, lines: [...lines], pid: running.pid, stderr });
  publish(null, null);
  void (async () => {
    try {
      for (
        let line = await running.readLine();
        line !== null;
        line = await running.readLine()
      ) {
        lines.push(line);
        publish(null, null);
      }
      const stderr = await running.readErrLine();
      const status = await running.wait();
      publish(status.code ?? `signal ${status.signal}`, stderr);
    } finally {
      child = null;
    }
  })();
  return { pid: running.pid };
}

/** Answers with the action the user picks; the call times out after 30 s, the state still follows */
async function notifyAndWait(): Promise<Value> {
  const id = await notify({
    actions: [
      { key: 'default', label: t('notify.open') },
      { key: 'yes', label: t('notify.yes') },
      { key: 'no', label: t('notify.no') }
    ],
    body: t('notify.body', { greeting: get('greeting') }),
    icon: 'dialog-information',
    summary: t('notify.summary'),
    urgency: get('urgency')
  });
  return waitForAction(id);
}

/** The first action picked, or reply typed, on notification `id`, also kept in state `action` */
async function waitForAction(id: number): Promise<Value> {
  setState('action', t('notify.waiting', { id }));
  return new Promise((resolve) => {
    // Every listener gets every action of the plugin's notifications
    const stop = onAction((action) => {
      if (action.id !== id) {
        return;
      }
      stop();
      const picked =
        action.text === null || action.text === undefined
          ? action.key
          : `${action.key}: ${action.text}`;
      setState('action', t('notify.picked', { id, key: picked }));
      resolve({ id, key: action.key, text: action.text ?? null });
    });
  });
}

async function dbus(): Promise<Value> {
  const kdeconnect = await nameHasOwner('session', KDECONNECT);
  let devices: Value = null;
  if (kdeconnect) {
    // `devices` is a Qt overload (0, 1 and 2 args): no signature, so the 2-argument one is picked by arity
    const ids = await dbusCall({
      args: [false, false],
      bus: 'session',
      dest: KDECONNECT,
      iface: 'org.kde.kdeconnect.daemon',
      method: 'devices',
      path: '/modules/kdeconnect'
    });
    const list = Array.isArray(ids) ? ids.map(String) : [];
    devices = await Promise.all(
      list.map(async (device) => ({
        id: device,
        name: await getProperty({
          bus: 'session',
          dest: KDECONNECT,
          iface: 'org.kde.kdeconnect.device',
          name: 'name',
          path: `/modules/kdeconnect/devices/${device}`
        })
      }))
    );
  }
  return { devices, kdeconnect };
}

type TailscaleStatus = {
  BackendState?: string;
  Self?: { HostName?: string; TailscaleIPs?: string[] };
  Peer?: Record<string, unknown>;
};

/** LocalAPI over the daemon's unix socket; HTTP/1.0 so the body ends at EOF, unchunked */
async function tailscale(): Promise<Value> {
  let socket: Socket | null = null;
  try {
    socket = await connect({ path: TAILSCALE });
  } catch (error) {
    return { available: false, error: message(error) };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    // Bytes, not a string: `write` takes a Uint8Array too
    const request =
      'GET /localapi/v0/status HTTP/1.0\r\nHost: local-tailscaled.sock\r\n\r\n';
    await socket.write(new Uint8Array(Buffer.from(request)));
    for (
      let chunk = await socket.read();
      chunk !== null && size < 4 << 20;
      chunk = await socket.read()
    ) {
      chunks.push(chunk);
      size += chunk.length;
    }
  } finally {
    socket.close();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const text = Buffer.from(bytes).toString('utf8');
  const split = text.indexOf('\r\n\r\n');
  const statusLine = text.slice(0, text.indexOf('\r\n'));
  const body = split === -1 ? '' : text.slice(split + 4);
  if (!/ 200 /.test(statusLine)) {
    // 403 without operator rights: `tailscale set --operator=$USER`
    return { available: true, body: body.slice(0, 300), status: statusLine };
  }
  const status: TailscaleStatus = JSON.parse(body);
  return {
    available: true,
    backend: status.BackendState ?? null,
    host: status.Self?.HostName ?? null,
    ips: status.Self?.TailscaleIPs ?? [],
    peers: Object.keys(status.Peer ?? {}).length,
    status: statusLine
  };
}

/** Once buffered, once streamed chunk by chunk */
async function fetchBoth(): Promise<Value> {
  const response = await fetch(TEST_URL, { timeout: 10_000 });
  const bytes = (await response.arrayBuffer()).byteLength;

  const stream = await fetch(TEST_URL, { stream: true, timeout: 10_000 });
  let chunks = 0;
  let streamed = 0;
  try {
    for (
      let chunk = await stream.read();
      chunk !== null;
      chunk = await stream.read()
    ) {
      chunks += 1;
      streamed += chunk.length;
    }
  } finally {
    stream.close();
  }
  return {
    bytes,
    chunks,
    status: response.status,
    streamStatus: stream.status,
    streamed
  };
}

/** A round trip through the user's keyring */
async function secret(): Promise<Value> {
  const key = 'demo-token';
  const value = `token-${Date.now()}`;
  await secrets.set(key, value);
  const read = await secrets.get(key);
  await secrets.remove(key);
  const afterRemove = await secrets.get(key);
  return { afterRemove, matches: read === value, read, stored: value };
}

/**
 * The file picker is a normal window, below the panel's overlay layer, and a
 * panel's view (with its pending promises) is gone once it closes. So the
 * service picks: it closes the panel, waits for the dialog, keeps the paths in
 * the shared state and opens the panel again.
 */
async function pick(): Promise<Value> {
  closePanel('main');
  try {
    const picked = await pickFiles({
      acceptLabel: t('panel.pick'),
      multiple: true
    });
    // `null` when cancelled: keep the last pick
    if (picked) {
      setState('picked', picked);
    }
    return picked;
  } finally {
    openPanel('main');
  }
}

/** Pushes each suspend and resume into state `sleep` */
function sleepEvent(event: { sleeping: boolean }): void {
  setState(
    'sleep',
    `${event.sleeping ? 'suspending' : 'resumed'} at ${new Date().toLocaleTimeString()}`
  );
}

/** Markup, a picture and an inline reply; answers with the click or the typed text */
async function richNotify(): Promise<Value> {
  const id = await notify({
    actions: [{ key: 'open', label: t('notify.open') }],
    body: t('notify.rich_body'),
    // The PNG through the `fs.read` grant, sent as the notification's picture
    image: await readFile('assets/gradient.png'),
    reply: { placeholder: t('notify.reply_placeholder') },
    summary: t('notify.rich_summary'),
    timeout: 30_000
  });
  return waitForAction(id);
}

/** `closeStdin` ends the child's input after the queued writes */
async function stdin(): Promise<Value> {
  const script =
    'n=0; while read l; do n=$((n+1)); echo "got $l"; done; echo "eof after $n lines"';
  const child = process.spawn('sh', ['-c', script]);
  await child.write('first\n');
  await child.write(new Uint8Array(Buffer.from('second\n')));
  await child.closeStdin();
  const lines: string[] = [];
  for (
    let line = await child.readLine();
    line !== null;
    line = await child.readLine()
  ) {
    lines.push(line);
  }
  const status = await child.wait();
  return { code: status.code, lines };
}

/** A file handle in the data dir: write, append, then read back in 4-byte pieces */
async function files(): Promise<Value> {
  const path = 'demo-file.bin';
  let file = await open(path, 'w');
  await file.write('hello ');
  await file.write(new Uint8Array([0, 1, 2, 255]));
  await file.close();
  file = await open(path, 'a');
  await file.write(' appended');
  await file.close();
  // `r+` opens through the write grant, so the relative path lands in `${dataDir}` like the writes
  file = await open(path, 'r+');
  const pieces: number[] = [];
  const all: number[] = [];
  try {
    for (
      let chunk = await file.read(4);
      chunk !== null;
      chunk = await file.read(4)
    ) {
      pieces.push(chunk.length);
      all.push(...chunk);
    }
  } finally {
    await file.close();
  }
  return {
    bytes: all.length,
    pieces: pieces.length,
    text: Buffer.from(all).toString('utf8')
  };
}

/** The same LocalAPI as `tailscale`, but `fetch` speaks HTTP over the unix socket */
async function unixFetch(): Promise<Value> {
  const response = await fetch(
    'http://local-tailscaled.sock/localapi/v0/status?peers=false',
    {
      timeout: 5000,
      unix: TAILSCALE
    }
  );
  const text = await response.text();
  if (!response.ok) {
    return { body: text.slice(0, 300), status: response.status };
  }
  const status: TailscaleStatus = JSON.parse(text);
  return {
    backend: status.BackendState ?? null,
    host: status.Self?.HostName ?? null,
    status: response.status
  };
}

/** The first line of the long-lived `watch-ipn-bus` NDJSON stream (mask 2: initial state) */
async function ipnBus(): Promise<Value> {
  const stream = await fetch(
    'http://local-tailscaled.sock/localapi/v0/watch-ipn-bus?mask=2',
    {
      stream: true,
      timeout: 5000,
      unix: TAILSCALE
    }
  );
  const bytes: number[] = [];
  try {
    while (!bytes.includes(10)) {
      const chunk = await stream.read();
      if (chunk === null) {
        break;
      }
      bytes.push(...chunk);
    }
  } finally {
    stream.close();
  }
  const [line] = Buffer.from(bytes).toString('utf8').split('\n');
  if (stream.status !== 200) {
    return { body: line.slice(0, 300), status: stream.status };
  }
  const notify: { State?: number } = JSON.parse(line);
  return { state: notify.State ?? null, status: stream.status };
}

/** Steps the dynamic `favorite` select through the options the service set */
async function settings(): Promise<Value> {
  const before = get('favorite');
  const index = FAVORITES.findIndex((option) => option.value === before);
  const after = FAVORITES[(index + 1) % FAVORITES.length].value;
  set('favorite', after);
  // The write lands after this render, so `get` still answers `before` here
  return { after, before };
}

/** The `token` secret setting, entered in corona's settings app */
async function secretSetting(): Promise<Value> {
  const token = await secrets.get('token');
  // Never echo the secret itself
  return token === null ? { set: false } : { length: token.length, set: true };
}

/** A loopback OAuth-style redirect: the browser is sent to our own listener */
async function oauth(): Promise<Value> {
  const listening = listenRedirect({ timeoutMs: 60_000 });
  // Registered before the browser opens: the callback runs once, redirect or failure
  const redirect = new Promise<Redirect>((resolve, reject) =>
    onRedirect(listening.id, (event) =>
      'message' in event ? reject(new Error(event.message)) : resolve(event)
    )
  );
  openUri(
    `${listening.redirectUri}callback?code=demo-${Date.now()}&state=a%20b`
  );
  return { port: listening.port, ...(await redirect) };
}
