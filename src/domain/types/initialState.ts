import { GameState } from './gameState';
import { GAME_CONFIG } from '../../config/gameConfig';
import { stationBounds, STARTING_PARCELS } from '../services/land';

export function createInitialGameState(): GameState {
  const now = Date.now();

  return {
    schemaVersion: 5,
    saveId: 'save_' + Math.random().toString(36).substring(2, 9),
    createdAt: now,
    updatedAt: now,
    player: {
      id: 'player_1',
      level: 1,
      xp: 0,
      cash: GAME_CONFIG.economy.initialCash, // 15.000 TL
      reputation: GAME_CONFIG.economy.initialReputation, // 3.00
      statistics: {
        totalFuelSoldLiters: 0,
        totalRevenue: 0,
        totalCustomersServed: 0,
        totalCustomersLost: 0,
        totalTips: 0,
        daysCompleted: 0,
        cleanActionsCount: 0,
        repairActionsCount: 0,
      },
      unlocks: ['fuel_gasoline', 'fuel_diesel', 'fuel_lpg', 'pump_standard', 'price_sign', 'office_s1']
    },
    station: {
      id: 'station_1',
      name: 'Yol Üstü İstasyonu',
      open: true,
      cleanliness: 95,
      plots: {
        width: stationBounds(STARTING_PARCELS).width,
        height: stationBounds(STARTING_PARCELS).height,
        ownedParcels: [...STARTING_PARCELS],
        // The starting block comes ready to trade on.
        pavedParcels: [...STARTING_PARCELS]
      },
      managerId: null,
      roadLevel: 1
    },
    tanks: {
      gasoline: {
        id: 'tank_gasoline_1',
        fuelType: 'gasoline',
        level: 1,
        capacity: 1500,
        stock: 700, // Başlangıç 700 L
        reservedStock: 0,
        averageCost: GAME_CONFIG.fuels.gasoline.baseWholesale, // 36.40 TL/L
        health: 100
      },
      // All three fuels live in the farm from day one. Customers for a fuel
      // only start arriving once a pump can actually dispense it, so nothing
      // here is a trap — just stock waiting for its pump upgrade.
      diesel: {
        id: 'tank_diesel_1',
        fuelType: 'diesel',
        level: 1,
        capacity: 1500,
        stock: 0,
        reservedStock: 0,
        averageCost: GAME_CONFIG.fuels.diesel.baseWholesale,
        health: 100
      },
      lpg: {
        id: 'tank_lpg_1',
        fuelType: 'lpg',
        level: 1,
        capacity: 1500,
        stock: 0,
        reservedStock: 0,
        averageCost: GAME_CONFIG.fuels.lpg.baseWholesale,
        health: 100
      }
    },
    pricing: {
      gasoline: {
        fuelType: 'gasoline',
        playerPrice: GAME_CONFIG.fuels.gasoline.regionalRetail, // 44.90 TL/L
        todayWholesaleCost: GAME_CONFIG.fuels.gasoline.baseWholesale,
        regionalAverage: GAME_CONFIG.fuels.gasoline.regionalRetail,
        priceStrategy: 'BALANCED'
      },
      diesel: {
        fuelType: 'diesel',
        playerPrice: GAME_CONFIG.fuels.diesel.regionalRetail,
        todayWholesaleCost: GAME_CONFIG.fuels.diesel.baseWholesale,
        regionalAverage: GAME_CONFIG.fuels.diesel.regionalRetail,
        priceStrategy: 'BALANCED'
      },
      lpg: {
        fuelType: 'lpg',
        playerPrice: GAME_CONFIG.fuels.lpg.regionalRetail,
        todayWholesaleCost: GAME_CONFIG.fuels.lpg.baseWholesale,
        regionalAverage: GAME_CONFIG.fuels.lpg.regionalRetail,
        priceStrategy: 'BALANCED'
      }
    },
    pumps: {
      pump_1: {
        id: 'pump_1',
        level: 1,
        // Grid koordinatları — çeyrek tur dönünce 2x3'lük ayak izinin uzun
        // kenarı x eksenine geçer; kenarlar hücre çizgisine otursun diye bu
        // kez x yarım koordinatta.
        //
        // Emre'nin 2026-09-02 kararı: yeni oyun pompası yola dönük başlar
        // (rotation 90) — araçlar ön şeritten gelip doğrudan önünde durur,
        // bekleme trafiği ilk andan görülebilir olur.
        //
        // z=7 (Emre, 2026-09-02: "bir birim daha öne"): servis yüzü yolda,
        // araç 5.6'da durur ve kuyruk artık ayrı bir lay-by'da değil, tam bu
        // bay hattında bekler — servis alanın burnu-kuyruğunda, ilham alınan
        // oyundaki akış.
        position: [8.5, 7],
        rotation: 90,
        supportedFuels: ['gasoline'],
        state: 'IDLE',
        health: 100,
        employeeId: null,
        currentVehicleId: null,
        flowRateLps: 8
      }
    },
    vehicles: {},
    employees: {},
    buildings: {
      office_1: {
        id: 'office_1',
        type: 'office',
        level: 1,
        // Saklanan boyut 4x4 (katalogdaki 5x5 değil) ve ayak izi saklanandan
        // hesaplanır: çift kenar tam sayı merkez ister.
        position: [4, 11],
        rotation: 0,
        size: [4, 4],
        health: 100,
        constructionState: 'ACTIVE',
        builtAtTimestamp: now
      },
      tank_1: {
        id: 'tank_1',
        type: 'tank_farm',
        level: 1,
        position: [14.5, 12.5], // 3x3: tek sayılı kenar, yarım koordinat merkez
        rotation: 0,
        size: [3, 3],
        health: 100,
        constructionState: 'ACTIVE',
        builtAtTimestamp: now
      },
      price_sign_1: {
        id: 'price_sign_1',
        type: 'price_sign',
        level: 1,
        position: [7, 1],
        rotation: 0,
        size: [1, 1],
        health: 100,
        constructionState: 'ACTIVE',
        builtAtTimestamp: now
      }
    },
    fuelOrders: [],
    loans: [],
    missions: GAME_CONFIG.tutorialTasks.map((task) => ({
      id: 'mission_' + task.id,
      templateId: task.id,
      type: 'TUTORIAL',
      description: task.description,
      metric: task.metric,
      target: task.target,
      progress: 0,
      rewardCash: task.rewardCash,
      rewardXp: task.rewardXp,
      completed: false,
      claimed: false,
      issuedOnDay: 1
    })),
    activeEvents: [],
    todayEventIds: [],
    dayState: {
      currentDay: 1,
      gameTime: 6.0, // 06:00
      timeSpeed: 1,
      isDayActive: true,
      isDayEnding: false,
      weather: 'SUNNY',
      todayStats: {
        fuelRevenue: 0,
        fuelCost: 0,
        marketRevenue: 0,
        marketCost: 0,
        tips: 0,
        wages: 0,
        upkeep: 0,
        loanPayments: 0,
        repairs: 0,
        customersServed: 0,
        customersLost: 0,
        serviceScoreSum: 0
      }
    },
    market: {
      stock: 0,
      averageCost: 0,
      active: false
    },
    managerSettings: {
      autoFuelOrder: false,
      orderThresholdPercent: 25,
      orderTargetPercent: 90,
      kasaReserve: GAME_CONFIG.employees.manager.defaultKasaReserve,
      autoPricing: false,
      minMargin: 5.0,
      maxRegionalDiff: 1.0,
      autoAssignAttendants: true,
      autoMaintenanceAlert: true,
      minHealthThreshold: 40
    },
    managerLogs: [],
    settings: {
      masterVolume: 0.8,
      musicVolume: 0.5,
      sfxVolume: 0.8,
      graphicsQuality: 'MEDIUM',
      language: 'tr',
      showTutorialTips: true
    },
    notifications: [
      {
        id: 'notif_welcome',
        type: 'INFO',
        title: 'İstasyona Hoş Geldiniz!',
        message: 'İlk aracınız ana yoldan yaklaşmak üzere. Pompaya tıklayarak hizmet verebilirsiniz.',
        timestamp: now,
        count: 1
      }
    ],
    transactionLog: [
      {
        id: 'tx_init',
        timestamp: now,
        type: 'TUTORIAL_REWARD',
        amount: GAME_CONFIG.economy.initialCash,
        cashBefore: 0,
        cashAfter: GAME_CONFIG.economy.initialCash,
        description: 'Başlangıç Sermayesi'
      }
    ]
  };
}
