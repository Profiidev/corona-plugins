import {
  addTile,
  onMute,
  onSecondary,
  onSet,
  onToggle,
  setSlider,
  setTile
} from 'corona/dashboard';
import { setState } from 'corona/plugin';
import { get, onChange, set } from 'corona/settings';
import { openPanel } from 'corona/surface';
import { t } from 'corona/i18n';

let clicks = 0;
let level = 5;
let muted = false;

/** The manifest's `demo:ping` and `demo:level`, and `demo:beat`, which only the service adds */
export function dashboard(): void {
  setTile('ping', {
    status: t('dashboard.clicks', { count: clicks }),
    title: t('dashboard.ping')
  });
  setSlider('level', { muted, title: t('dashboard.level'), value: level });
  setState('level', level);
  addTile('beat', {
    active: get('heartbeat'),
    icon: 'heart',
    title: t('dashboard.beat')
  });
  // The Heartbeat setting changes in the settings app too
  onChange((change) => {
    if (change.key === 'heartbeat') {
      setTile('beat', { active: get('heartbeat') });
    }
  });

  onToggle((key) => {
    if (key === 'ping') {
      clicks += 1;
      setTile('ping', {
        active: clicks % 2 === 1,
        status: t('dashboard.clicks', { count: clicks })
      });
    } else if (key === 'beat') {
      set('heartbeat', !get('heartbeat'));
    }
  });
  onSet(({ value }) => {
    level = value;
    setSlider('level', { value });
    setState('level', value);
  });
  onMute(() => {
    muted = !muted;
    setSlider('level', { muted });
  });
  // A right click on a tile, the chevron of the slider
  onSecondary(() => openPanel('main'));
}
