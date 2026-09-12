import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';
import { lessonById } from '../ui/lessons/lessons';
import type { LessonView } from '../ui/lessons/lessonTypes';
import type { VehicleEntity } from '../domain/types/gameState';

/**
 * Emre, 2026-09-11: a lesson waits on what the player really does. These run
 * the first-customer lesson against the store's own actions — the same ones
 * the car, the nozzle and the hand-over button call — so a step whose
 * condition no longer matches the game is caught here, not by a player
 * staring at a card that never moves on.
 */

function customer(): VehicleEntity {
  return {
    id: 'manual_customer',
    archetype: 'family',
    modelVariant: 'sedan',
    fuelType: 'gasoline',
    tankCapacity: 50,
    currentFuel: 20,
    request: {
      mode: 'MONEY',
      targetValue: 250,
      calculatedLiters: 250 / 45,
      calculatedPrice: 250,
      dispensedLiters: 0,
      isFinished: false
    },
    patience: 100,
    maxPatience: 100,
    satisfaction: 100,
    state: 'AT_PUMP',
    targetPumpId: 'pump_1',
    assignedActor: null,
    worldPosition: [8.5, 0, 5.6],
    targetWaypoint: null,
    route: [],
    heading: 0,
    speed: 0,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  };
}

const store = () => useGameStore.getState();

function viewNow(): LessonView {
  const s = store();
  return {
    state: s.gameState,
    activeModal: s.activeModal,
    selectedVehicleId: s.selectedVehicleId,
    selectedPumpId: s.selectedPumpId,
    selectedBuildingId: s.selectedBuildingId,
    landMode: { active: s.landMode.active, intent: s.landMode.intent },
    buildModeActive: s.buildMode.active,
    buildPinned: s.buildMode.pinned,
    tourActive: s.tour.active,
    tabs: { build: null, staff: null, office: null, officeLoans: false }
  };
}

/** The running step's id. */
function stepId(): string {
  const { lesson } = store();
  return lessonById(lesson.id)!.steps[lesson.step].id;
}

/** Whether the running step's condition holds, asked the way the director asks it. */
function stepDone(): boolean {
  const { lesson } = store();
  const step = lessonById(lesson.id)!.steps[lesson.step];
  return step.advance.kind === 'until' && step.advance.done(viewNow(), lesson.subject);
}

function advanceTo(id: string): void {
  for (let i = 0; i < 20 && stepId() !== id; i++) store().advanceLesson();
  expect(stepId()).toBe(id);
}

beforeEach(() => {
  const state = createInitialGameState();
  const vehicle = customer();
  state.tanks.gasoline.stock = 1500;
  state.pumps.pump_1.currentVehicleId = vehicle.id;
  state.pumps.pump_1.state = 'REQUEST_READY';
  state.vehicles[vehicle.id] = vehicle;
  state.dayState.timeSpeed = 1;
  useGameStore.setState({
    gameState: state,
    activeModal: 'NONE',
    selectedVehicleId: null,
    selectedPumpId: null,
    tour: { active: false, step: 0, resumeSpeed: 1 },
    lesson: { id: null, step: 0, subject: '', resumeSpeed: 1, endedAt: 0 }
  });
});

describe('the first-customer lesson, played through', () => {
  it('moves on for each thing the player really does, from the bay to the till', () => {
    store().startLesson('first_customer', 'manual_customer');
    expect(stepId()).toBe('arrived');
    expect(store().gameState.dayState.timeSpeed).toBe(0);
    expect(stepDone()).toBe(false);

    store().openFuelingPanelForVehicle('manual_customer');
    expect(stepDone()).toBe(true);
    store().advanceLesson();

    expect(stepId()).toBe('request');
    store().advanceLesson();
    // The nozzle is a press on the lit button; the overlay moves it on.
    expect(stepId()).toBe('nozzle');
    store().advanceLesson();

    expect(stepId()).toBe('start');
    expect(stepDone()).toBe(false);
    store().startVehicleFueling('manual_customer', 'MONEY', 250);
    expect(stepDone()).toBe(true);
    store().advanceLesson();

    // The pour needs the clock; everything that points holds it.
    expect(stepId()).toBe('pouring');
    expect(store().gameState.dayState.timeSpeed).toBe(1);
    let ticks = 0;
    while (!stepDone() && ticks < 400) {
      store().simulationTick(0.05);
      ticks++;
    }
    expect(ticks).toBeGreaterThan(0);
    expect(stepDone()).toBe(true);
    store().advanceLesson();

    expect(stepId()).toBe('finished');
    expect(store().gameState.dayState.timeSpeed).toBe(0);
    store().openFuelingPanelForVehicle('manual_customer');
    expect(stepDone()).toBe(true);
    store().advanceLesson();

    expect(stepId()).toBe('squeegee');
    store().advanceLesson();

    expect(stepId()).toBe('handover');
    expect(stepDone()).toBe(false);
    store().completeVehicleFueling('manual_customer');
    expect(stepDone()).toBe(true);
    store().advanceLesson();

    expect(stepId()).toBe('done');
    store().advanceLesson();

    const after = store();
    expect(after.lesson.id).toBeNull();
    expect(after.gameState.settings.lessonsDone).toEqual(['first_customer']);
    expect(after.gameState.player.statistics.totalCustomersServed).toBe(1);
    expect(after.gameState.dayState.timeSpeed).toBe(1);
  });

  it('is dropped, to be offered again, when the car it is about drives off', () => {
    store().startLesson('first_customer', 'manual_customer');
    const lesson = lessonById('first_customer')!;
    expect(lesson.abandon!(viewNow(), 'manual_customer', 0)).toBeNull();

    const state = JSON.parse(JSON.stringify(store().gameState));
    state.vehicles.manual_customer.state = 'EXIT';
    useGameStore.setState({ gameState: state });
    expect(lesson.abandon!(viewNow(), 'manual_customer', 0)).toBe('retry');
  });
});

describe('lessons in the store', () => {
  it('gives the player back their own pace, and pours a paused player’s fuel at normal speed', () => {
    for (const pace of [0.5, 0] as const) {
      const state = JSON.parse(JSON.stringify(store().gameState));
      state.dayState.timeSpeed = pace;
      useGameStore.setState({ gameState: state, lesson: { id: null, step: 0, subject: '', resumeSpeed: 1, endedAt: 0 } });

      store().startLesson('first_customer', 'manual_customer');
      expect(store().lesson.resumeSpeed).toBe(pace);
      expect(store().gameState.dayState.timeSpeed).toBe(0);

      advanceTo('pouring');
      expect(store().gameState.dayState.timeSpeed).toBe(pace === 0 ? 1 : pace);

      store().endLesson('skipped');
      expect(store().gameState.dayState.timeSpeed).toBe(pace);
    }
  });

  it('remembers a finished or skipped lesson, but not one that lost what it was about', () => {
    store().startLesson('first_customer', 'manual_customer');
    store().endLesson('lost');
    expect(store().gameState.settings.lessonsDone ?? []).toEqual([]);
    expect(store().lesson.id).toBeNull();
    expect(store().lesson.endedAt).toBeGreaterThan(0);

    store().startLesson('first_customer', 'manual_customer');
    store().endLesson('skipped');
    expect(store().gameState.settings.lessonsDone).toEqual(['first_customer']);

    store().resetLessons();
    expect(store().gameState.settings.lessonsDone).toEqual([]);
    expect(store().gameState.settings.lessonsOff).toBe(false);
  });

  it('keeps the speed buttons off the clock while a lesson holds it', () => {
    store().startLesson('first_customer', 'manual_customer');
    store().setTimeSpeed(1);
    expect(store().gameState.dayState.timeSpeed).toBe(0);
    store().endLesson('skipped');
    store().setTimeSpeed(0.5);
    expect(store().gameState.dayState.timeSpeed).toBe(0.5);
  });

  it('never starts over a running lesson or the old tour, and clears a pump card before pointing', () => {
    useGameStore.setState({ selectedPumpId: 'pump_1' });
    store().startLesson('first_customer', 'manual_customer');
    expect(store().selectedPumpId).toBeNull();
    store().startLesson('fuel_order', 'gasoline');
    expect(store().lesson.id).toBe('first_customer');
    store().endLesson('lost');

    useGameStore.setState({ tour: { active: true, step: 0, resumeSpeed: 1 } });
    store().startLesson('fuel_order', 'gasoline');
    expect(store().lesson.id).toBeNull();
  });

  it('puts the lessons a finished one covers behind the player too', () => {
    store().startLesson('fuel_order', 'gasoline');
    store().endLesson('done');
    expect(store().gameState.settings.lessonsDone).toEqual(['fuel_order', 'order_panel']);
  });

  it('keeps the card open for a lesson about the card, and passes over what the card does not show', () => {
    const shown = () => {
      const seen = [stepId()];
      for (let i = 0; i < 10; i++) {
        store().advanceLesson();
        if (!store().lesson.id) break;
        seen.push(stepId());
      }
      return seen;
    };

    useGameStore.setState({ selectedPumpId: 'pump_1' });
    store().startLesson('pump_card', 'pump_1');
    expect(store().selectedPumpId).toBe('pump_1');
    expect(shown()).toEqual(['rows', 'hire', 'upgrade', 'modules', 'canopy']);

    // Every nozzle fitted and a roof on: those two buttons are not on the card.
    const state = JSON.parse(JSON.stringify(store().gameState));
    state.pumps.pump_1.supportedFuels = ['gasoline', 'diesel', 'lpg'];
    state.pumps.pump_1.hasCanopy = true;
    state.settings.lessonsDone = [];
    useGameStore.setState({ gameState: state, selectedPumpId: 'pump_1', lesson: { id: null, step: 0, subject: '', resumeSpeed: 1, endedAt: 0 } });
    store().startLesson('pump_card', 'pump_1');
    expect(shown()).toEqual(['rows', 'hire', 'upgrade']);
  });
});
