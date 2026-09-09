/**
 * The station's electricity, worked like its fuel: a contract with the grid
 * that is cheap at night and dear at the evening peak, panels on roofs the
 * station already has, and a generator that burns the diesel it would
 * otherwise sell (Emre, 2026-09-07). None of it is a power plant of its own;
 * every piece hangs off something the forecourt already does.
 */

import { GAME_CONFIG } from '../../config/gameConfig';
import { BuildingEntity, GameState, PumpEntity } from '../types/gameState';

/** True when `hour` falls in a window that may wrap midnight. */
export function inWindow(hour: number, from: number, to: number): boolean {
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** What one kWh from the grid costs at this hour. */
export function gridPriceAt(hour: number): number {
  const { night, peak } = GAME_CONFIG.ev.gridTariff;
  if (inWindow(hour, night.from, night.to)) return night.price;
  if (inWindow(hour, peak.from, peak.to)) return peak.price;
  return GAME_CONFIG.ev.gridPricePerKwh;
}

export function isNightTariff(hour: number): boolean {
  const { night } = GAME_CONFIG.ev.gridTariff;
  return inWindow(hour, night.from, night.to);
}

/** What a substation of this level pulls from the grid, kWh per game hour. */
export function gridKwhPerHourFor(level: number): number {
  const ladder = GAME_CONFIG.ev.gridLevelFactor;
  const factor = ladder[Math.min(ladder.length - 1, Math.max(0, level - 1))];
  return GAME_CONFIG.ev.gridKwhPerHour * factor;
}

/** Cells a roof of this footprint has for panels. */
export function roofCells(size: [number, number]): number {
  return size[0] * size[1];
}

export function solarPrice(size: [number, number]): number {
  return roofCells(size) * GAME_CONFIG.ev.solar.pricePerCell;
}

export function solarUpkeep(size: [number, number]): number {
  return roofCells(size) * GAME_CONFIG.ev.solar.upkeepPerCell;
}

/** What washing one roof of panels costs. */
export function solarCleanCost(size: [number, number]): number {
  return roofCells(size) * GAME_CONFIG.ev.solar.cleanCostPerCell;
}

/** How clean this roof's glass is; a roof from before grime reads as clean. */
export function solarCleanlinessOf(pump: PumpEntity): number {
  return pump.solarCleanliness ?? 100;
}

/** What a roof of this size makes at a clear noon, kWh per game hour. */
export function solarPeakKwhPerHour(size: [number, number]): number {
  return roofCells(size) * GAME_CONFIG.ev.solar.peakKwhPerCell;
}

/**
 * How much of its best a roof gives right now: the sun's arc between sunrise
 * and sunset, the weather over it, and the grime on the glass — a dirty
 * station makes less, which is one more thing cleaning is worth.
 */
export function solarFactor(
  hour: number,
  weather: GameState['dayState']['weather'],
  cleanliness: number
): number {
  const { sunrise, sunset, weather: sky, minGrimeFactor } = GAME_CONFIG.ev.solar;
  if (hour < sunrise || hour >= sunset) return 0;
  const arc = Math.sin(((hour - sunrise) / (sunset - sunrise)) * Math.PI);
  const grime = minGrimeFactor + (1 - minGrimeFactor) * Math.max(0, Math.min(1, cleanliness / 100));
  return arc * (sky[weather] ?? 1) * grime;
}

/** Cells under panels on this block: every canopy that carries them. */
export function solarCellsOn(pumps: PumpEntity[]): number {
  const canopy = GAME_CONFIG.buildings.canopy.size;
  let cells = 0;
  for (const p of pumps) if (p.hasCanopy && p.hasSolarCanopy) cells += roofCells(canopy);
  return cells;
}

/**
 * Diesel the generator may burn without touching the reserve: what is in
 * the tank beyond what queued cars already have a claim on, less the last
 * share kept for customers. It is the same line the critical-stock card
 * draws — the generator never puts the station into that warning.
 */
export function dieselForGenerator(tank: { stock: number; reservedStock: number; capacity: number }): number {
  const reserve = tank.capacity * GAME_CONFIG.ev.generator.reserveShare;
  return Math.max(0, tank.stock - tank.reservedStock - reserve);
}

/** Whether a generator would run given the bank's fill and the diesel. */
export function generatorWants(
  building: Pick<BuildingEntity, 'generatorOff'>,
  bankKwh: number,
  bankCapacity: number,
  dieselAvailable: number
): boolean {
  if (building.generatorOff) return false;
  if (bankCapacity <= 0) return false;
  if (bankKwh / bankCapacity >= GAME_CONFIG.ev.generator.runBelowPercent / 100) return false;
  return dieselAvailable > 0;
}
