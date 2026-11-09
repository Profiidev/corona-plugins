import { type Reply, type Row, list, onRun } from 'corona/launcher';
import { get } from 'corona/settings';
import path from 'path';
import process from 'process';

type Remote = {
  kind: string;
  host?: string;
  port?: string;
  user?: string;
  name?: string;
};

type Project = {
  path: string;
  opened: number;
  dbs: Set<string>;
  remote?: Remote;
  kind: 'dir' | 'file' | 'missing' | 'remote';
};

const QUERY = `SELECT w.paths, w.timestamp, rc.kind, rc.host, rc.port, rc.user, rc.name
  FROM workspaces w LEFT JOIN remote_connections rc ON w.remote_connection_id = rc.id
  WHERE w.paths IS NOT NULL AND length(w.paths) > 0 ORDER BY w.timestamp DESC;`;

// Children get no HOME (it cannot be granted), so look it up
// The zed binary is called `zed`, `zeditor` or `zedit` depending on the distro
const LAUNCH =
  'for c in zed zeditor zedit; do command -v "$c" >/dev/null && exec setsid -f "$c" "$@"; done; echo "zed not found in PATH" >&2; exit 127';

// 0 = dir, 1 = file, anything else = missing
const CLASSIFY =
  'for p; do if [ -d "$p" ]; then echo d; elif [ -e "$p" ]; then echo f; else echo m; fi; done';

export default async function main(): Promise<void> {
  onRun('recent', async (): Promise<Reply> => {
    try {
      return { push: page(await load()) };
    } catch (error) {
      return {
        toast: {
          kind: 'failure',
          message: error instanceof Error ? error.message : String(error),
          title: 'Zed recents'
        }
      };
    }
  });
}

async function sh(script: string, args: string[] = []) {
  return process.run('sh', ['-c', script, 'sh', ...args]);
}

async function dbPaths(): Promise<string[]> {
  const out = await sh(
    'ls -d "$HOME"/.local/share/zed/db/0-*/db.sqlite 2>/dev/null'
  );
  return out.stdout.split('\n').filter(Boolean);
}

async function load(): Promise<Project[]> {
  const dbs = await dbPaths();
  if (!dbs.length) {
    throw new Error('Zed database not found. Open Zed once first.');
  }
  const seen = new Map<string, Project>();
  for (const db of dbs) {
    const out = await process.run('sqlite3', [
      '-noheader',
      '-separator',
      '|',
      '-batch',
      db,
      QUERY
    ]);
    if (out.code !== 0) {
      continue;
    }
    for (const line of out.stdout.split('\n')) {
      const [path, ts, kind, host, port, user, name] = line.split('|');
      if (!path) {
        continue;
      }
      const opened =
        Date.parse(ts.endsWith('Z') ? ts : `${ts.replace(' ', 'T')}Z`) || 0;
      const known = seen.get(path);
      if (known) {
        known.dbs.add(db);
        known.opened = Math.max(known.opened, opened);
        continue;
      }
      const remote = kind ? { host, kind, name, port, user } : undefined;
      seen.set(path, {
        dbs: new Set([db]),
        kind: remote ? 'remote' : 'missing',
        opened,
        path,
        remote
      });
    }
  }
  const projects = [...seen.values()].toSorted((a, b) => b.opened - a.opened);
  const local = projects.filter((p) => !p.remote);
  if (local.length) {
    const kinds = (
      await sh(
        CLASSIFY,
        local.map((p) => p.path)
      )
    ).stdout.split('\n');
    for (const [i, p] of local.entries()) {
      p.kind = kinds[i] === 'd' ? 'dir' : kinds[i] === 'f' ? 'file' : 'missing';
    }
  }
  return projects;
}

function page(projects: Project[]) {
  const p = list({
    empty: 'No recent projects',
    placeholder: 'Search recent projects',
    rows: [],
    title: 'Zed Recent Projects'
  });
  const rows = () =>
    projects.map((project): Row => ({
      accessories: [
        ...(project.kind === 'missing'
          ? [{ tag: { text: 'Missing', tone: 'off' as const } }]
          : []),
        ...(project.remote ? [{ tag: { text: project.remote.kind } }] : []),
        ...(project.opened ? [{ text: ago(project.opened) }] : [])
      ],
      actions: [
        { run: async () => open(project), title: 'Open in Zed' },
        {
          run: () => ({ copy: { text: project.path } }),
          shortcut: 'ctrl-c',
          title: 'Copy path'
        },
        {
          confirm: {
            button: 'Remove',
            message: 'It stays in Zed until it is opened again.',
            skippable: true,
            title: `Remove "${path.basename(project.path)}"?`
          },
          destructive: true,
          keepOpen: true,
          run: async (): Promise<Reply> => {
            const sql = `DELETE FROM workspaces WHERE paths='${project.path.replace(/'/g, "''")}';`;
            await Promise.all(
              [...project.dbs].map(async (db) =>
                process.run('sqlite3', [db, sql])
              )
            );
            projects.splice(projects.indexOf(project), 1);
            p.setRows(rows());
            return { toast: { title: 'Removed from recents' } };
          },
          shortcut: 'ctrl-x',
          title: 'Remove from recents'
        }
      ],
      icon: { name: project.kind === 'file' ? 'file' : 'folder' },
      id: project.path,
      keywords: project.path.split('/').filter(Boolean).slice(-6),
      subtitle: project.path,
      title: project.remote
        ? `${path.basename(project.path)} [${remoteName(project.remote)}]`
        : path.basename(project.path)
    }));
  p.setRows(rows());
  return p;
}

async function open(project: Project): Promise<Reply> {
  const flag =
    { add: ['--add'], new: ['--new'] }[get('window') as string] ?? [];
  const target = uri(project);
  if (target instanceof Error) {
    return {
      toast: {
        kind: 'failure',
        message: target.message,
        title: 'Cannot open project'
      }
    };
  }
  const out = await sh(LAUNCH, [...flag, target]);
  if (out.code !== 0) {
    return {
      toast: {
        kind: 'failure',
        message: out.stderr.trim() || `exit ${out.code}`,
        title: 'Failed to open project'
      }
    };
  }
  return { hud: { text: `Opened ${path.basename(project.path)}` } };
}

function uri({ path, remote }: Project): string | Error {
  if (!remote) {
    return `file://${encodeURI(path)}`;
  }
  if (!remote.host) {
    return new Error('Remote host is missing');
  }
  const host =
    remote.host.includes(':') && !remote.host.startsWith('[')
      ? `[${remote.host}]`
      : remote.host;
  const auth = remote.user ? `${encodeURIComponent(remote.user)}@` : '';
  return `${remote.kind}://${auth}${host}${remote.port ? `:${remote.port}` : ''}${encodeURI(path)}`;
}

function remoteName({ name, host, user, port, kind }: Remote): string {
  if (name) {
    return name;
  }
  return host
    ? `${user ? `${user}@` : ''}${host}${port ? `:${port}` : ''}`
    : kind;
}

function ago(ms: number): string {
  const m = Math.floor((Date.now() - ms) / 60_000);
  if (m < 1) {
    return 'now';
  }
  if (m < 60) {
    return `${m}m ago`;
  }
  if (m < 1440) {
    return `${Math.floor(m / 60)}h ago`;
  }
  return `${Math.floor(m / 1440)}d ago`;
}
