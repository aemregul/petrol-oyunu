import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const DIR = '/private/tmp/claude-501/-Users-emre-petrol-oyunu/063dec48-3607-4384-806a-470686a3254d/scratchpad';
const save = readFileSync(`${DIR}/mech.json`, 'utf8').trim();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript((d) => localStorage.setItem('project_highway_v1_save', d), save);
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

// Order all we can, then watch overlaps + exits + the day rollover.
await page.evaluate(() => {
  const st = window.__store.getState();
  st.gameState.player.cash = 900000;
  st.orderFuel('gasoline', 1000);
});
const report = await page.evaluate(async () => {
  let minTruckCar = Infinity, minTruckTruck = Infinity;
  const exits = [];
  let dayFlips = 0, lastDay = window.__store.getState().gameState.dayState.currentDay;
  let vehiclesAtFlip = -1, activeAtFlip = null;
  const seenExit = new Set();
  for (let i = 0; i < 320; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const gs = window.__store.getState().gameState;
    if (gs.dayState.currentDay !== lastDay) {
      dayFlips++; lastDay = gs.dayState.currentDay;
      vehiclesAtFlip = Object.keys(gs.vehicles).length;
      activeAtFlip = gs.dayState.isDayActive;
    }
    const trucks = gs.fuelOrders.filter((o) => o.truck).map((o) => o.truck);
    for (const t of trucks) {
      const dx = Math.sin(t.heading), dz = Math.cos(t.heading);
      for (const a of [-1.1, 0, 1.1]) {
        const bx = t.worldPosition[0] + dx * a, bz = t.worldPosition[2] + dz * a;
        for (const v of Object.values(gs.vehicles))
          minTruckCar = Math.min(minTruckCar, Math.hypot(v.worldPosition[0]-bx, v.worldPosition[2]-bz));
      }
    }
    for (let a = 0; a < trucks.length; a++) for (let b = a+1; b < trucks.length; b++)
      minTruckTruck = Math.min(minTruckTruck, Math.hypot(trucks[a].worldPosition[0]-trucks[b].worldPosition[0], trucks[a].worldPosition[2]-trucks[b].worldPosition[2]));
    // Record how far back a leaving car goes: its route's deepest z.
    for (const v of Object.values(gs.vehicles)) {
      if (v.state !== 'EXIT' || seenExit.has(v.id)) continue;
      seenExit.add(v.id);
      const deepest = Math.max(...[v.targetWaypoint, ...v.route].filter(Boolean).map((p) => p[2]));
      exits.push(Number(deepest.toFixed(1)));
    }
  }
  return { minTruckCar, minTruckTruck, exits, dayFlips, vehiclesAtFlip, activeAtFlip,
           modal: window.__store.getState().activeModal };
});
console.log('kamyon-araç en yakın:', report.minTruckCar.toFixed(2));
console.log('kamyon-kamyon en yakın:', report.minTruckTruck === Infinity ? 'aynı anda 1 kamyon' : report.minTruckTruck.toFixed(2));
console.log('çıkış rotalarının en arka z değerleri:', report.exits.slice(0, 12).join(', '));
console.log('gün değişimi:', report.dayFlips, '| değişimde araç:', report.vehiclesAtFlip, '| gün aktif:', report.activeAtFlip, '| modal:', report.modal);
console.log(errors.length ? errors.slice(0, 4) : 'konsol temiz');
await browser.close();
