import { type Value, getState } from 'corona/plugin';
import type {
  RecordedEntry,
  RecorderSnapshot,
  StreamsInfo
} from './protocol.ts';

export function isObject(value: Value): value is Record<string, Value> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSnapshot(value: Value): value is RecorderSnapshot {
  return (
    isObject(value) &&
    typeof value.daemon === 'string' &&
    typeof value.recording_enabled === 'boolean' &&
    isObject(value.virtual_sink)
  );
}

function isRecordedEntries(value: Value): value is RecordedEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isObject(entry) &&
        typeof entry.title === 'string' &&
        typeof entry.artist === 'string' &&
        typeof entry.file_path === 'string'
    )
  );
}

function isStreamsInfo(value: Value): value is StreamsInfo {
  return (
    isObject(value) &&
    Array.isArray(value.mpris_players) &&
    Array.isArray(value.pipewire_nodes)
  );
}

/** State `recorder`, null before the service's first publish */
export function snapshot(): RecorderSnapshot | null {
  const value = getState('recorder');
  return isSnapshot(value) ? value : null;
}

/** State `recent`, newest recorded tracks first */
export function recentTracks(): RecordedEntry[] {
  const value = getState('recent');
  return isRecordedEntries(value) ? value : [];
}

/** State `streams`, last discovered MPRIS players & PipeWire output streams */
export function streams(): StreamsInfo | null {
  const value = getState('streams');
  return isStreamsInfo(value) ? value : null;
}

/** State `msg`, feedback line from the last action or error */
export function message(): string | null {
  const value = getState('msg');
  return typeof value === 'string' ? value : null;
}
