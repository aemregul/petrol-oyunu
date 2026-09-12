import type { GameState } from '../../domain/types/gameState';

/**
 * Lessons (Emre, 2026-09-11): the first-run tour was long, and most players
 * in testing did not read it. The game now teaches each thing at the moment
 * it is needed — the first car at the pump, the first tank running low, the
 * first time a panel is opened — by lighting the one thing to press, waiting
 * for the press, and saying in a line or two what the panel it opens is for.
 */

/**
 * Which tab each tabbed panel is showing. The tabs are the panels' own state;
 * they report it here so a lesson can teach a tab the first time it is opened.
 */
export interface OpenTabs {
  build: string | null;
  staff: string | null;
  office: string | null;
  /** The loans desk, a page behind the office's Muhasebe tab. */
  officeLoans: boolean;
}

/** What a lesson can see: the save, and the few pieces of screen state its steps wait on. */
export interface LessonView {
  state: GameState;
  activeModal: string;
  selectedVehicleId: string | null;
  selectedPumpId: string | null;
  selectedBuildingId: string | null;
  landMode: { active: boolean; intent: 'BUY' | 'PAVE' };
  buildModeActive: boolean;
  /** The building being placed has been put down on a spot and awaits Yerleştir. */
  buildPinned: boolean;
  tourActive: boolean;
  tabs: OpenTabs;
}

/**
 * Where a lesson starts: in one of the panels, the first time the player
 * opens it. A lesson with no panel starts when its situation comes up, with
 * nothing else open.
 */
export type LessonPanel =
  | 'BUILD'
  | 'OFFICE'
  | 'STAFF'
  | 'FUEL_ORDER'
  | 'PUMP_CARD'
  | 'FACILITY_CARD'
  | 'STRUCTURE_CARD'
  | 'PLACEMENT';

/**
 * A box standing in the scene: centre and half-extents in simulation grid
 * units, height in scene units (the scene draws a grid unit as two).
 */
export interface WorldBox {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  top: number;
}

export type LessonTarget =
  /** A piece of the HUD or a panel, tagged `data-tour="…"`. */
  | { kind: 'dom'; anchor: string }
  /** Something in the scene, re-projected onto the screen every frame. */
  | { kind: 'world'; box: WorldBox };

/** Either a value, or one worked out from the moment the step is shown. */
export type Dyn<T> = T | ((view: LessonView, subject: string) => T);

export type LessonAdvance =
  /** The player reads it and presses İleri. */
  | { kind: 'next' }
  /** The player presses the lit thing. */
  | { kind: 'click' }
  /** Something happens in the game — the panel opened, the pour finished. */
  | { kind: 'until'; done: (view: LessonView, subject: string) => boolean };

/** The few store actions a lit area in the scene can stand in for. */
export interface LessonActions {
  openFuelingPanelForVehicle: (vehicleId: string) => void;
  selectPump: (pumpId: string | null) => void;
}

export interface LessonStep {
  id: string;
  title: Dyn<string>;
  body: Dyn<string[]>;
  target: Dyn<LessonTarget | null>;
  advance: LessonAdvance;
  /**
   * The clock runs on this step. Off by default: a step that points at
   * something stops the world, so the customer being explained does not
   * drive off while the player reads about them.
   */
  clockRuns?: boolean;
  /**
   * The screen stays usable: no dimming, the thing is only ringed. For steps
   * that wait on the world rather than on one press.
   */
  open?: boolean;
  /**
   * A press anywhere in the lit area does this. For things in the scene: the
   * player clicks the lit car, not the exact pixels of its roof, and a ray
   * that slips past the bodywork onto the ground behind it counted as a
   * click on nothing (Emre, 2026-09-11 — found playing the lesson through).
   */
  press?: (actions: LessonActions, view: LessonView, subject: string) => void;
  /**
   * Passed over when it has nothing to say here: a button this pump does not
   * show, a panel another lesson has already explained.
   */
  skip?: (view: LessonView, subject: string) => boolean;
}

/** Why a lesson stopped part-way: try again next time, or never mind. */
export type LessonAbandon = 'retry' | 'skip' | null;

export interface Lesson {
  id: string;
  title: string;
  /** Opens with this panel; see LessonPanel. */
  panel?: LessonPanel;
  /**
   * Lessons this one also teaches in full: finishing or skipping it puts them
   * behind the player too, so the same cards are not shown twice.
   */
  covers?: string[];
  /**
   * What the lesson is about when it should start now — a car's id, a fuel,
   * a count to measure progress against — or null when it should not.
   */
  subject: (view: LessonView) => string | null;
  /** A save that has already done this thing has nothing to learn from it. */
  known: (state: GameState) => boolean;
  /** Checked every moment the lesson runs: has the situation it teaches gone? */
  abandon?: (view: LessonView, subject: string, step: number) => LessonAbandon;
  steps: LessonStep[];
}

export function resolveDyn<T>(value: Dyn<T>, view: LessonView, subject: string): T {
  return typeof value === 'function'
    ? (value as (view: LessonView, subject: string) => T)(view, subject)
    : value;
}
