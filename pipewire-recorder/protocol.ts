/** NDJSON protocol types and pure state helpers for `pipewire-recorder run --ipc`. */

export type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'unknown';
export type TrackStatus = 'recording' | 'paused' | 'skipped' | 'invalidated';
export type DaemonStatus = 'starting' | 'running' | 'stopped' | 'error';

export type PlayerState = {
  bus: string;
  status: PlaybackStatus;
  volume: number | null;
};

export type NodeState = {
  id: number;
  serial: number;
  app_name: string;
  binary_name: string;
  node_name: string;
  media_name: string;
  volume: number | null;
  mute: boolean;
  is_unity: boolean;
};

export type VirtualSinkState = {
  enabled: boolean;
  active: boolean;
  sink_name: string;
  playback_name: string;
  playback_node_name: string;
  routed: boolean;
};

export type TrackState = {
  track_id: string;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  captured_ms: number;
  status: TrackStatus;
  reason: string | null;
};

export type RecordedEntry = {
  track_id: string;
  title: string;
  artist: string;
  album: string;
  file_path: string;
  recorded_at_unix: number;
  duration_ms: number;
};

export type MprisPlayerInfo = {
  bus: string;
  short_name: string;
  status: PlaybackStatus;
  track: string | null;
};

export type StreamsInfo = {
  mpris_players: MprisPlayerInfo[];
  pipewire_nodes: NodeState[];
};

export type RecorderSnapshot = {
  daemon: DaemonStatus;
  error: string | null;
  recording_enabled: boolean;
  capturing: boolean;
  output_dir: string;
  mpris_player: string;
  pipewire_target: string;
  enforce_unity_volume: boolean;
  player: PlayerState | null;
  pw_node: NodeState | null;
  virtual_sink: VirtualSinkState;
  track: TrackState | null;
  index_count: number;
};

export type IpcEvent =
  | ({
      type: 'snapshot';
    } & Omit<RecorderSnapshot, 'daemon' | 'error'>)
  | {
      type: 'track_saved';
      entry: RecordedEntry;
      index_count: number;
    }
  | {
      type: 'recent_tracks';
      entries: RecordedEntry[];
      total: number;
    }
  | {
      type: 'streams';
      mpris_players: MprisPlayerInfo[];
      pipewire_nodes: NodeState[];
    }
  | {
      type: 'index_verified';
      removed: number;
      remaining: number;
    }
  | {
      type: 'error';
      message: string;
    };

export type WidgetVisualState =
  | 'recording'
  | 'ready'
  | 'skipped'
  | 'paused'
  | 'offline';

export function initialSnapshot(defaults?: {
  output_dir?: string;
  mpris_player?: string;
  pipewire_target?: string;
  virtual_sink?: boolean;
  enforce_unity_volume?: boolean;
  recording_enabled?: boolean;
}): RecorderSnapshot {
  return {
    capturing: false,
    daemon: 'starting',
    enforce_unity_volume: defaults?.enforce_unity_volume ?? true,
    error: null,
    index_count: 0,
    mpris_player: defaults?.mpris_player ?? 'spotify',
    output_dir: defaults?.output_dir ?? '~/Music/Spotify',
    pipewire_target: defaults?.pipewire_target ?? 'spotify',
    player: null,
    pw_node: null,
    recording_enabled: defaults?.recording_enabled ?? true,
    track: null,
    virtual_sink: {
      active: false,
      enabled: defaults?.virtual_sink ?? false,
      playback_name: 'PipeWire Recorder Playback',
      playback_node_name: 'pipewire_recorder_capture.playback',
      routed: false,
      sink_name: 'pipewire_recorder_capture'
    }
  };
}

function isIpcEvent(value: unknown): value is IpcEvent {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  switch (value.type) {
    case 'snapshot':
    case 'track_saved':
    case 'recent_tracks':
    case 'streams':
    case 'index_verified':
    case 'error': {
      return true;
    }
    default: {
      return false;
    }
  }
}

export function parseEvent(line: string): IpcEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isIpcEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function applyEvent(
  current: RecorderSnapshot,
  event: IpcEvent
): RecorderSnapshot {
  switch (event.type) {
    case 'snapshot': {
      return {
        capturing: event.capturing,
        daemon: 'running',
        enforce_unity_volume: event.enforce_unity_volume,
        error: null,
        index_count: event.index_count,
        mpris_player: event.mpris_player,
        output_dir: event.output_dir,
        pipewire_target: event.pipewire_target,
        player: event.player,
        pw_node: event.pw_node,
        recording_enabled: event.recording_enabled,
        track: event.track,
        virtual_sink: event.virtual_sink
      };
    }
    case 'track_saved': {
      return {
        ...current,
        index_count: event.index_count
      };
    }
    case 'index_verified': {
      return {
        ...current,
        index_count: event.remaining
      };
    }
    case 'error': {
      return {
        ...current,
        error: event.message
      };
    }
    case 'recent_tracks':
    case 'streams':
    default: {
      return current;
    }
  }
}

export function formatClock(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

/** Converts PipeWire linear channel volume (`0..1`) to cubic UI slider percent (`0..100`), matching Corona's audio mixer & wpctl. */
export function linearToPercent(linear: number): number {
  const clamped = Math.max(0, Math.min(1, linear));
  return Math.round(Math.cbrt(clamped) * 100);
}

/** Converts cubic UI slider percent (`0..100`) to PipeWire linear channel volume (`0..1`). */
export function percentToLinear(percent: number): number {
  const slider = Math.max(0, Math.min(100, percent)) / 100;
  return slider * slider * slider;
}

export function widgetSummary(snap: RecorderSnapshot | null): {
  state: WidgetVisualState;
  tooltip: string;
} {
  if (!snap || snap.daemon === 'starting') {
    return { state: 'offline', tooltip: 'PipeWire Recorder · Starting…' };
  }
  if (snap.daemon === 'error' || snap.daemon === 'stopped') {
    const detail = snap.error ? ` · ${snap.error}` : '';
    return {
      state: 'offline',
      tooltip: `PipeWire Recorder · Offline${detail}`
    };
  }
  if (!snap.recording_enabled) {
    return {
      state: 'paused',
      tooltip: 'PipeWire Recorder · Paused (right-click to resume)'
    };
  }
  const { track } = snap;
  if (track && track.status === 'recording') {
    const progress =
      track.duration_ms > 0
        ? ` (${formatClock(track.captured_ms)} / ${formatClock(track.duration_ms)})`
        : '';
    return {
      state: 'recording',
      tooltip: `Recording · ${track.artist} – ${track.title}${progress}`
    };
  }
  if (track && (track.status === 'skipped' || track.status === 'invalidated')) {
    const label = track.status === 'skipped' ? 'Skipped' : 'Discarded';
    const why = track.reason ? ` (${track.reason})` : '';
    return {
      state: 'skipped',
      tooltip: `${label} · ${track.artist} – ${track.title}${why}`
    };
  }
  if (snap.player) {
    return {
      state: 'ready',
      tooltip: `PipeWire Recorder · Ready (${snap.mpris_player} ${snap.player.status})`
    };
  }
  return {
    state: 'ready',
    tooltip: `PipeWire Recorder · Waiting for ${snap.mpris_player}`
  };
}
