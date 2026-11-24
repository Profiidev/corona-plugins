import { type Context, type Element, type Props, View, div } from 'corona/kit';
import {
  Slider,
  SliderIndicator,
  SliderState,
  SliderThumb,
  SliderTrack,
  type SliderValue,
  type Theme,
  h_flex,
  v_flex
} from 'corona/base';
import { Button, Icon, Switch, Tab, TabBar } from 'corona/component';
import { type Value, call } from 'corona/plugin';
import { get } from 'corona/settings';
import { closePanel } from 'corona/surface';
import {
  type AudioNode,
  listStreams,
  setMute,
  setVolume
} from 'corona/pipewire';
import {
  type RecorderSnapshot,
  type TrackState,
  formatClock,
  linearToPercent,
  percentToLinear
} from './protocol.ts';
import { message, recentTracks, snapshot, streams } from './state.ts';
import {
  ONLINE_DOT,
  RECORDING_DOT,
  WARNING_DOT,
  dot,
  recordIcon,
  tintedBg
} from './ui.ts';

const TABS = ['Live', 'Recent', 'Streams'];

/** Live status, listening loopback volume, recent FLAC recordings, and stream selection. */
export default class Panel extends View {
  declare private tab: number;
  declare private busy: Set<string>;
  declare private volume: SliderState;
  declare private dragging: boolean;

  public init(_props: Props | undefined, cx: Context): void {
    this.tab = 0;
    this.busy = new Set();
    this.dragging = false;

    this.volume = SliderState.new({ max: 100, min: 0, value: 100 });
    this.volume.on('change', (val) => {
      this.dragging = true;
      const node = this.loopbackNode(snapshot());
      if (node) {
        try {
          setVolume(node.id, percentToLinear(single(val)));
        } catch (error) {
          console.warn(`pipewire-recorder: setVolume: ${String(error)}`);
        }
      }
    });
    this.volume.on('release', (val) => {
      this.dragging = false;
      const node = this.loopbackNode(snapshot());
      if (node) {
        try {
          setVolume(node.id, percentToLinear(single(val)));
        } catch (error) {
          console.warn(`pipewire-recorder: setVolume: ${String(error)}`);
        }
      }
    });

    void cx.spawn(async () => {
      await call('getRecent', { limit: 25 }).catch((): null => null);
      await call('refreshStreams').catch((): null => null);
    });
  }

  public render(cx: Context): Element {
    const theme = cx.theme();
    const snap = snapshot();
    const status = message();
    const loopback = this.loopbackNode(snap);

    if (loopback && !this.dragging) {
      const pct = linearToPercent(loopback.volume);
      if (single(this.volume.value()) !== pct) {
        this.volume.set_value(pct);
      }
    }

    const root = v_flex()
      .size_full()
      .p_2()
      .gap_3()
      .child(this.header(snap, theme))
      .child(
        new TabBar('pwr-tabs')
          .flex_none()
          .self_start()
          .variant('segmented')
          .selected_index(this.tab)
          .on_change((index, cx) => {
            this.tab = index;
            if (index === 1) {
              this.run('getRecent', { limit: 25 }, cx);
            } else if (index === 2) {
              this.run('refreshStreams', null, cx);
            }
            cx.notify();
          })
          .children(
            TABS.map((label) => new Tab().cursor_pointer().label(label))
          )
      );

    if (!snap || snap.daemon === 'starting') {
      root.child(empty(theme, 'Starting pipewire-recorder…'));
    } else if (snap.daemon === 'error' || snap.daemon === 'stopped') {
      root.child(this.offlineCard(snap, theme));
    } else {
      root.child(
        scroll('pwr-tab').children(
          this.tab === 0
            ? this.liveTab(snap, loopback, theme)
            : this.tab === 1
              ? this.recentTab(snap, theme)
              : this.streamsTab(snap, theme)
        )
      );
    }

    if (status) {
      root.child(
        div()
          .flex_none()
          .px_0p5()
          .text_xs()
          .font_family(theme.typography.mono)
          .text_color(theme.muted_foreground)
          .truncate()
          .child(status)
      );
    }

    return root;
  }

  private loopbackNode(snap: RecorderSnapshot | null): AudioNode | null {
    if (!snap?.virtual_sink.enabled) {
      return null;
    }
    const expectedNode = snap.virtual_sink.playback_node_name;
    const expectedName = snap.virtual_sink.playback_name;
    return (
      listStreams().find(
        (n) =>
          n.name === expectedNode ||
          n.description === expectedName ||
          n.app.includes(expectedName)
      ) ?? null
    );
  }

  private header(snap: RecorderSnapshot | null, theme: Theme): Element {
    const isRecording =
      snap?.daemon === 'running' &&
      snap.recording_enabled &&
      snap.track?.status === 'recording';
    const stateLabel =
      !snap || snap.daemon === 'starting'
        ? 'Starting…'
        : snap.daemon === 'error'
          ? 'Error'
          : snap.daemon === 'stopped'
            ? 'Stopped'
            : !snap.recording_enabled
              ? 'Paused'
              : isRecording
                ? 'Recording'
                : snap.player
                  ? `Ready · ${snap.mpris_player}`
                  : `Waiting for ${snap.mpris_player}`;

    const dotColor = isRecording
      ? RECORDING_DOT
      : snap?.daemon === 'running' && snap.recording_enabled
        ? ONLINE_DOT
        : snap?.daemon === 'error'
          ? WARNING_DOT
          : theme.muted_foreground;

    return h_flex()
      .flex_none()
      .items_center()
      .gap_2p5()
      .px_0p5()
      .child(
        recordIcon(
          isRecording ? RECORDING_DOT : theme.foreground,
          isRecording,
          20
        )
      )
      .child(
        v_flex()
          .flex_1()
          .min_w_0()
          .child(
            div()
              .text_lg()
              .font_semibold()
              .truncate()
              .child('PipeWire Recorder')
          )
          .child(
            h_flex()
              .items_center()
              .gap_1p5()
              .text_xs()
              .text_color(theme.muted_foreground)
              .child(dot(dotColor))
              .child(div().truncate().child(stateLabel))
          )
      )
      .when(snap?.daemon === 'running', (el) =>
        el.child(
          new Switch('pwr-enabled')
            .size('small')
            .checked(snap?.recording_enabled ?? false)
            .on_change((on, cx) => this.run('setEnabled', { enabled: on }, cx))
        )
      )
      .child(
        headerButton('pwr-restart', 'icons/refresh-cw.svg', 'Restart daemon')
          .outline()
          .loading(this.busy.has('restart'))
          .on_click((_e, cx) => this.run('restart', null, cx))
      )
      .child(
        headerButton('pwr-close', 'icons/x.svg', 'Close')
          .outline()
          .on_click(() => {
            closePanel('main');
          })
      );
  }

  private offlineCard(snap: RecorderSnapshot, theme: Theme): Element {
    return v_flex()
      .flex_none()
      .gap_2()
      .p_3()
      .rounded_xl()
      .border_1()
      .border_color(theme.border)
      .child(
        div().text_sm().font_medium().child('pipewire-recorder is not running')
      )
      .child(
        div()
          .text_xs()
          .text_color(theme.muted_foreground)
          .child(
            snap.error ??
              'Make sure `pipewire-recorder` is installed in PATH and try restarting.'
          )
      )
      .child(
        new Button('pwr-retry')
          .cursor_pointer()
          .outline()
          .size('small')
          .self_start()
          .label('Restart')
          .on_click((_e, cx) => this.run('restart', null, cx))
      );
  }

  private liveTab(
    snap: RecorderSnapshot,
    loopback: AudioNode | null,
    theme: Theme
  ): Element[] {
    return [
      section(theme, 'Current track', this.trackCard(snap, theme)),
      section(
        theme,
        'Listening volume (Virtual Sink)',
        this.virtualSinkCard(snap, loopback, theme)
      ),
      section(
        theme,
        'Configuration',
        group(theme, [
          h_flex()
            .items_center()
            .gap_2()
            .child(text(theme, 'Output folder', snap.output_dir))
            .child(
              iconButton('pwr-copy-dir', 'icons/copy.svg', 'Copy path')
                .ghost()
                .on_click((_e, cx) => {
                  cx.write_to_clipboard(snap.output_dir);
                })
            )
            .child(
              new Button('pwr-pick-dir')
                .cursor_pointer()
                .outline()
                .size('small')
                .label('Choose')
                .on_click((_e, cx) => this.run('pickOutputDir', null, cx))
            ),
          h_flex()
            .items_center()
            .justify_between()
            .gap_2()
            .child(
              text(
                theme,
                'Target stream',
                `MPRIS: ${snap.mpris_player} · PipeWire: ${snap.pipewire_target}`
              )
            )
            .child(
              div()
                .text_xs()
                .font_family(theme.typography.mono)
                .text_color(theme.muted_foreground)
                .child(snap.pw_node ? `#${snap.pw_node.serial}` : 'idle')
            ),
          h_flex()
            .items_center()
            .gap_2()
            .child(
              text(
                theme,
                'Save notifications',
                'Show a desktop notification when a track is saved'
              )
            )
            .child(
              new Switch('pwr-notify')
                .size('small')
                .checked(get('notifyOnSave'))
                .on_change((on, cx) =>
                  this.run('setNotifyOnSave', { enabled: on }, cx)
                )
            )
        ])
      )
    ];
  }

  private trackCard(snap: RecorderSnapshot, theme: Theme): Element {
    const { track } = snap;
    if (!track) {
      return group(theme, [
        h_flex()
          .items_center()
          .gap_2p5()
          .child(tile(theme, 'icons/music.svg'))
          .child(
            text(
              theme,
              snap.player
                ? 'No active track'
                : `Waiting for ${snap.mpris_player}`,
              snap.player
                ? `Player status: ${snap.player.status}`
                : 'Start playback to record automatically'
            )
          )
      ]);
    }

    const pct =
      track.duration_ms > 0
        ? Math.max(
            0,
            Math.min(100, (track.captured_ms / track.duration_ms) * 100)
          )
        : 0;

    const rows: Element[] = [
      v_flex()
        .gap_2()
        .child(
          h_flex()
            .items_center()
            .gap_2p5()
            .child(tile(theme, 'icons/disc-3.svg'))
            .child(
              v_flex()
                .flex_1()
                .min_w_0()
                .child(
                  div()
                    .text_sm()
                    .font_medium()
                    .truncate()
                    .child(track.title || 'Unknown title')
                )
                .child(
                  div()
                    .text_xs()
                    .truncate()
                    .text_color(theme.muted_foreground)
                    .child(
                      track.album
                        ? `${track.artist} · ${track.album}`
                        : track.artist
                    )
                )
            )
            .child(trackBadge(track, theme))
        )
        .child(
          v_flex()
            .gap_1()
            .child(
              div()
                .h_1p5()
                .w_full()
                .rounded_full()
                .bg(theme.muted)
                .child(
                  div()
                    .h_full()
                    .w(`${pct}%`)
                    .rounded_full()
                    .bg(
                      track.status === 'recording'
                        ? RECORDING_DOT
                        : theme.muted_foreground
                    )
                )
            )
            .child(
              h_flex()
                .justify_between()
                .text_xs()
                .font_family(theme.typography.mono)
                .text_color(theme.muted_foreground)
                .child(formatClock(track.captured_ms))
                .child(formatClock(track.duration_ms))
            )
        )
    ];

    if (track.reason) {
      rows.push(
        div().text_xs().text_color(theme.muted_foreground).child(track.reason)
      );
    }

    return group(theme, rows);
  }

  private virtualSinkCard(
    snap: RecorderSnapshot,
    loopback: AudioNode | null,
    theme: Theme
  ): Element {
    const rows: Element[] = [
      h_flex()
        .items_center()
        .gap_2()
        .child(
          text(
            theme,
            'Virtual capture sink',
            snap.virtual_sink.enabled
              ? snap.virtual_sink.routed
                ? `Active · ${snap.mpris_player} routed at 100%`
                : 'Active · waiting for player stream'
              : 'Decouple listening volume from 100% capture'
          )
        )
        .child(
          new Switch('pwr-virtual-sink')
            .size('small')
            .checked(snap.virtual_sink.enabled)
            .on_change((on, cx) =>
              this.run('setVirtualSink', { enabled: on }, cx)
            )
        )
    ];

    if (snap.virtual_sink.enabled) {
      if (loopback) {
        const pct = linearToPercent(loopback.volume);
        rows.push(
          h_flex()
            .items_center()
            .gap_1()
            .child(
              (loopback.mute
                ? iconButton(
                    'pwr-lb-mute',
                    'icons/volume-x.svg',
                    'Unmute'
                  ).danger()
                : iconButton(
                    'pwr-lb-mute',
                    'icons/volume-2.svg',
                    'Mute'
                  ).ghost()
              ).on_click(() => {
                try {
                  setMute(loopback.id, !loopback.mute);
                } catch (error) {
                  console.warn(`pipewire-recorder: setMute: ${String(error)}`);
                }
              })
            )
            .child(slider(this.volume, theme, false))
            .child(
              div()
                .w_10()
                .flex_none()
                .text_right()
                .text_xs()
                .font_family(theme.typography.mono)
                .text_color(theme.muted_foreground)
                .child(loopback.mute ? 'MUTE' : `${pct}%`)
            )
        );
      } else {
        rows.push(
          div()
            .text_xs()
            .text_color(theme.muted_foreground)
            .child(
              `Waiting for loopback mixer "${snap.virtual_sink.playback_name}"…`
            )
        );
      }
    }

    return group(theme, rows);
  }

  private recentTab(snap: RecorderSnapshot, theme: Theme): Element[] {
    const entries = recentTracks();
    const headerRow = h_flex()
      .items_center()
      .justify_between()
      .px_0p5()
      .child(
        div()
          .text_xs()
          .text_color(theme.muted_foreground)
          .child(`${snap.index_count} tracks in index`)
      )
      .child(
        new Button('pwr-verify')
          .cursor_pointer()
          .outline()
          .size('small')
          .label('Verify index')
          .loading(this.busy.has('verifyIndex'))
          .on_click((_e, cx) => this.run('verifyIndex', null, cx))
      );

    if (entries.length === 0) {
      return [
        headerRow,
        group(theme, [
          div()
            .text_xs()
            .text_color(theme.muted_foreground)
            .child('No recorded tracks yet.')
        ])
      ];
    }

    return [
      headerRow,
      group(
        theme,
        entries.map((entry, idx) =>
          h_flex()
            .id(`pwr-recent-${idx}`)
            .items_center()
            .gap_2()
            .child(
              text(
                theme,
                entry.title,
                entry.album ? `${entry.artist} · ${entry.album}` : entry.artist
              )
            )
            .child(
              div()
                .flex_none()
                .text_xs()
                .font_family(theme.typography.mono)
                .text_color(theme.muted_foreground)
                .child(formatClock(entry.duration_ms))
            )
            .child(
              iconButton(`pwr-copy-${idx}`, 'icons/copy.svg', 'Copy file path')
                .ghost()
                .on_click((_e, cx) => {
                  cx.write_to_clipboard(entry.file_path);
                })
            )
        )
      )
    ];
  }

  private streamsTab(snap: RecorderSnapshot, theme: Theme): Element[] {
    const info = streams();
    const players = info?.mpris_players ?? [];
    const nodes = info?.pipewire_nodes ?? [];

    const parts: Element[] = [
      h_flex()
        .items_center()
        .justify_between()
        .px_0p5()
        .child(
          div()
            .text_xs()
            .text_color(theme.muted_foreground)
            .child('Click a player to switch target')
        )
        .child(
          new Button('pwr-streams-refresh')
            .cursor_pointer()
            .outline()
            .size('small')
            .label('Refresh')
            .loading(this.busy.has('refreshStreams'))
            .on_click((_e, cx) => this.run('refreshStreams', null, cx))
        )
    ];

    parts.push(
      section(
        theme,
        'MPRIS Players',
        players.length === 0
          ? group(theme, [
              div()
                .text_xs()
                .text_color(theme.muted_foreground)
                .child('No active MPRIS players detected.')
            ])
          : group(
              theme,
              players.map((p, idx) => {
                const selected =
                  p.short_name.toLowerCase() ===
                    snap.mpris_player.toLowerCase() ||
                  p.short_name
                    .toLowerCase()
                    .startsWith(`${snap.mpris_player.toLowerCase()}.`);
                return h_flex()
                  .id(`pwr-mpris-${idx}`)
                  .items_center()
                  .gap_2()
                  .cursor_pointer()
                  .on_click((_e, cx) => {
                    const base = p.short_name.split('.')[0] || p.short_name;
                    this.run(
                      'setTarget',
                      { mprisPlayer: base, pipewireTarget: base },
                      cx
                    );
                  })
                  .child(
                    text(
                      theme,
                      p.short_name,
                      p.track ? `${p.status} · ${p.track}` : p.status
                    )
                  )
                  .when(selected, (el) =>
                    el.child(new Icon('icons/check.svg').size('small'))
                  );
              })
            )
      )
    );

    parts.push(
      section(
        theme,
        'PipeWire Audio Streams',
        nodes.length === 0
          ? group(theme, [
              div()
                .text_xs()
                .text_color(theme.muted_foreground)
                .child('No active PipeWire output streams.')
            ])
          : group(
              theme,
              nodes.map((n, idx) => {
                const label = n.app_name || n.node_name || `#${n.serial}`;
                const vol = n.mute
                  ? 'MUTED'
                  : n.volume === null
                    ? '100%'
                    : `${linearToPercent(n.volume)}%`;
                return h_flex()
                  .id(`pwr-node-${idx}`)
                  .items_center()
                  .gap_2()
                  .cursor_pointer()
                  .on_click((_e, cx) => {
                    const target =
                      n.app_name ||
                      n.node_name ||
                      n.binary_name ||
                      String(n.serial);
                    this.run(
                      'setTarget',
                      {
                        mprisPlayer: snap.mpris_player,
                        pipewireTarget: target
                      },
                      cx
                    );
                  })
                  .child(
                    text(
                      theme,
                      label,
                      `serial ${n.serial} · ${n.binary_name || n.node_name}`
                    )
                  )
                  .child(
                    div()
                      .flex_none()
                      .text_xs()
                      .font_family(theme.typography.mono)
                      .text_color(
                        n.is_unity ? theme.muted_foreground : theme.destructive
                      )
                      .child(vol)
                  );
              })
            )
      )
    );

    return parts;
  }

  private run(method: string, args: Value, cx: Context): void {
    this.busy.add(method);
    cx.notify();
    void cx.spawn(async (cx) => {
      try {
        await call(method, args);
      } catch (error) {
        console.warn(`pipewire-recorder: ${method}: ${String(error)}`);
      } finally {
        this.busy.delete(method);
        cx.notify();
      }
    });
  }
}

function trackBadge(track: TrackState, theme: Theme): Element {
  if (track.status === 'recording') {
    return div()
      .flex_none()
      .px_1p5()
      .py_0p5()
      .rounded_md()
      .bg(tintedBg(RECORDING_DOT, 0.18))
      .text_xs()
      .font_semibold()
      .text_color(RECORDING_DOT)
      .child('REC');
  }
  if (track.status === 'invalidated') {
    return div()
      .flex_none()
      .px_1p5()
      .py_0p5()
      .rounded_md()
      .bg(tintedBg(WARNING_DOT, 0.18))
      .text_xs()
      .font_semibold()
      .text_color(WARNING_DOT)
      .child('DISCARDED');
  }
  const label = track.status === 'skipped' ? 'SKIPPED' : 'PAUSED';
  return div()
    .flex_none()
    .px_1p5()
    .py_0p5()
    .rounded_md()
    .bg(theme.muted)
    .text_xs()
    .font_semibold()
    .text_color(theme.muted_foreground)
    .child(label);
}

function section(theme: Theme, title: string, content: Element): Element {
  return v_flex()
    .flex_none()
    .gap_1p5()
    .child(
      div()
        .px_0p5()
        .text_xs()
        .font_medium()
        .text_color(theme.muted_foreground)
        .child(title)
    )
    .child(content);
}

function group(theme: Theme, rows: Element[]): Element {
  return v_flex()
    .flex_none()
    .rounded_xl()
    .bg(theme.accent)
    .border_1()
    .border_color(theme.border)
    .overflow_hidden()
    .children(
      rows.map((row, i) => {
        const cell = div().px_3().py_2p5().child(row);
        return i ? cell.border_t_1().border_color(theme.border) : cell;
      })
    );
}

function scroll(id: string): Element<'div'> {
  return v_flex().id(id).flex_1().min_h_0().overflow_y_scroll().gap_3();
}

function empty(theme: Theme, textLine: string): Element {
  return v_flex()
    .flex_1()
    .items_center()
    .justify_center()
    .gap_2()
    .text_sm()
    .text_color(theme.muted_foreground)
    .child(recordIcon(theme.muted_foreground, false, 24))
    .child(textLine);
}

function tile(theme: Theme, icon: string): Element {
  return div()
    .flex_none()
    .size_8()
    .flex()
    .items_center()
    .justify_center()
    .rounded_lg()
    .bg(theme.muted)
    .child(new Icon(icon).size('small'));
}

function text(theme: Theme, title: string, desc: string): Element {
  return v_flex()
    .flex_1()
    .min_w_0()
    .child(div().text_sm().font_medium().truncate().child(title))
    .child(
      div().text_xs().truncate().text_color(theme.muted_foreground).child(desc)
    );
}

function slider(state: SliderState, theme: Theme, disabled: boolean): Element {
  return Slider.new(state)
    .flex_1()
    .px_2()
    .opacity(disabled ? 0.5 : 1)
    .child(
      SliderTrack.new(state)
        .flex()
        .items_center()
        .h_6()
        .w_full()
        .when(!disabled, (el) => el.cursor_pointer())
        .child(
          SliderIndicator.new(state)
            .relative()
            .w_full()
            .h_1p5()
            .rounded_full()
            .bg(tintedBg(theme.primary, 0.2))
            .range_style((fill) => fill.rounded_full().bg(theme.primary))
            .child(
              SliderThumb.new(state)
                .size_4()
                .ml(-8)
                .top(-5)
                .p(1)
                .rounded_full()
                .bg(tintedBg(theme.primary, 0.5))
                .child(
                  div().size_full().rounded_full().bg(theme.primary_foreground)
                )
            )
        )
    );
}

function headerButton(
  id: string,
  icon: string,
  label: string
): Element<'Button'> {
  return new Button(id)
    .cursor_pointer()
    .size_8()
    .p_0()
    .tooltip(label)
    .child(new Icon(icon).size('small'));
}

function iconButton(
  id: string,
  icon: string,
  label: string
): Element<'Button'> {
  return new Button(id)
    .cursor_pointer()
    .size('small')
    .size_7()
    .p_0()
    .tooltip(label)
    .child(new Icon(icon).size('small'));
}

function single(value: SliderValue): number {
  return Array.isArray(value) ? value[1] : value;
}
