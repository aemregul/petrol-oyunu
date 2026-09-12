import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, runSimulationTick } from '../domain/services/simulationEngine';
import { GAME_CONFIG } from '../config/gameConfig';
import { LESSONS, LOW_TANK_SHARE, firstLessonStep, lessonById, lessonClock, lessonToStart } from '../ui/lessons/lessons';
import { resolveDyn, type LessonView } from '../ui/lessons/lessonTypes';
import type { FuelType, GameState } from '../domain/types/gameState';

/**
 * Emre, 2026-09-11: the first-run tour was too long and hardly anyone read
 * it, so the game teaches each thing when it first comes up. These pin when
 * each lesson offers itself, and that every card points at something the UI
 * actually tags — a lesson lighting a hole round nothing strands the player
 * behind the dimming.
 */

const NO_TABS = { build: null, staff: null, office: null, officeLoans: false };

function view(state: GameState, extra: Partial<LessonView> = {}): LessonView {
  return {
    state,
    activeModal: 'NONE',
    selectedVehicleId: null,
    selectedPumpId: null,
    selectedBuildingId: null,
    landMode: { active: false, intent: 'BUY' },
    buildModeActive: false,
    buildPinned: false,
    tabs: { ...NO_TABS },
    ...extra
  };
}

function withBuilding(state: GameState, id: string, type: string, position: [number, number], size: [number, number]): GameState {
  state.buildings[id] = {
    id,
    type,
    level: 1,
    position,
    rotation: 0,
    size,
    health: 100,
    constructionState: 'ACTIVE',
    builtAtTimestamp: 0
  } as never;
  return state;
}

function uiSource(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return uiSource(path);
      return entry.name.endsWith('.tsx') ? readFileSync(path, 'utf8') : '';
    })
    .join('\n');
}

const FUELS: FuelType[] = ['gasoline', 'diesel', 'lpg'];

describe('every lesson card', () => {
  const source = uiSource(resolve(__dirname, '../ui'));
  const hud = readFileSync(resolve(__dirname, '../ui/HUD.tsx'), 'utf8');
  const templates = [...source.matchAll(/data-tour=\{`([a-z-]+)\$\{/g)].map((m) => m[1]);

  const tagged = (anchor: string) =>
    source.includes(`data-tour="${anchor}"`) ||
    // The office's sections take their tag as a prop.
    source.includes(`tour="${anchor}"`) ||
    // A templated tag (`order-row-${fuelType}`, `build-tab-${tab.id}`) covers
    // its prefix followed by one plain word.
    templates.some((prefix) => anchor.startsWith(prefix) && /^[a-z_]+$/.test(anchor.slice(prefix.length))) ||
    (hud.includes('data-tour={item.key}') && hud.includes(`key: '${anchor}'`));

  /** Each lesson with every subject it can be about, in a state its cards can read. */
  function cases(): Array<{ lesson: string; view: LessonView; subject: string }> {
    const out: Array<{ lesson: string; view: LessonView; subject: string }> = [];
    for (const fuel of FUELS) {
      for (const mode of ['MONEY', 'FULL'] as const) {
        const state = createInitialGameState();
        state.vehicles.car = {
          id: 'car',
          archetype: 'commuter',
          fuelType: fuel,
          state: 'AT_PUMP',
          worldPosition: [6, 0, 6],
          heading: 0,
          request: { mode, targetValue: 400, calculatedLiters: 40, calculatedPrice: 400, dispensedLiters: 0, isFinished: false }
        } as never;
        out.push({ lesson: 'first_customer', view: view(state), subject: 'car' });
      }
      out.push({ lesson: 'fuel_order', view: view(createInitialGameState()), subject: fuel });
    }
    out.push({ lesson: 'hire_attendant', view: view(createInitialGameState()), subject: 'attendant' });
    out.push({ lesson: 'manager_hire', view: view(createInitialGameState()), subject: 'manager' });
    out.push({ lesson: 'manager_setup', view: view(createInitialGameState()), subject: 'manager' });
    out.push({ lesson: 'buy_land', view: view(createInitialGameState()), subject: '4' });

    // Panel lessons, each in the state its panel is open in.
    const station = () => createInitialGameState();
    out.push({ lesson: 'placement', view: view(station(), { buildModeActive: true }), subject: 'placement' });
    for (const [lesson, tab] of [['build_panel', 'station'], ['build_facilities', 'service'], ['build_energy', 'energy']] as const) {
      out.push({ lesson, view: view(station(), { activeModal: 'BUILD', tabs: { ...NO_TABS, build: tab } }), subject: tab });
    }
    for (const fuel of FUELS) {
      out.push({ lesson: 'order_panel', view: view(station(), { activeModal: 'FUEL_ORDER' }), subject: fuel });
    }
    out.push({ lesson: 'staff_panel', view: view(station(), { activeModal: 'STAFF', tabs: { ...NO_TABS, staff: 'attendants' } }), subject: 'staff' });
    for (const [lesson, tab] of [
      ['office_panel', 'summary'],
      ['office_summary', 'summary'],
      ['office_price', 'price'],
      ['office_accounts', 'accounts'],
      ['office_missions', 'missions'],
      ['office_maintenance', 'maintenance']
    ] as const) {
      out.push({ lesson, view: view(station(), { activeModal: 'OFFICE', tabs: { ...NO_TABS, office: tab } }), subject: tab });
    }
    out.push({ lesson: 'pump_card', view: view(station(), { selectedPumpId: 'pump_1' }), subject: 'pump_1' });
    out.push({
      lesson: 'facility_card',
      view: view(withBuilding(station(), 'market', 'mini_market', [10, 10], [5, 4]), { selectedBuildingId: 'market' }),
      subject: 'market'
    });
    out.push({
      lesson: 'structure_card',
      view: view(withBuilding(station(), 'pole', 'light_pole', [3, 3], [1, 1]), { selectedBuildingId: 'pole' }),
      subject: 'pole'
    });
    return out;
  }

  it('covers every lesson in the catalogue', () => {
    expect(new Set(cases().map((c) => c.lesson))).toEqual(new Set(LESSONS.map((l) => l.id)));
  });

  it('has words on it and points at a piece of the UI that is really tagged', () => {
    const untagged: string[] = [];
    for (const c of cases()) {
      const lesson = lessonById(c.lesson)!;
      lesson.steps.forEach((step, i) => {
        expect(resolveDyn(step.title, c.view, c.subject).length, `${c.lesson}#${i} title`).toBeGreaterThan(0);
        expect(resolveDyn(step.body, c.view, c.subject).length, `${c.lesson}#${i} body`).toBeGreaterThan(0);
        const target = resolveDyn(step.target, c.view, c.subject);
        if (target?.kind === 'dom' && !tagged(target.anchor)) untagged.push(`${c.lesson}#${step.id} → ${target.anchor}`);
      });
    }
    expect(untagged).toEqual([]);
  });

  it('never asks for a click on something that is not there to click', () => {
    for (const lesson of LESSONS) {
      for (const step of lesson.steps) {
        if (step.advance.kind !== 'click') continue;
        const target = resolveDyn(step.target, view(createInitialGameState()), 'gasoline');
        expect(target?.kind, `${lesson.id}#${step.id}`).toBe('dom');
      }
    }
  });

  // Emre, 2026-09-11: "İlk satış tamam!" sat in the middle of the screen
  // saying the money was "up there" in the till, pointing at nothing.
  it('always points at what it talks about — no card left floating mid-screen', () => {
    const floating: string[] = [];
    for (const c of cases()) {
      // The concrete step comes after a parcel has been bought and left bare.
      if (c.lesson === 'buy_land') c.view.state.station.plots.ownedParcels.push('0,2');
      for (const step of lessonById(c.lesson)!.steps) {
        if (resolveDyn(step.target, c.view, c.subject) === null) floating.push(`${c.lesson}#${step.id}`);
      }
    }
    expect([...new Set(floating)]).toEqual([]);
  });

  it('ends the first sale on the till', () => {
    const steps = lessonById('first_customer')!.steps;
    const last = steps[steps.length - 1];
    expect(resolveDyn(last.target, view(createInitialGameState()), 'car')).toEqual({ kind: 'dom', anchor: 'cash' });
  });
});

describe('when a lesson offers itself', () => {
  it('offers the first-customer lesson for the car that is actually waiting, and not before', () => {
    let value = 7 >>> 0;
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      value = (value * 1664525 + 1013904223) % 4294967296;
      return value / 4294967296;
    });
    try {
      const state = createInitialGameState();
      state.dayState.timeSpeed = 1;
      const effects = createEffects();
      let offeredEarly = false;
      let waitingId: string | null = null;

      for (let i = 0; i < 2400 && !waitingId; i++) {
        runSimulationTick(state, 0.05, effects);
        const waiting = Object.values(state.vehicles).find((v) => v.state === 'AT_PUMP' || v.state === 'REQUEST');
        const offer = lessonToStart(view(state));
        if (!waiting) {
          if (offer) offeredEarly = true;
          continue;
        }
        waitingId = waiting.id;
        expect(offer).toEqual({ id: 'first_customer', subject: waiting.id });
      }

      expect(waitingId).not.toBeNull();
      expect(offeredEarly).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('stays out of the way: an open menu teaches only itself, and nothing starts over the land map or with lessons off', () => {
    const state = createInitialGameState();
    state.tanks.gasoline.stock = 0;
    expect(lessonToStart(view(state))?.id).toBe('fuel_order');
    // The player opened İnşaat: its own lesson, never the tank's.
    expect(lessonToStart(view(state, { activeModal: 'BUILD', tabs: { ...NO_TABS, build: 'station' } }))?.id).toBe('build_panel');
    expect(lessonToStart(view(state, { buildModeActive: true }))?.id).toBe('placement');
    // A menu no lesson teaches holds everything back.
    expect(lessonToStart(view(state, { activeModal: 'SETTINGS' }))).toBeNull();
    expect(lessonToStart(view(state, { landMode: { active: true, intent: 'BUY' } }))).toBeNull();
    state.settings.lessonsOff = true;
    expect(lessonToStart(view(state))).toBeNull();
  });

  it('does not repeat a lesson that was finished or skipped, nor teach what the save has already done', () => {
    const state = createInitialGameState();
    state.tanks.gasoline.stock = 0;
    state.settings.lessonsDone = ['fuel_order'];
    expect(lessonToStart(view(state))).toBeNull();

    state.settings.lessonsDone = [];
    state.fuelPurchaseHistory.push({ id: 'r', day: 1, fuelType: 'gasoline', liters: 500, unitCost: 70, totalCost: 35450, supplierId: 'standart', deliveredAt: 0 });
    expect(lessonToStart(view(state))).toBeNull();
  });

  it('calls a tanker lesson at a quarter of the tank, for a fuel the pumps sell, with the cash for one', () => {
    const state = createInitialGameState();
    const tank = state.tanks.gasoline;
    expect(LOW_TANK_SHARE).toBe(0.25);

    tank.stock = tank.capacity * LOW_TANK_SHARE + 1;
    expect(lessonToStart(view(state))).toBeNull();
    tank.stock = tank.capacity * LOW_TANK_SHARE;
    expect(lessonToStart(view(state))).toEqual({ id: 'fuel_order', subject: 'gasoline' });

    // A dry tank no nozzle draws from is waiting for its pump, not running low.
    tank.stock = tank.capacity;
    state.tanks.diesel.capacity = 1500;
    state.tanks.diesel.stock = 0;
    expect(lessonToStart(view(state))).toBeNull();

    // Fifty litres and the delivery fee, or the order button would be dead.
    tank.stock = 0;
    const conf = GAME_CONFIG.fuels.gasoline;
    const unit = state.pricing.gasoline.todayWholesaleCost ?? conf.baseWholesale;
    state.player.cash = conf.deliveryFee + unit * 50 - 1;
    expect(lessonToStart(view(state))).toBeNull();
    state.player.cash = conf.deliveryFee + unit * 50;
    expect(lessonToStart(view(state))).toEqual({ id: 'fuel_order', subject: 'gasoline' });
  });

  it('offers the attendant at level 3 with the hire in the till, and only until one is hired', () => {
    const state = createInitialGameState();
    const hire = GAME_CONFIG.employees.pumpAttendant.tierLevels[0].hireCost;
    state.player.cash = hire;
    state.player.level = 2;
    expect(lessonToStart(view(state))).toBeNull();
    state.player.level = 3;
    expect(lessonToStart(view(state))).toEqual({ id: 'hire_attendant', subject: 'attendant' });
    state.player.cash = hire - 1;
    expect(lessonToStart(view(state))).toBeNull();

    state.player.cash = hire;
    state.employees.e1 = { id: 'e1', role: 'PUMP_ATTENDANT', assignedPumpId: 'pump_1' } as never;
    expect(lessonToStart(view(state))).toBeNull();
  });

  it('offers the manager at his level, then his settings once he is hired', () => {
    const state = createInitialGameState();
    state.employees.e1 = { id: 'e1', role: 'PUMP_ATTENDANT', assignedPumpId: 'pump_1' } as never;
    state.player.level = GAME_CONFIG.employees.manager.minLevel - 1;
    expect(lessonToStart(view(state))).toBeNull();
    state.player.level = GAME_CONFIG.employees.manager.minLevel;
    expect(lessonToStart(view(state))).toEqual({ id: 'manager_hire', subject: 'manager' });

    state.station.managerId = 'mgr';
    expect(lessonToStart(view(state))).toEqual({ id: 'manager_setup', subject: 'manager' });
    // A manager already long at work was set up by someone who found the settings.
    state.managerLogs = Array.from({ length: 21 }, (_, i) => ({ id: `l${i}` })) as never;
    expect(lessonToStart(view(state))).toBeNull();
  });

  it('offers land from day two, once the cheapest parcel and its concrete are in the till', () => {
    const state = createInitialGameState();
    state.player.cash = 9_000_000;
    expect(lessonToStart(view(state))).toBeNull();
    state.dayState.currentDay = 2;
    expect(lessonToStart(view(state))).toEqual({ id: 'buy_land', subject: '4' });

    // The cheapest ready parcel on a new station: the back row at ₺53.000,
    // plus ₺17.500 of concrete.
    state.player.cash = 70_499;
    expect(lessonToStart(view(state))).toBeNull();
    state.player.cash = 70_500;
    expect(lessonToStart(view(state))).toEqual({ id: 'buy_land', subject: '4' });
  });

  it('puts the car before the tank when both come up at once', () => {
    const state = createInitialGameState();
    state.tanks.gasoline.stock = 0;
    state.vehicles.car = {
      id: 'car',
      state: 'REQUEST',
      targetPumpId: 'pump_1',
      request: { mode: 'MONEY', targetValue: 200 }
    } as never;
    expect(lessonToStart(view(state))).toEqual({ id: 'first_customer', subject: 'car' });
  });
});

describe('the lesson clock', () => {
  it('holds on a step that points, and runs at the player’s pace — or normal, if paused — on one that waits', () => {
    const pointing = lessonById('first_customer')!.steps[0];
    const pouring = lessonById('first_customer')!.steps.find((s) => s.id === 'pouring')!;
    expect(lessonClock(pointing, 1)).toBe(0);
    expect(lessonClock(pouring, 1)).toBe(1);
    expect(lessonClock(pouring, 0.5)).toBe(0.5);
    expect(lessonClock(pouring, 0)).toBe(1);
  });
});

/**
 * Emre, 2026-09-11: "oyuncu merak edip inşaata tıkladığı an ders başlasın" —
 * every panel teaches itself the first time it is opened, whatever the level.
 */
describe('panel lessons', () => {
  const learn = (state: GameState, ...ids: string[]) => {
    state.settings.lessonsDone = [...(state.settings.lessonsDone ?? []), ...ids];
  };

  it('start the first time each panel is opened, on a level-1 station', () => {
    const state = createInitialGameState();
    expect(state.player.level).toBe(1);
    expect(lessonToStart(view(state, { activeModal: 'BUILD', tabs: { ...NO_TABS, build: 'station' } }))).toEqual({ id: 'build_panel', subject: 'build' });
    expect(lessonToStart(view(state, { activeModal: 'OFFICE', tabs: { ...NO_TABS, office: 'summary' } }))).toEqual({ id: 'office_panel', subject: 'office' });
    expect(lessonToStart(view(state, { activeModal: 'STAFF', tabs: { ...NO_TABS, staff: 'attendants' } }))).toEqual({ id: 'staff_panel', subject: 'staff' });
    expect(lessonToStart(view(state, { activeModal: 'FUEL_ORDER' }))).toEqual({ id: 'order_panel', subject: 'gasoline' });
    expect(lessonToStart(view(state, { selectedPumpId: 'pump_1' }))).toEqual({ id: 'pump_card', subject: 'pump_1' });
  });

  it('teach each tab the first time it is shown, once the panel itself has been', () => {
    const state = createInitialGameState();
    const build = (tab: string) => lessonToStart(view(state, { activeModal: 'BUILD', tabs: { ...NO_TABS, build: tab } }));
    expect(build('service')?.id).toBe('build_panel');
    learn(state, 'build_panel');
    expect(build('station')).toBeNull();
    expect(build('service')).toEqual({ id: 'build_facilities', subject: 'service' });
    expect(build('energy')).toEqual({ id: 'build_energy', subject: 'energy' });
    expect(build('land')).toBeNull();

    const office = (tab: string, loans = false) =>
      lessonToStart(view(state, { activeModal: 'OFFICE', tabs: { ...NO_TABS, office: tab, officeLoans: loans } }));
    learn(state, 'office_panel');
    expect(office('summary')?.id).toBe('office_summary');
    expect(office('price')?.id).toBe('office_price');
    expect(office('accounts')?.id).toBe('office_accounts');
    // The loans page is taught from inside the Muhasebe lesson, not on its own.
    expect(office('accounts', true)).toBeNull();
    expect(office('missions')?.id).toBe('office_missions');
    expect(office('maintenance')?.id).toBe('office_maintenance');
  });

  it('tell a facility card from a structure card, and leave buildings that open the office alone', () => {
    const state = withBuilding(withBuilding(createInitialGameState(), 'market', 'mini_market', [10, 10], [5, 4]), 'pole', 'light_pole', [3, 3], [1, 1]);
    expect(lessonToStart(view(state, { selectedBuildingId: 'market' }))).toEqual({ id: 'facility_card', subject: 'market' });
    expect(lessonToStart(view(state, { selectedBuildingId: 'pole' }))).toEqual({ id: 'structure_card', subject: 'pole' });
    const office = Object.values(state.buildings).find((b) => b.type === 'office')!;
    expect(lessonToStart(view(state, { selectedBuildingId: office.id }))).toBeNull();
  });

  it('are still offered in the quiet spell after a lesson, while the game holds its own back', () => {
    const state = createInitialGameState();
    state.tanks.gasoline.stock = 0;
    expect(lessonToStart(view(state), undefined, { panelsOnly: true })).toBeNull();
    expect(lessonToStart(view(state, { activeModal: 'FUEL_ORDER' }), undefined, { panelsOnly: true })).toEqual({
      id: 'order_panel',
      subject: 'gasoline'
    });
  });

  it('do not explain the order panel twice', () => {
    const lesson = lessonById('fuel_order')!;
    const state = createInitialGameState();
    const door = lesson.steps.findIndex((s) => s.id === 'door');
    expect(lesson.steps[firstLessonStep(lesson, view(state), 'gasoline', door + 1)].id).toBe('row');
    learn(state, 'order_panel');
    expect(lesson.steps[firstLessonStep(lesson, view(state), 'gasoline', door + 1)].id).toBe('buy');
    expect(lesson.covers).toEqual(['order_panel']);
  });

  it('walk a canopy on only when one can be fitted, and panels only onto an open pump with a roof', () => {
    const lesson = lessonById('build_energy')!;
    const close = lesson.steps.findIndex((s) => s.id === 'close');
    const state = createInitialGameState();
    // Level 1: the lesson tells, and ends where the doing would begin.
    expect(firstLessonStep(lesson, view(state, { activeModal: 'BUILD' }), 'energy', close)).toBe(lesson.steps.length);

    state.player.level = GAME_CONFIG.buildings.canopy.unlockLevel;
    state.player.cash = GAME_CONFIG.buildings.canopy.price;
    expect(lesson.steps[firstLessonStep(lesson, view(state, { activeModal: 'BUILD' }), 'energy', close)].id).toBe('close');

    const canopyStep = lesson.steps.findIndex((s) => s.id === 'canopy');
    expect(lesson.steps[firstLessonStep(lesson, view(state, { selectedPumpId: 'pump_1' }), 'energy', canopyStep)].id).toBe('canopy');
    state.pumps.pump_1.hasCanopy = true;
    expect(lesson.steps[firstLessonStep(lesson, view(state, { selectedPumpId: 'pump_1' }), 'energy', canopyStep)].id).toBe('panels');
    expect(firstLessonStep(lesson, view(state), 'energy', canopyStep)).toBe(lesson.steps.length);
  });

  // Emre, 2026-09-12: pressed the lit back arrow on the loans page and the
  // card stayed put — the step waited for Bitir while its arrow had gone.
  it('ends the loans tour when the player takes the lit arrow back to Muhasebe', () => {
    const lesson = lessonById('office_accounts')!;
    const back = lesson.steps[lesson.steps.length - 1];
    expect(back.id).toBe('back');
    expect(back.target).toEqual({ kind: 'dom', anchor: 'loans-back' });
    expect(back.advance.kind).toBe('until');

    const state = createInitialGameState();
    const done = (back.advance as { done: (v: LessonView, s: string) => boolean }).done;
    const onLoans = view(state, { activeModal: 'OFFICE', tabs: { ...NO_TABS, office: 'accounts', officeLoans: true } });
    const backOnAccounts = view(state, { activeModal: 'OFFICE', tabs: { ...NO_TABS, office: 'accounts', officeLoans: false } });
    expect(done(onLoans, 'accounts')).toBe(false);
    expect(done(backOnAccounts, 'accounts')).toBe(true);
  });
});
