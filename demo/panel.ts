import {
  type Context,
  type Element,
  type Props,
  View,
  div,
  image
} from 'corona/kit';
import { h_flex, v_flex } from 'corona/base';
import { Button } from 'corona/component';
import { readFile } from 'fs/promises';
import { type Value, call, getState } from 'corona/plugin';
import { language, t } from 'corona/i18n';
import { all } from 'corona/settings';
import { resumedAt, sleeping } from 'corona/power';
import { openPath, openUri } from 'corona/desktop';
import { message } from './util.ts';

/** The service's methods, one button each */
const METHODS = [
  'ping',
  'time',
  'spawn',
  'notify',
  'dbus',
  'tailscale',
  'fetch',
  'secret',
  'richNotify',
  'stdin',
  'files',
  'unixFetch',
  'ipnBus',
  'settings',
  'secretSetting',
  'oauth'
];

type Spawned = {
  pid: number;
  lines: string[];
  exit: number | string | null;
  stderr: string | null;
};

function isSpawned(value: Value): value is Spawned {
  return typeof value === 'object' && value !== null && 'pid' in value;
}

function isStrings(value: Value): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

/** A dashboard of every API: service calls, shared state, desktop, images, clipboard. */
export default class Panel extends View {
  /** Shown per method, the answer or the error */
  declare private results: Record<string, string>;
  declare private busy: Set<string>;
  /** The PNG read through the `fs.read` grant, for `image(Uint8Array)` */
  declare private bytes: Uint8Array | null;

  public init(_props: Props | undefined, cx: Context): void {
    this.results = {};
    this.busy = new Set();
    this.bytes = null;
    void cx.spawn(async (cx) => {
      try {
        // Relative to the `fs.read` root `${pluginDir}`; `image(path)` has no such root
        this.bytes = await readFile('assets/gradient.png');
      } catch (error) {
        this.results.image = `✗ ${message(error)}`;
      }
      cx.notify();
    });
  }

  public render(_cx: Context): Element {
    const settings = all();
    const spawn = getState('spawn');
    const spawned = isSpawned(spawn) ? spawn : null;
    const signals = getState('signals');
    return v_flex()
      .id('demo-panel')
      .size_full()
      .overflow_y_scroll()
      .gap_2()
      .p_4()
      .child(
        h_flex()
          .gap_2()
          .items_center()
          // The file as raster bytes
          .child(this.bytes ? image(this.bytes).size_8() : div().size_8())
          .child(
            v_flex()
              .child(div().font_semibold().child(t('panel.title')))
              .child(
                div()
                  .text_xs()
                  .child(
                    t('panel.greeting', {
                      greeting: settings.greeting,
                      language: language()
                    })
                  )
              )
          )
      )
      .child(
        div()
          .text_xs()
          .child(
            t('panel.status', {
              count: getState('heartbeat') ?? '–',
              heartbeat: String(settings.heartbeat),
              urgency: settings.urgency
            })
          )
      )
      .child(
        div()
          .text_xs()
          .child(t('panel.favorite', { favorite: settings.favorite }))
      )
      .child(
        div()
          .text_xs()
          .child(
            t('panel.sleep', {
              event: String(getState('sleep') ?? '–'),
              resumed:
                resumedAt() === null
                  ? '–'
                  : new Date(resumedAt() * 1000).toLocaleTimeString(),
              sleeping: String(sleeping())
            })
          )
      )
      .child(div().font_semibold().child(t('panel.service')))
      .child(
        h_flex()
          .flex_wrap()
          .gap_1()
          .children(METHODS.map((method) => this.button(method)))
      )
      .child(div().font_semibold().child(t('panel.desktop')))
      .child(
        h_flex()
          .flex_wrap()
          .gap_1()
          .child(
            new Button('demo-pick')
              .label(t('panel.pick'))
              .size('small')
              .on_click((_e, cx) => this.pick(cx))
          )
          .child(
            new Button('demo-open-path')
              .label(t('panel.open_path'))
              .size('small')
              .on_click((_e, cx) => {
                const path = this.picked?.[0];
                try {
                  if (!path) {
                    throw new Error(t('panel.pick_first'));
                  }
                  openPath(path);
                  this.results.desktop = t('panel.opened', { target: path });
                } catch (error) {
                  this.results.desktop = `✗ ${message(error)}`;
                }
                cx.notify();
              })
          )
          .child(
            new Button('demo-open-uri')
              .label(t('panel.open_uri'))
              .size('small')
              .on_click((_e, cx) => {
                try {
                  openUri('https://example.com/');
                  this.results.desktop = t('panel.opened', {
                    target: 'https://example.com/'
                  });
                } catch (error) {
                  this.results.desktop = `✗ ${message(error)}`;
                }
                cx.notify();
              })
          )
          .child(
            new Button('demo-copy')
              .label(t('panel.copy'))
              .size('small')
              .on_click((_e, cx) => {
                cx.write_to_clipboard(JSON.stringify(this.results, null, 2));
                this.results.clipboard = t('panel.copied');
                cx.notify();
              })
          )
      )
      .child(
        div()
          .text_xs()
          .child(t('panel.picked', { paths: this.picked?.join(', ') ?? '–' }))
      )
      .child(div().font_semibold().child(t('panel.results')))
      .children(
        Object.entries(this.results).map(([key, value]) =>
          div().text_xs().child(`${key}: ${value}`)
        )
      )
      .child(div().font_semibold().child(t('panel.spawn')))
      .child(
        div()
          .text_xs()
          .child(
            spawned
              ? t('panel.spawned', {
                  exit: spawned.exit ?? '…',
                  pid: spawned.pid,
                  stderr: spawned.stderr ?? ''
                })
              : '–'
          )
      )
      .children(
        (spawned?.lines ?? []).map((line) => div().text_xs().child(line))
      )
      .child(div().font_semibold().child(t('panel.signals')))
      .children(
        (Array.isArray(signals) ? signals.map(String) : ['–']).map((s) =>
          div().text_xs().child(s)
        )
      )
      .child(div().font_semibold().child(t('panel.action')))
      .child(
        div()
          .text_xs()
          .child(String(getState('action') ?? '–'))
      );
  }

  private button(method: string): Element {
    return new Button(`demo-${method}`)
      .label(t(`button.${method}`))
      .size('small')
      .loading(this.busy.has(method))
      .on_click((_e, cx) => {
        this.busy.add(method);
        this.results[method] = t('panel.pending');
        cx.notify();
        void cx.spawn(async (cx) => {
          try {
            this.results[method] = JSON.stringify(await call(method));
          } catch (error) {
            this.results[method] = `✗ ${message(error)}`;
          }
          this.busy.delete(method);
          cx.notify();
        });
      });
  }

  /** The service picks, since this panel closes for the dialog; see `pick` in service.ts */
  private pick(cx: Context): void {
    void cx.spawn(async (cx) => {
      try {
        await call('pick');
      } catch (error) {
        this.results.desktop = `✗ ${message(error)}`;
      }
      cx.notify();
    });
  }

  /** What the service's last `pick` kept */
  private get picked(): string[] | null {
    const picked = getState('picked');
    return isStrings(picked) ? picked : null;
  }
}
