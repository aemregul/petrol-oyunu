/**
 * Launches the running dev server in a headless browser, drives the game for a
 * while and saves a screenshot. Useful for checking rendering changes without
 * having to eyeball the app by hand.
 *
 *   npm run dev                       # in another terminal
 *   node scripts/screenshot.mjs out.png --seconds 20 --hour 13
 *
 * --hour seeds a save so the day is already underway (busy station, staff
 * hired, several pumps), which shows far more than a fresh level-1 game.
 */

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) || 'screenshot.png';

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
}

const seconds = flag('seconds', 15);
const hour = flag('hour', null);
const port = flag('port', 3000);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

if (hour !== null) {
  await page.addInitScript((h) => {
    localStorage.setItem(
      'project_highway_v1_save',
      JSON.stringify({
        schemaVersion: 1,
        dayState: { currentDay: 4, gameTime: h, timeSpeed: 2, isDayActive: true, weather: 'SUNNY' },
        player: { level: 6, xp: 5200, cash: 90000, reputation: 4.2 },
        tanks: {
          gasoline: { id: 'tank_gasoline_1', fuelType: 'gasoline', level: 2, capacity: 3000, stock: 2400, reservedStock: 0, averageCost: 36.4, health: 100 },
          diesel: { id: 'tank_diesel_1', fuelType: 'diesel', level: 1, capacity: 1500, stock: 1200, reservedStock: 0, averageCost: 35.6, health: 100 }
        },
        pumps: {
          pump_1: { id: 'pump_1', level: 2, position: [10, 10], rotation: 0, supportedFuels: ['gasoline', 'diesel'], state: 'IDLE', health: 92, employeeId: null, currentVehicleId: null, flowRateLps: 10 },
          pump_2: { id: 'pump_2', level: 1, position: [16, 10], rotation: 0, supportedFuels: ['gasoline'], state: 'IDLE', health: 78, employeeId: null, currentVehicleId: null, flowRateLps: 8 },
          pump_3: { id: 'pump_3', level: 3, position: [22, 10], rotation: 0, supportedFuels: ['gasoline', 'diesel'], state: 'IDLE', health: 100, employeeId: null, currentVehicleId: null, flowRateLps: 13 }
        },
        employees: {
          emp_a: { id: 'emp_a', name: 'Ahmet Usta', role: 'PUMP_ATTENDANT', level: 3, wage: 1050, assignedPumpId: 'pump_1', state: 'IDLE', serviceCount: 40, currentVehicleId: null, actionTimerSeconds: 0, worldPosition: [10, 0, 10] },
          emp_b: { id: 'emp_b', name: 'Can Usta', role: 'PUMP_ATTENDANT', level: 2, wage: 800, assignedPumpId: 'pump_2', state: 'IDLE', serviceCount: 12, currentVehicleId: null, actionTimerSeconds: 0, worldPosition: [16, 0, 10] }
        },
        vehicles: {}
      })
    );
  }, hour);
}

await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(seconds * 1000);

const hud = await page.evaluate(() => ({
  fps: document.body.innerText.match(/(\d+)\s*FPS/)?.[1],
  drawCalls: document.body.innerText.match(/Draw Calls:\s*(\d+)/)?.[1],
  vehicles: document.body.innerText.match(/Araç:\s*(\d+)/)?.[1],
  clock: document.body.innerText.match(/(\d{2}:\d{2})/)?.[1]
}));

console.log(JSON.stringify(hud));
console.log(errors.length ? 'Hatalar:\n' + errors.slice(0, 10).join('\n') : 'Konsol hatası yok');

await page.screenshot({ path: out });
await browser.close();
console.log(`Kaydedildi: ${out}`);
