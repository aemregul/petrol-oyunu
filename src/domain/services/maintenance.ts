import { GAME_CONFIG } from '../../config/gameConfig';

/** One paid cleaning crew restores at most this many displayed percentage points. */
export const SITE_CLEANING_STEP = 25;

/**
 * The maintenance desk sells the remaining work as one job. Fractions are
 * first rounded exactly like the percentage shown to the player, then every
 * started 25-point block is charged at the configured cleaning rate.
 */
export function siteCleaningCost(cleanliness: number): number {
  const displayed = Math.max(0, Math.min(100, Math.round(cleanliness)));
  const blocks = Math.ceil((100 - displayed) / SITE_CLEANING_STEP);
  return blocks * GAME_CONFIG.economy.siteCleanCost;
}
