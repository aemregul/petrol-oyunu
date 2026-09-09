/**
 * How many steps the tour has, kept apart from the steps themselves so the
 * store can end the tour without importing the UI (tourSteps reads
 * EDIT_MODE_LEVEL from the store, which would make a cycle).
 */
export const TOUR_STEP_COUNT = 13;
