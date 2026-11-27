import { type Context, type Element, View, div } from 'corona/kit';
import { getState } from 'corona/plugin';
import { options } from 'corona/surface';
import { t } from 'corona/i18n';

/** The dashboard card `demo:status`: the heartbeat and the slider's level */
export default class Card extends View {
  public render(_cx: Context): Element {
    const props = options();
    const title =
      typeof props === 'object' && props !== null && 'title' in props
        ? String(props.title)
        : 'Demo';
    return div()
      .flex()
      .flex_col()
      .gap_1()
      .child(div().text_sm().font_bold().child(title))
      .child(
        div()
          .text_xs()
          .child(
            t('dashboard.card', {
              count: getState('heartbeat') ?? '–',
              level: getState('level') ?? '–'
            })
          )
      );
  }
}
