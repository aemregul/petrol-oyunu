import { ATTENDANT_HIRE_LEVEL, GAME_CONFIG, upgradePathFor } from '../../config/gameConfig';
import type { FuelType, GameState, VehicleEntity } from '../../domain/types/gameState';
import { vehicleBodyHalfExtents } from '../../domain/services/vehicleBody';
import { facilityTariff, isFacility, nextTariffIndex } from '../../domain/services/facilities';
import {
  STARTING_PARCELS,
  buyableParcels,
  parcelBounds,
  parcelKey,
  parcelPrice,
  paveCost,
  parseParcelKey
} from '../../domain/services/land';
import { openTabs } from './openTabs';
import type {
  Lesson,
  LessonPanel,
  LessonStep,
  LessonTarget,
  LessonView,
  WorldBox
} from './lessonTypes';

/**
 * The lessons, in the order the game offers them when more than one is due.
 * Every line on a card is one the player needs right now, and every figure
 * is read from the config so a card never drifts from the game. The guide
 * behind Ayarlar still says all of it at length.
 *
 * Two kinds. Situation lessons start when the thing they teach comes up —
 * the first car, a tank running low — with nothing else open. Panel lessons
 * start the first time the player opens the panel they teach, at any level
 * (Emre, 2026-09-11: "oyuncu merak edip inşaata tıkladığı an ders başlasın").
 */

const lira = (n: number) => `₺${Math.round(n).toLocaleString('tr-TR')}`;
const dom = (anchor: string): LessonTarget => ({ kind: 'dom', anchor });
const world = (box: WorldBox | null): LessonTarget | null => (box ? { kind: 'world', box } : null);
const next = { kind: 'next' } as const;
const refundPercent = Math.round(GAME_CONFIG.economy.refundRatio * 100);

/** How long the game leaves the player alone after one lesson, before offering the next. */
export const LESSON_GAP_MS = 12_000;

/* ------------------------------------------------------------------ */
/* İlk müşteri                                                         */
/* ------------------------------------------------------------------ */

/** The states a player-served car passes through between the bay and the hand-over. */
const SERVED_STATES: VehicleEntity['state'][] = ['AT_PUMP', 'REQUEST', 'FUELING', 'PAYMENT'];

function attendantOn(state: GameState, pointId: string | null | undefined): boolean {
  return (
    !!pointId &&
    Object.values(state.employees).some((e) => e.role === 'PUMP_ATTENDANT' && e.assignedPumpId === pointId)
  );
}

/** A car and the request card floating over it, as one box to light. */
function carBox(vehicle: VehicleEntity | undefined): WorldBox | null {
  if (!vehicle) return null;
  const body = vehicleBodyHalfExtents(vehicle);
  return {
    x: vehicle.worldPosition[0],
    z: vehicle.worldPosition[2],
    // Heading-agnostic on purpose: a car parked across the view is as long
    // on screen as one parked along it.
    halfX: body.length,
    halfZ: body.length,
    top: 2.6 + body.length * 1.4
  };
}

const car = (view: LessonView, id: string): VehicleEntity | undefined => view.state.vehicles[id];

const customerAtPanel = (view: LessonView, id: string) =>
  view.activeModal === 'CUSTOMER_FUEL' && view.selectedVehicleId === id;

const FIRST_CUSTOMER_STEPS: LessonStep[] = [
  {
    id: 'arrived',
    title: 'Müşteri geldi',
    body: ['Pompaya bir araç yanaştı. Üstüne tıkla, ne istediğine bakalım.'],
    target: (view, id) => world(carBox(car(view, id))),
    advance: { kind: 'until', done: customerAtPanel },
    press: (actions, _view, id) => actions.openFuelingPanelForVehicle(id)
  },
  {
    id: 'request',
    title: 'Ne istiyor?',
    body: (view, id) => {
      const v = car(view, id);
      if (!v) return [];
      const fuel = GAME_CONFIG.fuels[v.fuelType].shortName;
      return [
        v.request.mode === 'FULL'
          ? `Bu müşteri ${fuel} ile depoyu fullemek istiyor.`
          : `Bu müşteri ${lira(v.request.targetValue)}'lik ${fuel} istiyor.`,
        'Her araç farklı bir şey ister; dolumdan önce hep buraya bak.'
      ];
    },
    target: dom('fuel-request'),
    advance: next
  },
  {
    id: 'nozzle',
    title: 'Doğru tabanca',
    body: (view, id) => [
      `${GAME_CONFIG.fuels[car(view, id)?.fuelType ?? 'gasoline'].shortName} tabancasını seç. Yanlış tabancayla dolum başlamaz.`
    ],
    target: (view, id) => dom(`fuel-nozzle-${car(view, id)?.fuelType ?? 'gasoline'}`),
    advance: { kind: 'click' }
  },
  {
    id: 'start',
    title: 'Dolumu başlat',
    body: (view, id) =>
      car(view, id)?.request.mode === 'FULL'
        ? ["Depoyu doldurmak istiyor: FULLE'ye bas."]
        : ["Tutar kutuya hazır geldi: BAŞLAT'a bas."],
    target: (view, id) => dom(car(view, id)?.request.mode === 'FULL' ? 'fuel-full' : 'fuel-start'),
    advance: {
      kind: 'until',
      done: (view, id) => {
        const v = car(view, id);
        return !!v && (v.state === 'FUELING' || v.state === 'PAYMENT');
      }
    }
  },
  {
    id: 'pouring',
    title: 'Yakıt akıyor',
    body: ['Pencere kapandı, dolum kendi kendine sürer. Sayaç aracın üstünde; bu arada başka işine bakabilirsin.'],
    target: (view, id) => world(carBox(car(view, id))),
    advance: {
      kind: 'until',
      done: (view, id) => {
        const v = car(view, id);
        return !!v && (v.request.isFinished || v.state === 'PAYMENT');
      }
    },
    clockRuns: true,
    open: true
  },
  {
    id: 'finished',
    title: 'Dolum bitti',
    body: ['Araca tekrar tıkla, parayı alalım.'],
    target: (view, id) => world(carBox(car(view, id))),
    advance: { kind: 'until', done: customerAtPanel },
    press: (actions, _view, id) => actions.openFuelingPanelForVehicle(id)
  },
  {
    id: 'squeegee',
    title: 'Küçük bir jest',
    body: ['Camları silmek müşteriyi memnun eder, bahşiş ihtimalini artırır. İstersen şimdi bas.'],
    target: dom('fuel-squeegee'),
    advance: next
  },
  {
    id: 'handover',
    title: 'Parayı al',
    body: ["Teslim Et'e bas, satış kasana girsin."],
    target: dom('fuel-handover'),
    advance: {
      kind: 'until',
      done: (view, id) => {
        const v = car(view, id);
        return !v || !SERVED_STATES.includes(v.state);
      }
    }
  },
  {
    id: 'done',
    title: 'İlk satış tamam!',
    body: () => [
      "Satışın parası Kasa'ya girdi. Sıradaki araçlarda da aynı yol: araca tıkla, tabancayı seç, başlat, teslim et.",
      `Seviye ${ATTENDANT_HIRE_LEVEL}'te pompacı tutunca bu işi o yapar.`
    ],
    // A card about the till points at the till (Emre, 2026-09-11: it sat in
    // the middle of the screen saying "up there").
    target: dom('cash'),
    advance: next
  }
];

const HANDOVER_STEP = FIRST_CUSTOMER_STEPS.findIndex((s) => s.id === 'handover');

const firstCustomer: Lesson = {
  id: 'first_customer',
  title: 'İlk müşteri',
  known: (state) => state.player.statistics.totalCustomersServed > 0,
  subject: (view) => {
    const waiting = Object.values(view.state.vehicles).find(
      (v) =>
        (v.state === 'AT_PUMP' || v.state === 'REQUEST') &&
        !v.chargingBuildingId &&
        !v.assignedActor &&
        !attendantOn(view.state, v.targetPumpId)
    );
    return waiting?.id ?? null;
  },
  // The car is the lesson. If it drives off, or an attendant takes it, the
  // lesson waits for the next one rather than pointing at an empty bay.
  abandon: (view, id, step) => {
    if (step >= HANDOVER_STEP) return null;
    const v = car(view, id);
    if (!v || v.assignedActor === 'EMPLOYEE' || !SERVED_STATES.includes(v.state)) return 'retry';
    return null;
  },
  steps: FIRST_CUSTOMER_STEPS
};

/* ------------------------------------------------------------------ */
/* Yakıt siparişi                                                      */
/* ------------------------------------------------------------------ */

/**
 * The share of a tank at which the lesson steps in. Emre asked for it when
 * the fuel runs out; by then customers are already driving off dry, so it
 * comes a little before — with a tanker's journey still to go.
 */
export const LOW_TANK_SHARE = 0.25;

const FUELS: FuelType[] = ['gasoline', 'diesel', 'lpg'];

/** Whether any pump on the station has a nozzle for this fuel. */
const sold = (state: GameState, fuel: FuelType) =>
  Object.values(state.pumps).some((p) => p.supportedFuels.includes(fuel));

/** A fuel the station sells, running low, with nothing on order and the cash to order some. */
function lowTank(state: GameState): FuelType | null {
  for (const fuel of FUELS) {
    const tank = state.tanks[fuel];
    if (!tank || tank.capacity <= 0) continue;
    // Stock nobody can pump is not running low, it is waiting for its nozzle.
    if (!sold(state, fuel)) continue;
    if (tank.stock > tank.capacity * LOW_TANK_SHARE) continue;
    if (state.fuelOrders.some((o) => o.fuelType === fuel)) continue;
    const conf = GAME_CONFIG.fuels[fuel];
    const unit = state.pricing[fuel]?.todayWholesaleCost ?? conf.baseWholesale;
    if (state.player.cash < conf.deliveryFee + unit * 50) continue;
    return fuel;
  }
  return null;
}

const fuelOf = (subject: string) => subject as FuelType;
const learnt = (view: LessonView, id: string) => (view.state.settings.lessonsDone ?? []).includes(id);

/** The cards that explain the order panel, shared by the panel lesson and the low-tank one. */
const ORDER_ROW_STEP: LessonStep = {
  id: 'row',
  title: 'Tank kartı',
  body: ['Çubuk tankın doluluğu, soluk kısmı yoldaki sipariş. Yeşil yazı: alacağın litre ve litre alış fiyatı.'],
  target: (_view, fuel) => dom(`order-row-${fuel}`),
  advance: next
};
const ORDER_AMOUNT_STEP: LessonStep = {
  id: 'amount',
  title: 'Ne kadar?',
  body: [
    `−/+ ${GAME_CONFIG.fuels.gasoline.orderStepLiters} litre oynatır, MAX kasanın ve tankın yettiği kadarını yazar. Kutuya istediğin sayıyı da yazabilirsin.`
  ],
  target: (_view, fuel) => dom(`order-amount-${fuel}`),
  advance: next
};
const ORDER_SUPPLIERS_STEP: LessonStep = {
  id: 'suppliers',
  title: 'Tedarikçi',
  body: [
    'Fiyat ve teslim süresi tedarikçiye göre değişir:',
    GAME_CONFIG.suppliers.map((s) => `${s.name}: ${s.tag}`).join(' · ')
  ],
  target: dom('order-suppliers'),
  advance: next
};

/** Already explained by the panel lesson: the low-tank lesson goes straight to the order. */
const panelTaught = (view: LessonView) => learnt(view, 'order_panel');

const FUEL_ORDER_STEPS: LessonStep[] = [
  {
    id: 'low',
    title: (_view, fuel) => `${GAME_CONFIG.fuels[fuelOf(fuel)].shortName} azalıyor`,
    body: (view, fuel) => [
      `Tankta ${Math.round(view.state.tanks[fuelOf(fuel)].stock).toLocaleString('tr-TR')} L kaldı. Tank boşalınca gelen müşteri yakıt alamadan gider ve itibarın düşer.`,
      'Yakıtı tankerle sen getirtirsin.'
    ],
    target: dom('stock'),
    advance: next
  },
  {
    id: 'door',
    title: 'Tedarik',
    body: ['Yakıt siparişi buradan verilir. Tıkla.'],
    target: dom('fuel'),
    advance: { kind: 'until', done: (view) => view.activeModal === 'FUEL_ORDER' }
  },
  { ...ORDER_ROW_STEP, skip: panelTaught },
  { ...ORDER_AMOUNT_STEP, skip: panelTaught },
  { ...ORDER_SUPPLIERS_STEP, skip: panelTaught },
  {
    id: 'buy',
    title: 'Siparişi ver',
    body: ['Düğmedeki tutar yakıt artı nakliye. Bas, tanker yola çıksın.'],
    target: (_view, fuel) => dom(`order-buy-${fuel}`),
    advance: {
      kind: 'until',
      done: (view, fuel) => view.state.fuelOrders.some((o) => o.fuelType === fuel)
    }
  },
  {
    id: 'close',
    title: 'Tanker yolda',
    body: ['Sipariş verildi. Pencereyi kapat, tankeri izleyelim.'],
    target: dom('order-close'),
    advance: { kind: 'until', done: (view) => view.activeModal === 'NONE' }
  },
  {
    id: 'tanker',
    title: 'Tanker kartı',
    body: [
      'Yolda, tesise giriyor, boşaltılıyor: tankerin nerede olduğu burada yazar. Boşaltma bitince stok dolar.',
      'Tank dörtte bire inmeden sipariş ver ki pompa kurumasın.'
    ],
    target: dom('tanker'),
    advance: next
  }
];

const ORDER_PANEL_STEPS = new Set(['row', 'amount', 'suppliers', 'buy']);

const fuelOrder: Lesson = {
  id: 'fuel_order',
  title: 'Yakıt siparişi',
  covers: ['order_panel'],
  known: (state) => state.fuelPurchaseHistory.length > 0 || state.fuelOrders.length > 0,
  subject: (view) => lowTank(view.state),
  abandon: (view, _fuel, step) =>
    ORDER_PANEL_STEPS.has(FUEL_ORDER_STEPS[step]?.id) && view.activeModal !== 'FUEL_ORDER' ? 'retry' : null,
  steps: FUEL_ORDER_STEPS
};

/* ------------------------------------------------------------------ */
/* Pompacı                                                             */
/* ------------------------------------------------------------------ */

/** The level hiring opens at — the same number every hire button and the store check. */
const ATTENDANT_LEVEL = ATTENDANT_HIRE_LEVEL;
const recruit = GAME_CONFIG.employees.pumpAttendant.tierLevels[0];

const hasAttendant = (state: GameState) =>
  Object.values(state.employees).some((e) => e.role === 'PUMP_ATTENDANT');

const hireAttendant: Lesson = {
  id: 'hire_attendant',
  title: 'Pompacı',
  known: hasAttendant,
  subject: (view) =>
    view.state.player.level >= ATTENDANT_LEVEL &&
    view.state.player.cash >= recruit.hireCost &&
    !hasAttendant(view.state)
      ? 'attendant'
      : null,
  steps: [
    {
      id: 'door',
      title: 'Pompacı tutabilirsin',
      body: [
        `Seviye ${ATTENDANT_LEVEL} oldun. Pompacı pompaya gelen araçları senin yerine doldurur, parayı kasana koyar.`,
        "Personel'e tıkla."
      ],
      target: dom('staff'),
      advance: { kind: 'until', done: (view) => view.activeModal === 'STAFF' }
    },
    {
      id: 'hire',
      title: 'İşe al',
      body: [
        `İşe alım bir kerelik ${lira(recruit.hireCost)}, maaşı günde ${lira(recruit.dailyWage)}. İşe Al'a bas.`
      ],
      target: dom('staff-hire'),
      advance: { kind: 'until', done: (view) => hasAttendant(view.state) }
    },
    {
      id: 'post',
      title: 'Görev yeri',
      body: [
        'Pompacı yeşil yanan pompaya bakar. Yeni pompa kurunca yerini buradan değiştirirsin; Boşta onu kenara alır.'
      ],
      target: dom('staff-post'),
      advance: next
    },
    {
      id: 'train',
      title: 'Eğitim',
      // The closing line lives here rather than on a card of its own: a card
      // with nothing to point at sat in the middle of the screen over the
      // panel it was talking about.
      body: [
        'Yeterince araca hizmet edince eğitim açılır: daha hızlı dolum, daha kısa tepki süresi.',
        'Pompacılı pompaya gelen araçları artık o doldurur; sen başka işe bakarsın.'
      ],
      target: dom('staff-train'),
      advance: next
    }
  ]
};

/* ------------------------------------------------------------------ */
/* İstasyon müdürü                                                     */
/* ------------------------------------------------------------------ */

const manager = GAME_CONFIG.employees.manager;

const managerHire: Lesson = {
  id: 'manager_hire',
  title: 'İstasyon müdürü',
  known: (state) => !!state.station.managerId,
  subject: (view) =>
    view.state.player.level >= manager.minLevel && !view.state.station.managerId ? 'manager' : null,
  steps: [
    {
      id: 'door',
      title: 'İstasyon müdürü',
      body: [
        `Seviye ${manager.minLevel} oldun: istasyonu senin yerine çevirecek bir müdür tutabilirsin.`,
        "Personel'e tıkla."
      ],
      target: dom('staff'),
      advance: { kind: 'until', done: (view) => view.activeModal === 'STAFF' }
    },
    {
      id: 'tab',
      title: 'Müdür sekmesi',
      body: ['İstasyon Müdürü sekmesine tıkla.'],
      target: dom('staff-tab-manager'),
      advance: { kind: 'click' }
    },
    {
      id: 'requirements',
      title: 'Şartlar',
      body: [
        `Hepsi yeşil olmalı: seviye ${manager.minLevel}, itibar ${manager.minReputation.toFixed(2)}, ${manager.minActiveAttendants} pompacı, son üç günün en az ${manager.minProfitableDaysInLast3} tanesinde kâr ve ${lira(manager.hireCost)} işe alım.`,
        'Kırmızı olanlar eksik.'
      ],
      target: dom('manager-requirements'),
      advance: next
    },
    {
      id: 'hire',
      title: 'Göreve başlat',
      body: [
        'Şartlar tamamsa bu düğme açılır. Değilse eksikleri kapatıp buraya dön; müdürü aldığında ayarlarını birlikte yapacağız.'
      ],
      target: dom('manager-hire'),
      advance: next
    }
  ]
};

const managerSetup: Lesson = {
  id: 'manager_setup',
  title: 'Müdürün ayarları',
  // A manager who has already been doing the rounds for a while has been set
  // up by someone who found the settings on their own.
  known: (state) => !!state.station.managerId && state.managerLogs.length > 20,
  subject: (view) => (view.state.station.managerId ? 'manager' : null),
  steps: [
    {
      id: 'door',
      title: 'Müdürün işbaşında',
      body: ["Müdüre ne yapacağını söyleyelim. Personel'e tıkla."],
      target: dom('staff'),
      advance: { kind: 'until', done: (view) => view.activeModal === 'STAFF' }
    },
    {
      id: 'tab',
      title: 'Müdür sekmesi',
      body: ['İstasyon Müdürü sekmesine tıkla.'],
      target: dom('staff-tab-manager'),
      advance: { kind: 'click' }
    },
    {
      id: 'duties',
      title: 'Görevler',
      body: [
        'Tikli görevleri müdür yapar; tıklayıp açar kapatırsın. Kilitli olanlar müdür terfi edince açılır.'
      ],
      target: dom('manager-duties'),
      advance: next
    },
    {
      id: 'threshold',
      title: 'Sipariş eşiği',
      body: ['Tank bu yüzdenin altına inince müdür tanker çağırır.'],
      target: dom('manager-threshold'),
      advance: next
    },
    {
      id: 'reserve',
      title: 'Kasa rezervi',
      body: ['Müdür kasayı bu tutarın altına asla indirmez; maaşlar ve taksitler önce ayrılır.'],
      target: dom('manager-summary'),
      advance: next
    }
  ]
};

/* ------------------------------------------------------------------ */
/* Arsa                                                                */
/* ------------------------------------------------------------------ */

/** A parcel as a flat box on the ground. */
function parcelBox(key: string | null): WorldBox | null {
  if (!key) return null;
  const { col, row } = parseParcelKey(key);
  const b = parcelBounds(col, row);
  return {
    x: (b.minX + b.maxX) / 2,
    z: (b.minZ + b.maxZ) / 2,
    halfX: (b.maxX - b.minX) / 2,
    halfZ: (b.maxZ - b.minZ) / 2,
    top: 0.3
  };
}

/** What a parcel costs to make buildable: the land, then its concrete. */
function readyCost(owned: string[], row: number): number {
  return parcelPrice(owned, row) + paveCost(row);
}

function cheapestForSale(state: GameState): string | null {
  const owned = state.station.plots.ownedParcels;
  const forSale = buyableParcels(owned, state.station.roadLevel);
  if (forSale.length === 0) return null;
  const best = forSale.reduce((a, b) => (readyCost(owned, a.row) <= readyCost(owned, b.row) ? a : b));
  return parcelKey(best.col, best.row);
}

function firstUnpaved(state: GameState): string | null {
  const { ownedParcels, pavedParcels } = state.station.plots;
  return ownedParcels.find((key) => !pavedParcels.includes(key)) ?? null;
}

const LAND_MAP_STEPS = new Set(['pick', 'pour']);

const BUY_LAND_STEPS: LessonStep[] = [
  {
    id: 'door',
    title: 'Büyüme zamanı',
    body: ["Kasan yeni bir arsaya yetiyor. Arsa İnşaat'tan alınır. Tıkla."],
    target: dom('build'),
    advance: { kind: 'until', done: (view) => view.activeModal === 'BUILD' }
  },
  {
    id: 'tab',
    title: 'Arsa',
    body: ['Arsa sekmesine tıkla.'],
    target: dom('build-tab-land'),
    advance: { kind: 'click' }
  },
  {
    id: 'card',
    title: 'Arsa Satın Al',
    body: ['Yola bakan parseller pahalı, arkadakiler ucuz. Tıkla, harita açılsın.'],
    target: dom('land-buy'),
    advance: { kind: 'until', done: (view) => view.landMode.active && view.landMode.intent === 'BUY' }
  },
  {
    id: 'pick',
    title: 'Satılık parseller',
    body: ['Mavi çerçeveli parseller satılık; üstüne gelince fiyatı yazar. Birine tıkla.'],
    target: (view) => world(parcelBox(cheapestForSale(view.state))),
    advance: {
      kind: 'until',
      done: (view, ownedAtStart) => view.state.station.plots.ownedParcels.length > Number(ownedAtStart)
    },
    open: true
  },
  {
    id: 'fenced',
    title: 'Arsa senin',
    body: ['Arsa çitle geldi ama çimen: üstüne yapı kurmak için beton dökmen gerek. Önce haritadan çık.'],
    target: dom('land-exit'),
    advance: { kind: 'until', done: (view) => !view.landMode.active }
  },
  {
    id: 'door-again',
    title: 'Beton',
    body: ["İnşaat'a tekrar tıkla."],
    target: dom('build'),
    advance: { kind: 'until', done: (view) => view.activeModal === 'BUILD' }
  },
  {
    id: 'tab-again',
    title: 'Arsa',
    body: ['Arsa sekmesine tıkla.'],
    target: dom('build-tab-land'),
    advance: { kind: 'click' }
  },
  {
    id: 'pave-card',
    title: 'Zemin Betonu',
    body: ['Betonsuz arsalarını haritada gösterir. Tıkla.'],
    target: dom('land-pave'),
    advance: { kind: 'until', done: (view) => view.landMode.active && view.landMode.intent === 'PAVE' }
  },
  {
    id: 'pour',
    title: 'Beton dök',
    body: ['Yeni arsana tıkla.'],
    target: (view) => world(parcelBox(firstUnpaved(view.state))),
    advance: { kind: 'until', done: (view) => firstUnpaved(view.state) === null },
    open: true
  },
  {
    id: 'done',
    title: 'Arsan hazır',
    body: ['Artık üstüne yapı kurabilirsin. Haritadan bu düğmeyle çık.'],
    target: dom('land-exit'),
    advance: { kind: 'until', done: (view) => !view.landMode.active }
  }
];

const buyLand: Lesson = {
  id: 'buy_land',
  title: 'Arsa',
  known: (state) => state.station.plots.ownedParcels.length > STARTING_PARCELS.length,
  subject: (view) => {
    const state = view.state;
    // Not on the first day: the first day has enough to learn.
    if (state.dayState.currentDay < 2) return null;
    const cheapest = cheapestForSale(state);
    if (!cheapest) return null;
    const { row } = parseParcelKey(cheapest);
    if (state.player.cash < readyCost(state.station.plots.ownedParcels, row)) return null;
    return String(state.station.plots.ownedParcels.length);
  },
  // Leaving the map mid-way is the player's answer, not an accident.
  abandon: (view, _subject, step) =>
    LAND_MAP_STEPS.has(BUY_LAND_STEPS[step]?.id) && !view.landMode.active ? 'skip' : null,
  steps: BUY_LAND_STEPS
};

/* ------------------------------------------------------------------ */
/* İnşaat paneli                                                       */
/* ------------------------------------------------------------------ */

/** Something the player put down themselves: a second pump, or anything not part of the starting station. */
const hasBuilt = (state: GameState) =>
  Object.keys(state.pumps).length > 1 ||
  Object.values(state.buildings).some((b) => !GAME_CONFIG.buildings[b.type]?.fixed);

const buildPanel: Lesson = {
  id: 'build_panel',
  title: 'İnşaat',
  panel: 'BUILD',
  known: hasBuilt,
  subject: () => 'build',
  steps: [
    {
      id: 'tabs',
      title: 'İnşaat kataloğu',
      body: [
        'Dört sekme: İstasyon pompa, aydınlatma ve süs; Tesisler müşterinin para bıraktığı yerler; Enerji elektrik ve şarj; Arsa yeni arazi ve beton.',
        'Her sekmeyi ilk açtığında ayrıca anlatacağım.'
      ],
      target: dom('build-tabs'),
      advance: next
    },
    {
      id: 'card',
      title: 'Bir kart',
      body: [
        'Kartta yapının görünüşü, boyutu, günlük gideri ve kaç tane kurabileceğin yazar; "arsa başı" her arsaya bir tane demek.',
        'Aynı yapının her yenisi bir öncekinden pahalıdır.'
      ],
      target: dom('build-card-pump_standard'),
      advance: next
    },
    {
      id: 'buy',
      title: 'Satın alma',
      body: [
        'Fiyata basınca yapı imlecine takılır ve sahada yerini seçersin. Kilitli kartın üstünde nedeni kırmızıyla yazar: gereken seviye ya da önce kurulması gereken yapı.'
      ],
      target: dom('build-card-buy'),
      advance: next
    }
  ]
};

const placement: Lesson = {
  id: 'placement',
  title: 'Yerleştirme',
  panel: 'PLACEMENT',
  known: hasBuilt,
  subject: () => 'placement',
  // Called off before it is put down: offered again next time a building is picked.
  abandon: (view, _subject, step) => (step === 0 && !view.buildModeActive ? 'retry' : null),
  steps: [
    {
      id: 'pin',
      title: 'Yerini seç',
      body: [
        'Yapı imlecine takıldı. Sahada koymak istediğin yere tıkla, orada sabitlensin. Kırmızı taralı yerler araç yolu; oraya yapı gelmez.'
      ],
      target: dom('placement-hint'),
      advance: { kind: 'until', done: (view) => view.buildPinned || !view.buildModeActive },
      open: true
    },
    {
      id: 'pad',
      title: 'İnce ayar',
      body: ['Oklarla kaydır, ortadaki düğmeyle döndür.'],
      target: dom('placement-pad'),
      advance: next,
      open: true,
      skip: (view) => !view.buildModeActive
    },
    {
      id: 'place',
      title: 'Yerleştir',
      body: ["Yerleştir'e basınca parası kasadan düşer. Vazgeçmek istersen kırmızı X."],
      target: dom('placement-place'),
      advance: { kind: 'until', done: (view) => !view.buildModeActive },
      open: true,
      skip: (view) => !view.buildModeActive
    }
  ]
};

const hasFacility = (state: GameState) =>
  Object.values(state.buildings).some(
    (b) => isFacility(b.type) || b.type === 'car_park' || b.type === 'truck_park'
  );

const buildFacilities: Lesson = {
  id: 'build_facilities',
  title: 'Tesisler',
  panel: 'BUILD',
  known: hasFacility,
  subject: (view) => (view.tabs.build === 'service' ? 'service' : null),
  steps: [
    {
      id: 'what',
      title: 'Tesisler ne işe yarar',
      body: [
        'Market, WC, kahveci gibi tesisler yakıttan ayrı para kazandırır. Pompada yakıt alan sürücülerin bir kısmı aracını bırakıp tesise yürür.'
      ],
      target: dom('build-card-mini_market'),
      advance: next
    },
    {
      id: 'park',
      title: 'Otopark',
      body: [
        'Otopark yoldan gelen müşteriyi getirir: park edip tesise gider. Otoparksız tesis yalnızca pompadaki sürücülerle beslenir.'
      ],
      target: dom('build-card-car_park'),
      advance: next
    },
    {
      id: 'till',
      title: 'Tesisin kasası',
      body: [
        'Tesisin kazandığı para kendi kasasında birikir; tesise tıklayıp "Kasayı Topla" dersin. Müdür turunda kendisi toplar.',
        'Her kartta hangi seviyede açıldığı yazar.'
      ],
      target: dom('build-tab-service'),
      advance: next
    }
  ]
};

/* Enerji, ve sundurmadan güneş paneline kadar ------------------------- */

const canopy = GAME_CONFIG.buildings.canopy;
const solarLevel = GAME_CONFIG.ev.solar.unlockLevel;
const energyLevel = Math.min(
  ...Object.values(GAME_CONFIG.buildings)
    .filter((b) => b.category === 'energy')
    .map((b) => b.unlockLevel)
);

const hasEnergy = (state: GameState) =>
  Object.values(state.buildings).some((b) => b.type.startsWith('ev_') || b.type === 'diesel_generator') ||
  Object.values(state.pumps).some((p) => p.hasSolarCanopy);

/** The pump a canopy would go on: the first without one. */
function bareRoofPump(state: GameState): string | null {
  return Object.values(state.pumps).find((p) => !p.hasCanopy)?.id ?? null;
}

/** A canopy can be fitted right now: its level, its price, and a pump to take it. */
const canopyFits = (state: GameState) =>
  state.player.level >= canopy.unlockLevel && state.player.cash >= canopy.price && bareRoofPump(state) !== null;

/** A pump and its island, as a box to light. */
function pumpBox(state: GameState, pumpId: string | null): WorldBox | null {
  const pump = pumpId ? state.pumps[pumpId] : null;
  if (!pump) return null;
  const [w, d] = GAME_CONFIG.buildings.pump_standard.size;
  const turned = pump.rotation === 90 || pump.rotation === 270;
  return {
    x: pump.position[0],
    z: pump.position[1],
    halfX: (turned ? d : w) / 2 + 0.3,
    halfZ: (turned ? w : d) / 2 + 0.3,
    top: 4
  };
}

const openPump = (view: LessonView) => (view.selectedPumpId ? view.state.pumps[view.selectedPumpId] : undefined);

const buildEnergy: Lesson = {
  id: 'build_energy',
  title: 'Enerji',
  panel: 'BUILD',
  known: hasEnergy,
  subject: (view) => (view.tabs.build === 'energy' ? 'energy' : null),
  steps: [
    {
      id: 'chain',
      title: 'Elektrik sırayla kurulur',
      body: [
        'Önce Elektrik Altyapısı: şebekeden elektrik çeker. Sonra Enerji Depolama: elektriği bataryada tutar. Şarj üniteleri ve jeneratör bunlardan sonra gelir.',
        `Enerji yapıları Seviye ${energyLevel}'den itibaren açılır.`
      ],
      target: dom('build-card-ev_substation'),
      advance: next
    },
    {
      id: 'chargers',
      title: 'Şarj üniteleri',
      body: [
        'Elektrikli araçlar pompaya değil şarj ünitesine gelir ve kWh başına öder. Ünite bataryadan çeker; batarya boşsa şarj durur.'
      ],
      target: dom('build-card-ev_charger_ac'),
      advance: next
    },
    {
      id: 'generator',
      title: 'Dizel jeneratör',
      body: ['Batarya azalınca kendi dizel tankından yakıp elektrik üretir; kritik stoğa dokunmaz.'],
      target: dom('build-card-diesel_generator'),
      advance: next
    },
    {
      id: 'solar',
      title: 'Güneş paneli',
      body: [
        'Güneş paneli ayrı bina değil, pompanın sundurmasına takılır: önce pompaya sundurma, sonra panel. Gündüz bataryayı doldurur, cam kirlenince az üretir.',
        `Sundurma Seviye ${canopy.unlockLevel}, panel Seviye ${solarLevel}'de; panel için o arsada trafo ve batarya da gerekir.`
      ],
      target: dom('roof-card'),
      advance: next
    },
    // From here on it is done rather than told, when it can be: a canopy on a
    // real pump, then panels on it.
    {
      id: 'close',
      title: 'Hadi kuralım',
      body: ['Bir pompaya sundurma takalım. Önce bu pencereyi kapat.'],
      target: dom('build-close'),
      advance: { kind: 'until', done: (view) => view.activeModal === 'NONE' },
      skip: (view) => !canopyFits(view.state)
    },
    {
      id: 'pick-pump',
      title: 'Pompayı seç',
      body: ['Işıklı pompaya tıkla.'],
      target: (view) => world(pumpBox(view.state, bareRoofPump(view.state))),
      advance: { kind: 'until', done: (view) => !!openPump(view) },
      press: (actions, view) => {
        const id = bareRoofPump(view.state);
        if (id) actions.selectPump(id);
      },
      skip: (view) => !canopyFits(view.state)
    },
    {
      id: 'canopy',
      title: 'Sundurma Ekle',
      body: [
        `"+ Sundurma Ekle"ye bas: ${lira(canopy.price)}, günde ${lira(canopy.dailyUpkeep)} bakım. O pompada dolum %5 hızlanır, saha daha az kirlenir.`
      ],
      target: dom('pump-canopy'),
      advance: { kind: 'until', done: (view) => !!openPump(view)?.hasCanopy },
      skip: (view) => !openPump(view) || !!openPump(view)?.hasCanopy
    },
    {
      id: 'panels',
      title: 'Güneşli Sundurma',
      body: [
        'Şimdi paneller: bu düğme sundurmaya panel takar, gündüz buradan bataryaya elektrik akar.',
        `Seviye ${solarLevel} ve o arsada trafo ile batarya yoksa şimdilik bekler; hazır olunca bu pompaya dön.`
      ],
      target: dom('pump-solar'),
      advance: next,
      skip: (view) => !openPump(view)?.hasCanopy || !!openPump(view)?.hasSolarCanopy
    }
  ]
};

/* ------------------------------------------------------------------ */
/* Tedarik ve Personel panelleri                                       */
/* ------------------------------------------------------------------ */

/** The first fuel the pumps actually sell, whose card the order panel shows first. */
const firstSoldFuel = (state: GameState): FuelType =>
  FUELS.find((f) => (state.tanks[f]?.capacity ?? 0) > 0 && sold(state, f)) ?? 'gasoline';

const orderPanel: Lesson = {
  id: 'order_panel',
  title: 'Tedarik',
  panel: 'FUEL_ORDER',
  known: (state) => state.fuelPurchaseHistory.length > 0 || state.fuelOrders.length > 0,
  subject: (view) => firstSoldFuel(view.state),
  steps: [
    ORDER_ROW_STEP,
    ORDER_AMOUNT_STEP,
    ORDER_SUPPLIERS_STEP,
    {
      id: 'buy',
      title: 'Sipariş',
      body: (_view, fuel) => [
        `Düğmedeki tutar yakıt artı ${lira(GAME_CONFIG.fuels[fuelOf(fuel)].deliveryFee)} nakliye; basınca tanker yola çıkar ve sağ altta görünür.`
      ],
      target: (_view, fuel) => dom(`order-buy-${fuel}`),
      advance: next
    },
    {
      id: 'ledger',
      title: 'Alım Defteri',
      body: ['Tamamlanan teslimatlar ve son 7 günün yakıt gideri burada.'],
      target: dom('order-ledger'),
      advance: next
    }
  ]
};

const staffPanel: Lesson = {
  id: 'staff_panel',
  title: 'Personel',
  panel: 'STAFF',
  known: (state) => Object.keys(state.employees).length > 0,
  subject: (view) => (view.tabs.staff === 'attendants' ? 'staff' : null),
  steps: [
    {
      id: 'tabs',
      title: 'Personel',
      body: ['İki sekme: Pompacılar pompaları senin yerine işletir, İstasyon Müdürü bütün istasyonu yönetir.'],
      target: dom('staff-tabs'),
      advance: next
    },
    {
      id: 'hire',
      title: 'Pompacı',
      body: [
        `Seviye ${ATTENDANT_LEVEL}'te açılır: bir kerelik ${lira(recruit.hireCost)}, günde ${lira(recruit.dailyWage)} maaş. Bir pompacı bir pompaya bakar.`
      ],
      target: dom('staff-hire'),
      advance: next
    },
    {
      id: 'manager',
      title: 'Müdür',
      body: [`Müdür Seviye ${manager.minLevel}'da açılır; şartlarını bu sekmede görürsün.`],
      target: dom('staff-tab-manager'),
      advance: next
    }
  ]
};

/* ------------------------------------------------------------------ */
/* Ofis                                                                */
/* ------------------------------------------------------------------ */

const officeOn = (view: LessonView, tab: string) => view.tabs.office === tab && !view.tabs.officeLoans;

const officePanel: Lesson = {
  id: 'office_panel',
  title: 'Ofis',
  panel: 'OFFICE',
  known: () => false,
  subject: () => 'office',
  steps: [
    {
      id: 'tabs',
      title: 'Ofis',
      body: [
        'İstasyonun masası: Özet genel durum, Fiyat satış fiyatları, Muhasebe gelir-gider ve kredi, Görevler günlük hedefler, Bakım pompa ve saha.',
        'Her sekmeyi ilk açtığında ayrıca anlatacağım.'
      ],
      target: dom('office-tabs'),
      advance: next
    }
  ]
};

const officeSummary: Lesson = {
  id: 'office_summary',
  title: 'Özet',
  panel: 'OFFICE',
  known: () => false,
  subject: (view) => (officeOn(view, 'summary') ? 'summary' : null),
  steps: [
    {
      id: 'finance',
      title: 'Finansal durum',
      body: [
        'Varlık: kasa, tanktaki yakıtın değeri ve tesis kasalarında bekleyen para. Kırmızı satır günlük gider: maaşlar, bakım ve kredi taksiti.'
      ],
      target: dom('summary-finance'),
      advance: next
    },
    {
      id: 'reputation',
      title: 'Müşteri ve itibar',
      body: [
        'Bugünkü hizmetin gün sonunda itibarını belirler, itibar da yarın yoldan kaç aracın sapacağını. Kaçan müşteri itibarı düşürür.'
      ],
      target: dom('summary-reputation'),
      advance: next
    },
    {
      id: 'actions',
      title: 'Masadan yapılanlar',
      body: ['Buradan tüm pompalara pompacı alır, istasyonu kapatıp açar, ofisi taşırsın.'],
      target: dom('summary-actions'),
      advance: next
    }
  ]
};

const officePrice: Lesson = {
  id: 'office_price',
  title: 'Fiyat',
  panel: 'OFFICE',
  // The "set your price" goal counts the first change: whoever has made one found the tab.
  known: (state) => state.missions.some((m) => m.metric === 'PRICE_SET' && m.progress > 0),
  subject: (view) => (officeOn(view, 'price') ? 'price' : null),
  steps: [
    {
      id: 'rows',
      title: 'Satış fiyatları',
      body: [
        'Her yakıtın fiyatını −/+ ile 10 kuruş oynatırsın. Yanındaki küçük rakam alış fiyatın; ok bölge ortalamasına göre yerin: ▼ ucuz, ▲ pahalı.'
      ],
      target: dom('price-rows'),
      advance: next
    },
    {
      id: 'flow',
      title: 'Ucuz mu, kârlı mı?',
      body: [
        'Bölge ortalamasının altı daha çok müşteri çeker ama litre başına kazancı düşürür; üstü tersine. Bu satır fiyatlarının müşteri akışına etkisi.'
      ],
      target: dom('price-flow'),
      advance: next
    },
    {
      id: 'sign',
      title: 'Fiyat tabelası',
      body: [
        'Yoldaki tabela fiyatlarını gösterir; tabelaya tıklayınca da bu sekme açılır. Yükseltmenin ne kazandırdığı düğmenin altında yazar.'
      ],
      target: dom('price-sign'),
      advance: next,
      skip: (view) => !Object.values(view.state.buildings).some((b) => b.type === 'price_sign')
    }
  ]
};

const loanLevel = Math.min(...GAME_CONFIG.loans.map((l) => l.minLevel));

const officeAccounts: Lesson = {
  id: 'office_accounts',
  title: 'Muhasebe',
  panel: 'OFFICE',
  known: (state) => state.loans.length > 0,
  subject: (view) => (officeOn(view, 'accounts') ? 'accounts' : null),
  abandon: (view) => (view.activeModal !== 'OFFICE' ? 'retry' : null),
  steps: [
    {
      id: 'daily',
      title: 'Gelir ve gider',
      body: [
        'Günlük satış ve faaliyet kârı: bugünkü satıştan yakıt alışı, market maliyeti, tamir ve enerji düşülmüş hali. "Son 3 gün" müdür şartındaki kârlı günlere bakar.'
      ],
      target: dom('accounts-daily'),
      advance: next
    },
    {
      id: 'loans',
      title: 'Kredi',
      body: ["Nakit sıkışırsa kredi çekebilirsin. Krediler'e tıkla."],
      target: dom('accounts-loans'),
      advance: { kind: 'until', done: (view) => view.tabs.officeLoans }
    },
    {
      id: 'packages',
      title: 'Kredi paketleri',
      body: [
        'Her pakette çekeceğin para, vade, toplam maliyet ve günlük taksit yazar. Taksit her gün kasadan düşer; aynı anda en fazla 2 kredi.',
        `Krediler Seviye ${loanLevel}'te açılır.`
      ],
      target: dom('loans-packages'),
      advance: next
    },
    {
      id: 'back',
      title: 'Geri',
      body: ["Bu okla Muhasebe'ye dönersin. Bas, bitirelim."],
      target: dom('loans-back'),
      // The press on the arrow ends it (Emre, 2026-09-12): waiting for Bitir
      // left the card standing over Muhasebe with the arrow it named gone.
      advance: { kind: 'until', done: (view) => !view.tabs.officeLoans }
    }
  ]
};

const officeMissions: Lesson = {
  id: 'office_missions',
  title: 'Görevler',
  panel: 'OFFICE',
  known: (state) => state.missions.some((m) => m.claimed),
  subject: (view) => (officeOn(view, 'missions') ? 'missions' : null),
  steps: [
    {
      id: 'list',
      title: 'Görevler',
      body: [
        'Her sabah yeni günlük görevler gelir. Tamamlanan görevin yanında yeşil ödül düğmesi çıkar; bas, para kasana geçsin.',
        'Alt çubuktaki pano düğmesinin yeşil sayısı alınmayı bekleyen ödülleri sayar.'
      ],
      target: dom('missions-list'),
      advance: next
    }
  ]
};

const officeMaintenance: Lesson = {
  id: 'office_maintenance',
  title: 'Bakım',
  panel: 'OFFICE',
  known: (state) =>
    state.player.statistics.repairActionsCount > 0 || state.player.statistics.cleanActionsCount > 0,
  subject: (view) => (officeOn(view, 'maintenance') ? 'maintenance' : null),
  steps: [
    {
      id: 'site',
      title: 'Saha temizliği',
      body: [
        `Saha zamanla kirlenir, kirli saha müşteri memnuniyetini düşürür. Temizlik ${lira(GAME_CONFIG.economy.siteCleanCost)}, +25 puan.`
      ],
      target: dom('maint-site'),
      advance: next
    },
    {
      id: 'pumps',
      title: 'Pompa sağlığı',
      body: [
        'Pompa kullandıkça yıpranır; %25 altında arızalanabilir, arızalı pompa müşteri kaybettirir. Erken bakım tamirden ucuzdur.'
      ],
      target: dom('maint-pumps'),
      advance: next
    },
    {
      id: 'solar',
      title: 'Güneş panelleri',
      body: [
        'Panel camı tozlanır, kirli cam az üretir; buradan yıkarsın.',
        'Alt çubuktaki anahtarın kırmızı sayısı ilgi bekleyenleri sayar.'
      ],
      target: dom('maint-solar'),
      advance: next
    }
  ]
};

/* ------------------------------------------------------------------ */
/* Sahadaki kartlar                                                    */
/* ------------------------------------------------------------------ */

const pumpModules = GAME_CONFIG.pumpFuelModules;

const pumpCard: Lesson = {
  id: 'pump_card',
  title: 'Pompa kartı',
  panel: 'PUMP_CARD',
  known: (state) =>
    Object.values(state.pumps).some((p) => p.level > 1 || p.hasCanopy) || Object.keys(state.pumps).length > 1,
  subject: (view) => view.selectedPumpId,
  abandon: (view, id) => (view.selectedPumpId !== id ? 'retry' : null),
  steps: [
    {
      id: 'rows',
      title: 'Pompa kartı',
      body: ['Pompanın durumu, dolum hızı, pompacısı ve sattığı yakıtların fiyatı.'],
      target: dom('pump-rows'),
      advance: next
    },
    {
      id: 'hire',
      title: 'Pompacı',
      body: [
        `Bu pompaya pompacıyı buradan da alırsın (Seviye ${ATTENDANT_LEVEL}). Gelen araçları senin yerine doldurur.`
      ],
      target: dom('pump-hire'),
      advance: next
    },
    {
      id: 'upgrade',
      title: 'Yükseltme',
      body: ['Yükseltme dolum hızını artırır; kuyruk daha çabuk erir.'],
      target: dom('pump-upgrade'),
      advance: next,
      skip: (view) => {
        const pump = openPump(view);
        return !pump || !GAME_CONFIG.buildingUpgrades[upgradePathFor('pump_standard')]?.[pump.level + 1];
      }
    },
    {
      id: 'modules',
      title: 'Yeni tabanca',
      body: [
        `Dizel (Seviye ${pumpModules.diesel.minLevel}) ya da LPG (Seviye ${pumpModules.lpg.minLevel}) tabancası takınca o yakıtı da satarsın; tankında stok olmalı.`
      ],
      target: dom('pump-modules'),
      advance: next,
      skip: (view) => {
        const pump = openPump(view);
        return !pump || (pump.supportedFuels.includes('diesel') && pump.supportedFuels.includes('lpg'));
      }
    },
    {
      id: 'canopy',
      title: 'Sundurma',
      body: [
        `Pompanın çatısı (Seviye ${canopy.unlockLevel}): dolumu %5 hızlandırır, sahayı daha az kirletir. Güneş paneli yalnızca sundurmaya takılır.`
      ],
      target: dom('pump-canopy'),
      advance: next,
      skip: (view) => !openPump(view) || !!openPump(view)?.hasCanopy
    }
  ]
};

const openBuilding = (view: LessonView) =>
  view.selectedBuildingId ? view.state.buildings[view.selectedBuildingId] : undefined;

const facilityCard: Lesson = {
  id: 'facility_card',
  title: 'Tesis kartı',
  panel: 'FACILITY_CARD',
  known: () => false,
  subject: (view) => view.selectedBuildingId,
  abandon: (view, id) => (view.selectedBuildingId !== id ? 'retry' : null),
  steps: [
    {
      id: 'visits',
      title: 'Ziyaretler',
      body: [
        'Müşteri iki yoldan gelir: pompadan yürüyen sürücü ve otoparka park eden. Otopark yoksa yoldan gelen uğramaz.'
      ],
      target: dom('facility-visits'),
      advance: next
    },
    {
      id: 'till',
      title: 'Kasa',
      body: ['Tesisin kazandığı para bu kasada birikir; bas, kasana geçsin. Müdür turunda kendisi toplar.'],
      target: dom('facility-till'),
      advance: next
    },
    {
      id: 'tariff',
      title: 'Kullanım ücreti',
      body: [
        'Ücreti artırırsan ziyaret başına daha çok kazanırsın ama daha az kişi gelir ve memnuniyet düşer.'
      ],
      target: dom('facility-tariff'),
      advance: next,
      skip: (view) => {
        const building = openBuilding(view);
        return !building || !facilityTariff(building) || nextTariffIndex(building) === null;
      }
    },
    {
      id: 'sell',
      title: 'Yıkmak',
      body: [`Yıkarsan bedelinin %${refundPercent}'ı ve kasadaki para geri gelir.`],
      target: dom('facility-sell'),
      advance: next
    }
  ]
};

const structureCard: Lesson = {
  id: 'structure_card',
  title: 'Yapı kartı',
  panel: 'STRUCTURE_CARD',
  known: () => false,
  subject: (view) => view.selectedBuildingId,
  abandon: (view, id) => (view.selectedBuildingId !== id ? 'retry' : null),
  steps: [
    {
      id: 'rows',
      title: 'Yapı kartı',
      body: ['Yapının günlük bakım gideri, sağlığı ve satış değeri.'],
      target: dom('structure-rows'),
      advance: next
    },
    {
      id: 'actions',
      title: 'Ne yapabilirsin',
      body: (view) =>
        GAME_CONFIG.buildings[openBuilding(view)?.type ?? '']?.fixed
          ? ['İstasyonun sabit donanımı: taşınmaz, satılmaz; yalnızca yükseltilir.']
          : [
              `Yükselt, taşı, döndür ya da yık: yıkınca bedelinin %${refundPercent}'ı geri gelir.`,
              'Kilitli düğme hangi seviyede açıldığını yazar.'
            ],
      target: dom('structure-actions'),
      advance: next
    }
  ]
};

/* ------------------------------------------------------------------ */

export const LESSONS: Lesson[] = [
  firstCustomer,
  fuelOrder,
  hireAttendant,
  managerHire,
  managerSetup,
  buyLand,
  placement,
  buildPanel,
  buildFacilities,
  buildEnergy,
  orderPanel,
  staffPanel,
  officePanel,
  officeSummary,
  officePrice,
  officeAccounts,
  officeMissions,
  officeMaintenance,
  pumpCard,
  facilityCard,
  structureCard
];

export function lessonById(id: string | null): Lesson | null {
  return LESSONS.find((l) => l.id === id) ?? null;
}

type TimeSpeed = GameState['dayState']['timeSpeed'];

/**
 * What the clock reads on a step: held on anything that points, running on a
 * step that waits on the world — at the player's own pace, or normal speed if
 * they had paused, since a pour cannot finish on a stopped clock.
 */
export function lessonClock(step: LessonStep | undefined, resumeSpeed: TimeSpeed): TimeSpeed {
  if (!step?.clockRuns) return 0;
  return resumeSpeed === 0 ? 1 : resumeSpeed;
}

/** The first step from `from` on that has something to say here. */
export function firstLessonStep(lesson: Lesson, view: LessonView, subject: string, from: number): number {
  let i = from;
  while (i < lesson.steps.length && lesson.steps[i].skip?.(view, subject)) i++;
  return i;
}

/** The pieces of the store a lesson reads. Structural, so this file never imports the store. */
export interface LessonViewSource {
  gameState: GameState;
  activeModal: string;
  selectedVehicleId: string | null;
  selectedPumpId: string | null;
  selectedBuildingId: string | null;
  landMode: { active: boolean; intent: 'BUY' | 'PAVE' };
  buildMode: { active: boolean; pinned: boolean };
  tour: { active: boolean };
}

export function lessonView(source: LessonViewSource): LessonView {
  return {
    state: source.gameState,
    activeModal: source.activeModal,
    selectedVehicleId: source.selectedVehicleId,
    selectedPumpId: source.selectedPumpId,
    selectedBuildingId: source.selectedBuildingId,
    landMode: { active: source.landMode.active, intent: source.landMode.intent },
    buildModeActive: source.buildMode.active,
    buildPinned: source.buildMode.pinned,
    tourActive: source.tour.active,
    tabs: { ...openTabs }
  };
}

/** Structures whose click opens something else rather than a card (see StructurePanel). */
const CARDLESS = ['office', 'price_sign', 'pylon_sign'];

/** The panel on screen right now, in the terms lessons are keyed by. */
export function openPanel(view: LessonView): LessonPanel | null {
  if (view.buildModeActive) return 'PLACEMENT';
  if (view.activeModal !== 'NONE') {
    return ['BUILD', 'OFFICE', 'STAFF', 'FUEL_ORDER'].includes(view.activeModal)
      ? (view.activeModal as LessonPanel)
      : null;
  }
  if (view.selectedPumpId && view.state.pumps[view.selectedPumpId]) return 'PUMP_CARD';
  const building = openBuilding(view);
  if (building && !CARDLESS.includes(building.type)) {
    return isFacility(building.type) ? 'FACILITY_CARD' : 'STRUCTURE_CARD';
  }
  return null;
}

/**
 * The lesson to offer now, if any.
 *
 * A panel's lesson comes the first time that panel is open. Every other
 * lesson waits until the player has nothing else open: one that barges into
 * a half-placed building or a menu opened for the player's own reasons is
 * one they will skip on reflex. `panelsOnly` holds back the unasked-for ones
 * for a while after a lesson ends.
 */
export function lessonToStart(
  view: LessonView,
  lessons: Lesson[] = LESSONS,
  options: { panelsOnly?: boolean } = {}
): { id: string; subject: string } | null {
  const { settings, dayState } = view.state;
  if (settings.lessonsOff || view.tourActive || !dayState.isDayActive || view.landMode.active) return null;

  const panel = openPanel(view);
  const screenBusy = view.activeModal !== 'NONE' || view.buildModeActive;
  const done = settings.lessonsDone ?? [];

  for (const lesson of lessons) {
    if (done.includes(lesson.id) || lesson.known(view.state)) continue;
    if (lesson.panel ? lesson.panel !== panel : options.panelsOnly || screenBusy) continue;
    const subject = lesson.subject(view);
    if (subject !== null) return { id: lesson.id, subject };
  }
  return null;
}
