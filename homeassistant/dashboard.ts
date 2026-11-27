import {
  addSlider,
  addTile,
  onMute,
  onSecondary,
  onSet,
  onToggle,
  removeSlider,
  removeTile
} from 'corona/dashboard';
import type { Value } from 'corona/plugin';
import { openPanel } from 'corona/surface';
import type { Entity } from './service.ts';

/** Calls a Home Assistant service on `entity` */
export type CallService = (
  domain: string,
  service: string,
  entity: string,
  data?: Record<string, Value>
) => Promise<void>;

/** The tile of each dashboard domain: its icon, and the service a click calls */
const TILES: Record<string, { icon: string; click: [string, string] }> = {
  automation: { click: ['automation', 'trigger'], icon: 'bot' },
  fan: { click: ['homeassistant', 'toggle'], icon: 'fan' },
  input_boolean: { click: ['homeassistant', 'toggle'], icon: 'toggle-left' },
  light: { click: ['light', 'toggle'], icon: 'lightbulb' },
  scene: { click: ['scene', 'turn_on'], icon: 'palette' },
  script: { click: ['script', 'turn_on'], icon: 'play' },
  switch: { click: ['homeassistant', 'toggle'], icon: 'toggle-left' }
};
/** Domains whose tile shows on and off */
const SWITCHED = new Set(['fan', 'input_boolean', 'light', 'switch']);

function domain(id: string): string {
  return id.split('.')[0] ?? '';
}

function name(e: Entity): string {
  const friendly = e.attributes.friendly_name;
  return typeof friendly === 'string' ? friendly : e.id;
}

function status(e: Entity): string {
  if (e.state === 'unavailable') {
    return 'Unavailable';
  }
  if (SWITCHED.has(domain(e.id)) || domain(e.id) === 'automation') {
    return e.state === 'on' ? 'On' : 'Off';
  }
  return domain(e.id) === 'scene' ? 'Scene' : 'Run';
}

/** A light that dims: one of its color modes is more than on and off */
function dims(e: Entity): boolean {
  const modes = e.attributes.supported_color_modes;
  return (
    domain(e.id) === 'light' &&
    Array.isArray(modes) &&
    modes.some((mode) => mode !== 'onoff')
  );
}

/** Brightness in percent, 0 while off */
function brightness(e: Entity): number {
  const raw = e.attributes.brightness;
  return e.state === 'on' && typeof raw === 'number'
    ? Math.round((raw / 255) * 100)
    : 0;
}

/**
 * Dashboard tiles for the monitored lights, switches, fans, booleans, scenes, automations
 * and scripts, and sliders for the lights that dim. Each is `homeassistant:<entity id>`, which
 * the user puts on the dashboard in the settings app; they go while Home Assistant is away.
 */
export class Dashboard {
  declare private readonly call: CallService;
  declare private tiles: Set<string>;
  declare private sliders: Set<string>;

  public constructor(call: CallService) {
    this.call = call;
    this.tiles = new Set();
    this.sliders = new Set();
    onToggle((id) => {
      const tile = TILES[domain(id)];
      if (tile) {
        this.run(tile.click[0], tile.click[1], id);
      }
    });
    onSet(({ key, value }) => {
      if (value <= 0) {
        this.run('light', 'turn_off', key);
      } else {
        this.run('light', 'turn_on', key, { brightness_pct: value });
      }
    });
    // The slider's icon switches the light
    onMute((id) => this.run('light', 'toggle', id));
    onSecondary(() => openPanel('main'));
  }

  /** Adds, updates and removes the items for `entities`, the monitored ones */
  public sync(entities: Record<string, Entity>): void {
    const tiles = new Set<string>();
    const sliders = new Set<string>();
    for (const e of Object.values(entities)) {
      const tile = TILES[domain(e.id)];
      if (!tile) {
        continue;
      }
      tiles.add(e.id);
      addTile(e.id, {
        active: SWITCHED.has(domain(e.id)) && e.state === 'on',
        enabled: e.state !== 'unavailable',
        icon: tile.icon,
        status: status(e),
        title: name(e)
      });
      if (dims(e)) {
        sliders.add(e.id);
        addSlider(e.id, {
          icon: 'lightbulb',
          max: 100,
          min: 0,
          muted: e.state !== 'on',
          step: 1,
          throttleMs: 300,
          title: name(e),
          unit: '%',
          value: brightness(e)
        });
      }
    }
    for (const id of this.tiles) {
      if (!tiles.has(id)) {
        removeTile(id);
      }
    }
    for (const id of this.sliders) {
      if (!sliders.has(id)) {
        removeSlider(id);
      }
    }
    this.tiles = tiles;
    this.sliders = sliders;
  }

  private run(
    domain: string,
    service: string,
    entity: string,
    data?: Record<string, Value>
  ): void {
    this.call(domain, service, entity, data).catch((error: unknown) =>
      console.warn(
        `homeassistant: ${domain}.${service} ${entity}: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }
}
