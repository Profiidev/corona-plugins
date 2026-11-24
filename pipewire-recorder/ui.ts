import {
  Background,
  type Color,
  type Element,
  PathBuilder,
  div
} from 'corona/kit';

export const RECORDING_DOT: Color = '#ef4444';
export const ONLINE_DOT: Color = '#22c55e';
export const WARNING_DOT: Color = '#f59e0b';

/** 16 px Lucide-style disc/record glyph drawn with PathBuilder */
export function recordIcon(
  color: Color,
  recording: boolean,
  size = 16
): Element {
  const k = size / 24;
  let path = PathBuilder.stroke(2 * k)
    .move_to(21 * k, 12 * k)
    .arc_to(9 * k, 9 * k, 0, true, true, 3 * k, 12 * k)
    .arc_to(9 * k, 9 * k, 0, true, true, 21 * k, 12 * k)
    .close();
  const r = recording ? 4 : 2.5;
  path = path
    .move_to((12 + r) * k, 12 * k)
    .arc_to(r * k, r * k, 0, true, true, (12 - r) * k, 12 * k)
    .arc_to(r * k, r * k, 0, true, true, (12 + r) * k, 12 * k)
    .close();
  return window.paint_path(path.build(), color).flex_none().size(size);
}

/** A 6 px status dot */
export function dot(color: Color): Element {
  return div().flex_none().size_1p5().rounded_full().bg(color);
}

/** A translucent background fill of `color` at `alpha` (0..1) */
export function tintedBg(color: Color, alpha: number): Background {
  return Background.solid(color).opacity(alpha);
}
