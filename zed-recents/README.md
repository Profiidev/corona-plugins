# Zed Recents

Launcher command that lists recent Zed projects and opens them. Port of the Vicinae `zed-recents` extension.

## Setup

1. Install `sqlite3` and open a folder in Zed once.
2. Enable the plugin. Search `Zed Recent Projects`, or type `zed ` in the launcher.

## How it works

- The service reads `workspaces` from every `~/.local/share/zed/db/0-*/db.sqlite` (stable, preview, nightly, dev) with the `sqlite3` CLI and merges them by path, newest first.
- Enter opens the project with `zed`, `zeditor` or `zedit` (first in `PATH`), detached with `setsid`. The **Window** setting adds `--new` or `--add`.
- **Remove from recents** deletes the row from every database that has it.
- Multi-folder workspaces show as one entry, as in the Vicinae extension.
