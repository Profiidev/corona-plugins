# PipeWire Recorder

Corona plugin for [`pipewire-recorder`](https://github.com/jojowaldi/pipewire-recorder) — automatic lossless PipeWire audio stream recording with MPRIS2 metadata, cover art embedding, completeness validation, and deduplication.

## How it works

- Enabling the plugin on Corona's **Plugins** page starts `pipewire-recorder run --ipc` in the background.
- Disabling the plugin terminates the process group cleanly (releasing `pw-record`, `pw-loopback`, and any PipeWire `target.object` routing).
- **Bar widget** (`pipewire-recorder:recorder`): red when actively recording, neutral when ready, dimmed when paused or offline. Left-click opens the panel; right-click pauses/resumes recording.
- **Panel** (`pipewire-recorder:main`): shows the live track, capture progress, skip/discard reason, native `corona/pipewire` listening volume slider when the virtual capture sink is enabled, recent FLAC recordings, and detected MPRIS/PipeWire streams.

## Requirements

- `pipewire-recorder` installed on `PATH` (with `run --ipc` support).
- PipeWire + WirePlumber + `flac`/`metaflac`/`curl` (bundled automatically when built via the Nix flake).
