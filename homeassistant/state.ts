import { type Value, getState } from 'corona/plugin';
import type { Listed, Snapshot } from './service.ts';

export function isObject(value: Value): value is Record<string, Value> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSnapshot(value: Value): value is Snapshot {
  return isObject(value) && 'status' in value;
}

export function isListed(value: Value): value is Listed[] {
  return (
    Array.isArray(value) &&
    value.every((item) => isObject(item) && 'id' in item)
  );
}

/** `value` if it is a list, else empty, for attributes that may be missing */
export function list(value: Value): Value[] {
  return Array.isArray(value) ? value : [];
}

/** State `ha`, null before the service's first publish */
export function snapshot(): Snapshot | null {
  const value = getState('ha');
  return isSnapshot(value) ? value : null;
}

/** State `msg`, the line of the last call */
export function statusLine(): string | null {
  const value = getState('msg');
  return typeof value === 'string' ? value : null;
}
