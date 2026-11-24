// Run with `node pipewire-recorder/protocol.test.ts`; throws on the first mismatch.
import {
  applyEvent,
  formatClock,
  initialSnapshot,
  linearToPercent,
  parseEvent,
  percentToLinear,
  widgetSummary
} from './protocol.ts';

function check(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(
      `${name}: expected ${String(expected)}, got ${String(actual)}`
    );
  }
}

check('clock zero', formatClock(0), '0:00');
check('clock 65s', formatClock(65_000), '1:05');
check('clock negative', formatClock(-500), '0:00');

check('cubic 0%', percentToLinear(0), 0);
check('cubic 50% -> 0.125 linear', percentToLinear(50), 0.125);
check('cubic 100% -> 1 linear', percentToLinear(100), 1);
check('linear 0.125 -> 50%', linearToPercent(0.125), 50);
check('linear 0.02 -> 27%', linearToPercent(0.02), 27);
check('linear 1 -> 100%', linearToPercent(1), 100);

check('parse ignores log line', parseEvent('INFO started daemon'), null);
check('parse ignores unknown type', parseEvent('{"type":"bogus"}'), null);

const snapLine = JSON.stringify({
  capturing: true,
  enforce_unity_volume: true,
  index_count: 12,
  mpris_player: 'spotify',
  output_dir: '/home/user/Music/Spotify',
  pipewire_target: 'spotify',
  player: {
    bus: 'org.mpris.MediaPlayer2.spotify',
    status: 'playing',
    volume: 1
  },
  pw_node: {
    app_name: 'Spotify',
    binary_name: 'spotify',
    id: 77,
    is_unity: true,
    media_name: 'Spotify',
    mute: false,
    node_name: 'spotify',
    serial: 188,
    volume: 1
  },
  recording_enabled: true,
  track: {
    album: 'Discovery',
    artist: 'Daft Punk',
    captured_ms: 42_000,
    duration_ms: 298_000,
    reason: null,
    status: 'recording',
    title: 'Digital Love',
    track_id: '/com/spotify/track/abc'
  },
  type: 'snapshot',
  virtual_sink: {
    active: true,
    enabled: true,
    playback_name: 'PipeWire Recorder Playback',
    playback_node_name: 'pipewire_recorder_capture.playback',
    routed: true,
    sink_name: 'pipewire_recorder_capture'
  }
});

const parsed = parseEvent(snapLine);
check('parsed type', parsed?.type, 'snapshot');

let snap = initialSnapshot();
if (parsed) {
  snap = applyEvent(snap, parsed);
}
check('daemon running', snap.daemon, 'running');
check('index count', snap.index_count, 12);
check('track title', snap.track?.title, 'Digital Love');

const recWidget = widgetSummary(snap);
check('widget recording state', recWidget.state, 'recording');
check(
  'widget recording tooltip',
  recWidget.tooltip,
  'Recording · Daft Punk – Digital Love (0:42 / 4:58)'
);

const pausedWidget = widgetSummary({ ...snap, recording_enabled: false });
check('widget paused state', pausedWidget.state, 'paused');

const skippedWidget = widgetSummary({
  ...snap,
  track: snap.track
    ? {
        ...snap.track,
        reason: 'already recorded',
        status: 'skipped'
      }
    : null
});
check('widget skipped state', skippedWidget.state, 'skipped');
check(
  'widget skipped tooltip',
  skippedWidget.tooltip,
  'Skipped · Daft Punk – Digital Love (already recorded)'
);

const verified = parseEvent(
  '{"type":"index_verified","removed":2,"remaining":10}'
);
if (verified) {
  snap = applyEvent(snap, verified);
}
check('index verified count', snap.index_count, 10);
