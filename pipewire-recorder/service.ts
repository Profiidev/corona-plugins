import {
  type Call,
  type Value,
  fail,
  onCall,
  reply,
  setState
} from 'corona/plugin';
import { notify } from 'corona/notifications';
import { pickFiles } from 'corona/desktop';
import { closePanel, openPanel } from 'corona/surface';
import { get, onChange, set } from 'corona/settings';
import process, { type ChildProcess } from 'process';
import type { Context } from 'corona/kit';
import {
  type RecorderSnapshot,
  applyEvent,
  formatClock,
  initialSnapshot,
  parseEvent
} from './protocol.ts';
import { isObject } from './state.ts';

type Args = Record<string, Value>;

let current: RecorderSnapshot = initialSnapshot();
let child: ChildProcess | null = null;
let restartRequested = false;
let wakeRunner: () => void = () => {};

async function nextWake(): Promise<void> {
  return new Promise((resolve) => {
    wakeRunner = resolve;
  });
}

function publish(next: RecorderSnapshot): void {
  current = next;
  setState('recorder', current);
}

const methods: Record<string, (args: Args) => Promise<string | null>> = {
  getRecent: async ({ limit }) => {
    const n = typeof limit === 'number' && limit > 0 ? Math.round(limit) : 20;
    await sendCommand({ cmd: 'get_recent', limit: n });
    return null;
  },
  pickOutputDir: async () => {
    closePanel('main');
    const picked = await pickFiles({
      acceptLabel: 'Save recordings here',
      directory: true
    });
    openPanel('main');
    if (picked === null) {
      return null;
    }
    const [dir] = picked;
    if (!dir) {
      return null;
    }
    set('outputDir', dir);
    triggerRestart();
    return `Output folder: ${dir}`;
  },
  refreshStreams: async () => {
    await sendCommand({ cmd: 'list_streams' });
    return null;
  },
  restart: async () => {
    triggerRestart();
    return 'Restarting recorder…';
  },
  setEnabled: async ({ enabled }) => {
    const on = enabled === true;
    await sendCommand({ cmd: 'set_enabled', enabled: on });
    return on ? 'Recording resumed' : 'Recording paused';
  },
  setNotifyOnSave: async ({ enabled }) => {
    const on = enabled === true;
    set('notifyOnSave', on);
    return on ? 'Save notifications enabled' : 'Save notifications disabled';
  },
  setTarget: async ({ mprisPlayer, pipewireTarget }) => {
    const player = String(mprisPlayer ?? '').trim();
    const target = String(pipewireTarget ?? '').trim();
    if (!player || !target) {
      throw new Error('MPRIS player and PipeWire target must not be empty');
    }
    set('mprisPlayer', player);
    set('pipewireTarget', target);
    await sendCommand({
      cmd: 'set_target',
      mpris_player: player,
      pipewire_target: target
    });
    return `Target: ${player} / ${target}`;
  },
  setVirtualSink: async ({ enabled }) => {
    const on = enabled === true;
    set('virtualSink', on);
    await sendCommand({ cmd: 'set_virtual_sink', enabled: on });
    return on
      ? 'Virtual capture sink enabled'
      : 'Virtual capture sink disabled';
  },
  toggle: async () => {
    const next = !current.recording_enabled;
    await sendCommand({ cmd: 'set_enabled', enabled: next });
    return next ? 'Recording resumed' : 'Recording paused';
  },
  verifyIndex: async () => {
    await sendCommand({ cmd: 'verify_index' });
    return 'Verifying recorded index…';
  }
};

export default async function main(cx: Context): Promise<void> {
  publish(readInitialSnapshot());

  onCall((call) => {
    void answer(call);
  });

  onChange((change) => {
    if ('secret' in change) {
      return;
    }
    void applySettingChange(change.key, change.value);
  });

  await runSupervisor(cx);
}

function readInitialSnapshot(): RecorderSnapshot {
  return initialSnapshot({
    enforce_unity_volume: get('enforceUnityVolume'),
    mpris_player: get('mprisPlayer') || 'spotify',
    output_dir: get('outputDir') || '~/Music/Spotify',
    pipewire_target: get('pipewireTarget') || 'spotify',
    recording_enabled: get('autoStart'),
    virtual_sink: get('virtualSink')
  });
}

async function answer({ id, method, args }: Call): Promise<void> {
  const handler = Object.hasOwn(methods, method) ? methods[method] : undefined;
  if (!handler) {
    fail(id, `unknown method ${method}`);
    return;
  }
  try {
    const line = await handler(isObject(args) ? args : {});
    if (line) {
      setState('msg', line);
    }
    reply(id, line);
  } catch (error) {
    const text = message(error);
    setState('msg', `✗ ${text}`);
    fail(id, text);
  }
}

function buildArgs(): string[] {
  const args: string[] = [];
  const outputDir = get('outputDir').trim();
  const mprisPlayer = get('mprisPlayer').trim();
  const pipewireTarget = get('pipewireTarget').trim();
  const virtualSink = get('virtualSink');
  const enforceUnity = get('enforceUnityVolume');
  const autoStart = get('autoStart');

  if (outputDir) {
    args.push('--output-dir', outputDir);
  }
  if (mprisPlayer) {
    args.push('--player', mprisPlayer);
  }
  if (pipewireTarget) {
    args.push('--pipewire-target', pipewireTarget);
  }
  args.push(`--virtual-sink=${virtualSink ? 'true' : 'false'}`);
  args.push(`--enforce-unity-volume=${enforceUnity ? 'true' : 'false'}`);
  args.push('run', '--ipc');
  if (!autoStart) {
    args.push('--paused');
  }
  return args;
}

async function sendCommand(payload: Record<string, Value>): Promise<void> {
  if (!child) {
    throw new Error('pipewire-recorder is not running');
  }
  await child.write(`${JSON.stringify(payload)}\n`);
}

function triggerRestart(): void {
  restartRequested = true;
  if (child) {
    const running = child;
    void running
      .write('{"cmd":"shutdown"}\n')
      .catch(() => running.kill('SIGTERM'));
  } else {
    wakeRunner();
  }
}

async function applySettingChange(
  key: string,
  value: boolean | string
): Promise<void> {
  try {
    switch (key) {
      case 'virtualSink': {
        await sendCommand({
          cmd: 'set_virtual_sink',
          enabled: value === true
        });
        break;
      }
      case 'enforceUnityVolume': {
        await sendCommand({
          cmd: 'set_enforce_unity_volume',
          enabled: value === true
        });
        break;
      }
      case 'mprisPlayer':
      case 'pipewireTarget': {
        const player = get('mprisPlayer').trim() || 'spotify';
        const target = get('pipewireTarget').trim() || 'spotify';
        await sendCommand({
          cmd: 'set_target',
          mpris_player: player,
          pipewire_target: target
        });
        break;
      }
      case 'outputDir': {
        triggerRestart();
        break;
      }
      default: {
        break;
      }
    }
  } catch (error) {
    console.warn(
      `pipewire-recorder: applying setting ${key}: ${message(error)}`
    );
  }
}

async function runSupervisor(cx: Context): Promise<void> {
  let backoffMs = 2000;

  while (true) {
    restartRequested = false;
    const wake = nextWake();
    publish({
      ...current,
      capturing: false,
      daemon: 'starting',
      error: null
    });

    let lastStderr: string | null = null;
    try {
      const proc = process.spawn('pipewire-recorder', buildArgs());
      child = proc;

      const stderrLoop = (async () => {
        for (
          let line = await proc.readErrLine();
          line !== null;
          line = await proc.readErrLine()
        ) {
          const clean = line.trim();
          if (clean) {
            lastStderr = clean;
          }
        }
      })();

      for (
        let line = await proc.readLine();
        line !== null;
        line = await proc.readLine()
      ) {
        const event = parseEvent(line);
        if (!event) {
          continue;
        }
        backoffMs = 2000;
        handleEvent(event);
      }

      await stderrLoop;
      const status = await proc.wait();
      if (child === proc) {
        child = null;
      }

      if (restartRequested) {
        continue;
      }

      const detail =
        lastStderr ||
        (status.code !== null
          ? `exited with code ${status.code}`
          : `terminated by signal ${status.signal}`);
      publish({
        ...current,
        capturing: false,
        daemon: 'error',
        error: detail
      });
      setState('msg', `✗ ${detail}`);
    } catch (error) {
      child = null;
      const detail = message(error);
      publish({
        ...current,
        capturing: false,
        daemon: 'error',
        error: detail
      });
      setState('msg', `✗ ${detail}`);
    }

    await Promise.race([wake, cx.sleep(backoffMs)]);
    backoffMs = Math.min(backoffMs * 2, 30_000);
  }
}

function handleEvent(event: ReturnType<typeof parseEvent>): void {
  if (!event) {
    return;
  }
  publish(applyEvent(current, event));

  switch (event.type) {
    case 'recent_tracks': {
      setState('recent', event.entries);
      break;
    }
    case 'streams': {
      setState('streams', {
        mpris_players: event.mpris_players,
        pipewire_nodes: event.pipewire_nodes
      });
      break;
    }
    case 'track_saved': {
      const { entry } = event;
      setState('msg', `Saved: ${entry.artist} – ${entry.title}`);
      if (get('notifyOnSave')) {
        void notify({
          body: `${entry.artist} – ${entry.title} (${formatClock(entry.duration_ms)})`,
          icon: 'media-record',
          summary: 'Track saved (FLAC)'
        });
      }
      break;
    }
    case 'index_verified': {
      setState(
        'msg',
        `Index verified: pruned ${event.removed}, ${event.remaining} remaining`
      );
      break;
    }
    case 'error': {
      setState('msg', `✗ ${event.message}`);
      break;
    }
    case 'snapshot':
    default: {
      break;
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
