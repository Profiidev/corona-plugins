import { type Context, type Element, View, div } from 'corona/kit';
import { Empty } from 'corona/base';
import { call } from 'corona/plugin';
import { get } from 'corona/settings';
import { bar, togglePanel } from 'corona/surface';
import { widgetSummary } from './protocol.ts';
import { snapshot } from './state.ts';
import { RECORDING_DOT, recordIcon } from './ui.ts';

/**
 * PipeWire Recorder bar button:
 * - Red while actively recording, normal when ready/skipped, muted when paused/offline.
 * - Left click toggles the panel; right click pauses/resumes recording.
 */
export default class Widget extends View {
  public render(cx: Context): Element {
    const theme = cx.theme();
    const snap = snapshot();
    const summary = widgetSummary(snap);

    if (summary.state !== 'recording' && get('hideWhenIdle')) {
      return new Empty();
    }

    const color =
      summary.state === 'recording'
        ? RECORDING_DOT
        : summary.state === 'ready' || summary.state === 'skipped'
          ? theme.foreground
          : theme.muted_foreground;

    const button = div()
      .id('pw-recorder-toggle')
      .flex_none()
      .p(4)
      .rounded_full()
      .cursor_pointer()
      .tooltip(summary.tooltip)
      .hover((el) => el.bg(theme.accent))
      .on_click(() => {
        togglePanel('main');
      })
      .on_mouse_down('right', () => {
        void call('toggle');
      })
      .child(recordIcon(color, summary.state === 'recording'));

    return bar()?.bare ? button : button.bg(theme.secondary);
  }
}
