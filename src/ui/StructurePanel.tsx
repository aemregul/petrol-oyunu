import React from 'react';
import * as Icons from 'lucide-react';
import { useGameStore } from '../store/gameStore';
import { GAME_CONFIG, upgradePathFor } from '../config/gameConfig';
import { isFacility } from '../domain/services/facilities';
import {
  drivewaySideAt,
  energyAvailable,
  energyCapacity,
  substationOn,
  solarKwhPerHourNow,
  solarCellsFeeding,
  generatorRunning,
  hourOfDay
} from '../domain/services/simulationEngine';
import { gridKwhPerHourFor, gridPriceAt, isNightTariff, dieselForGenerator } from '../domain/services/energy';
import { sounds } from '../audio/soundEffects';

/**
 * Structures that open something else on click rather than a card of their
 * own: the office and the price board are doors into the office, the pylon
 * is inert.
 */
const NO_CARD = ['office', 'price_sign', 'pylon_sign'];

/**
 * The card for every structure that has no card of its own: what it is,
 * what it costs to keep, what it is worth, and the levers on it. Replaces
 * the strip that used to hang under a clicked building (Emre, 2026-09-07),
 * in the same shape as the pump and facility cards.
 */
export const StructurePanel: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const selectedBuildingId = useGameStore((s) => s.selectedBuildingId);
  const activeModal = useGameStore((s) => s.activeModal);
  const buildMode = useGameStore((s) => s.buildMode);
  const selectBuilding = useGameStore((s) => s.selectBuilding);
  const upgradeBuilding = useGameStore((s) => s.upgradeBuilding);
  const relocateStructure = useGameStore((s) => s.relocateStructure);
  const rotateBuilding = useGameStore((s) => s.rotateBuilding);
  const sellStructure = useGameStore((s) => s.sellStructure);
  const structureValue = useGameStore((s) => s.structureValue);
  const hirePumpAttendant = useGameStore((s) => s.hirePumpAttendant);
  const fireAttendant = useGameStore((s) => s.fireAttendant);
  const toggleGenerator = useGameStore((s) => s.toggleGenerator);

  const building = selectedBuildingId ? gameState.buildings[selectedBuildingId] : null;
  if (!building || activeModal !== 'NONE' || buildMode.active) return null;
  if (isFacility(building.type) || NO_CARD.includes(building.type)) return null;

  const catalog = GAME_CONFIG.buildings[building.type];
  if (!catalog) return null;

  const IconComponent =
    (catalog.icon && (Icons as unknown as Record<string, React.ElementType>)[catalog.icon]) ||
    Icons.Building2;
  const upgrade = GAME_CONFIG.buildingUpgrades[upgradePathFor(building.type)]?.[building.level + 1];
  const canAffordUpgrade = !!upgrade && gameState.player.cash >= upgrade.cost;
  const fixed = !!catalog.fixed;
  const square = catalog.size[0] === catalog.size[1];
  const value = structureValue(building.id);

  // The electric line has its own rows: a post is a pump with a plug, a bank
  // is the tank behind it.
  const isPost = building.type === 'ev_charger_ac' || building.type === 'ev_charger_dc';
  const isBank = building.type === 'ev_storage';
  const side = drivewaySideAt(building.position[1]);
  const bankKwh = isPost || isBank ? energyAvailable(gameState, side) : 0;
  const bankCapacity = isBank
    ? energyCapacity(building)
    : Object.values(gameState.buildings)
        .filter((b) => b.type === 'ev_storage' && drivewaySideAt(b.position[1]) === side)
        .reduce((sum, b) => sum + energyCapacity(b), 0);
  const attendant = isPost
    ? Object.values(gameState.employees).find(
        (e) => e.role === 'PUMP_ATTENDANT' && e.assignedPumpId === building.id
      )
    : undefined;
  const attendantConf = GAME_CONFIG.employees.pumpAttendant.tierLevels[0];
  const plugged = isPost
    ? Object.values(gameState.vehicles).find((v) => v.chargingBuildingId === building.id)
    : undefined;
  const postStatus = !plugged
    ? { text: 'Boşta', tone: 'text-emerald-400' }
    : plugged.state === 'FUELING'
      ? { text: 'Şarj ediyor', tone: 'text-emerald-400' }
      : { text: 'Müşteri bekliyor', tone: 'text-amber-400' };
  const kwhPrice = building.type === 'ev_charger_dc' ? GAME_CONFIG.ev.dcPricePerKwh : GAME_CONFIG.ev.acPricePerKwh;

  // The contract on the substation, the sun on the roofs, the diesel in the
  // generator: the three lines that fill the bank.
  const isSubstation = building.type === 'ev_substation';
  const isGenerator = building.type === 'diesel_generator';
  const hour = hourOfDay(gameState.dayState.gameTime);
  const gridNow = gridPriceAt(hour);
  const tariffLabel = isNightTariff(hour) ? 'gece' : gridNow > GAME_CONFIG.ev.gridPricePerKwh ? 'pik' : 'gündüz';
  const feeder = substationOn(gameState, side);
  const solarNow = isBank ? solarKwhPerHourNow(gameState, side) : 0;
  const solarCells = isBank ? solarCellsFeeding(gameState, side) : 0;
  const genRunning = isGenerator && generatorRunning(gameState, building);
  const genStatus = !isGenerator
    ? null
    : building.generatorOff
      ? { text: 'Kapalı', tone: 'text-slate-500' }
      : genRunning
        ? { text: 'Çalışıyor', tone: 'text-emerald-400' }
        : dieselForGenerator(gameState.tanks.diesel) <= 0
          ? { text: 'Mazot rezervde', tone: 'text-rose-300' }
          : { text: 'Batarya yeterli, bekliyor', tone: 'text-amber-400' };
  const t = gameState.dayState.todayStats;

  const handleClose = () => {
    sounds.playClick();
    selectBuilding(null);
  };

  const dark =
    'w-full py-3.5 bg-[#252227] hover:bg-[#322d35] active:scale-98 text-white rounded-2xl font-extrabold text-sm transition-all border border-white/5 shadow-md';

  return (
    <div className="fixed inset-0 pointer-events-none z-40 flex items-center justify-center p-4">
      <div className="w-[340px] max-h-[88vh] overflow-y-auto pointer-events-auto select-none rounded-[2rem] bg-[#161419] border border-white/10 shadow-2xl animate-fade-in flex flex-col">
        <div className="bg-[#2f5fa8] px-5 py-3.5 flex items-center justify-between text-white shadow-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
              <IconComponent className="w-4 h-4 text-white" />
            </div>
            <span className="font-extrabold text-base tracking-tight">
              {catalog.name}
              {upgrade || building.level > 1 ? ` Sv.${building.level}` : ''}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="w-7 h-7 rounded-xl bg-black/20 hover:bg-black/40 text-white flex items-center justify-center transition-colors"
            aria-label="Kapat"
          >
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 text-xs">
          <p className="text-slate-300 text-[11px] leading-relaxed font-medium">{catalog.description}</p>

          <div className="flex flex-col divide-y divide-white/5 text-xs">
            <div className="flex justify-between items-center py-1.5">
              <span className="text-slate-400 font-semibold">Günlük bakım</span>
              <span className="font-extrabold font-mono text-rose-300">
                ₺{catalog.dailyUpkeep.toLocaleString('tr-TR')}
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5">
              <span className="text-slate-400 font-semibold">Sağlık</span>
              <span className={`font-extrabold font-mono ${building.health >= 60 ? 'text-emerald-400' : 'text-amber-400'}`}>
                %{Math.round(building.health)}
              </span>
            </div>
            {isPost && (
              <>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Durum</span>
                  <span className={`font-extrabold ${postStatus.tone}`}>{postStatus.text}</span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Tarife</span>
                  <span className="font-extrabold font-mono text-white">₺{kwhPrice.toFixed(1)}/kWh</span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Şarjcı</span>
                  <span className={`font-extrabold uppercase ${attendant ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {attendant ? 'ÇALIŞIYOR' : 'YOK'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Yovmiye</span>
                  <span className={`font-extrabold font-mono ${attendant ? 'text-rose-300' : 'text-slate-500'}`}>
                    ₺{attendant ? attendant.wage : attendantConf.dailyWage}/gün
                  </span>
                </div>
              </>
            )}
            {(isPost || isBank) && (
              <div className="py-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-semibold">{isBank ? 'Dolu' : 'Batarya'}</span>
                  <span className={`font-extrabold font-mono ${bankKwh < 1 ? 'text-rose-300' : 'text-sky-300'}`}>
                    {Math.round(bankKwh)} / {bankCapacity} kWh
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-black/40 overflow-hidden mt-1.5">
                  <div
                    className="h-full rounded-full bg-sky-400"
                    style={{ width: `${bankCapacity > 0 ? Math.min(100, (bankKwh / bankCapacity) * 100) : 0}%` }}
                  />
                </div>
              </div>
            )}
            {isBank && (
              <>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Şebeke dolumu</span>
                  <span className={`font-extrabold font-mono ${feeder ? 'text-white' : 'text-rose-300'}`}>
                    {feeder
                      ? `${gridKwhPerHourFor(feeder.level)} kWh/sa · ₺${gridNow.toFixed(1)} (${tariffLabel})`
                      : 'Trafo yok'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Güneş</span>
                  <span className={`font-extrabold font-mono ${solarNow > 0 ? 'text-amber-300' : 'text-slate-500'}`}>
                    {solarCells > 0 ? `${solarNow.toFixed(1)} kWh/sa` : 'Panel yok'}
                  </span>
                </div>
              </>
            )}
            {isSubstation && (
              <>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Şebeke sözleşmesi</span>
                  <span className="font-extrabold font-mono text-white">{gridKwhPerHourFor(building.level)} kWh/sa</span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Gece tarifesi</span>
                  <span className="font-extrabold font-mono text-emerald-400">
                    ₺{GAME_CONFIG.ev.gridTariff.night.price.toFixed(1)}/kWh · {GAME_CONFIG.ev.gridTariff.night.from}:00–{GAME_CONFIG.ev.gridTariff.night.to}:00
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Gündüz</span>
                  <span className="font-extrabold font-mono text-white">₺{GAME_CONFIG.ev.gridPricePerKwh.toFixed(1)}/kWh</span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Pik</span>
                  <span className="font-extrabold font-mono text-rose-300">
                    ₺{GAME_CONFIG.ev.gridTariff.peak.price.toFixed(1)}/kWh · {GAME_CONFIG.ev.gridTariff.peak.from}:00–{GAME_CONFIG.ev.gridTariff.peak.to}:00
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Şu an</span>
                  <span className="font-extrabold font-mono text-sky-300">₺{gridNow.toFixed(1)}/kWh ({tariffLabel})</span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Bugünkü enerji gideri</span>
                  <span className="font-extrabold font-mono text-rose-300">₺{Math.round(t.energyCost ?? 0).toLocaleString('tr-TR')}</span>
                </div>
              </>
            )}
            {isGenerator && genStatus && (
              <>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Durum</span>
                  <span className={`font-extrabold ${genStatus.tone}`}>{genStatus.text}</span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Üretim</span>
                  <span className="font-extrabold font-mono text-white">{GAME_CONFIG.ev.generator.kwhPerHour} kWh/sa</span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Tüketim</span>
                  <span className="font-extrabold font-mono text-white">
                    {(GAME_CONFIG.ev.generator.kwhPerHour * GAME_CONFIG.ev.generator.litersPerKwh).toFixed(0)} L/sa mazot
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Devreye girer</span>
                  <span className="font-extrabold font-mono text-white">batarya %{GAME_CONFIG.ev.generator.runBelowPercent} altında</span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Yakılabilir mazot</span>
                  <span className="font-extrabold font-mono text-white">
                    {Math.round(dieselForGenerator(gameState.tanks.diesel)).toLocaleString('tr-TR')} L
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-slate-400 font-semibold">Bugün</span>
                  <span className="font-extrabold font-mono text-amber-300">
                    {Math.round(t.generatorKwh ?? 0)} kWh · {Math.round(t.generatorLiters ?? 0)} L
                  </span>
                </div>
              </>
            )}
            {!fixed && (
              <div className="flex justify-between items-center py-1.5">
                <span className="text-slate-400 font-semibold">Satış değeri</span>
                <span className="font-extrabold font-mono text-white">₺{value.toLocaleString('tr-TR')}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2.5 pt-1">
            {isPost &&
              (attendant ? (
                <button
                  onClick={() => {
                    sounds.playClick();
                    fireAttendant(attendant.id);
                  }}
                  className="w-full py-3.5 bg-[#d83f3f] hover:bg-[#c63232] active:scale-98 text-white rounded-2xl font-extrabold text-sm transition-all shadow-lg"
                >
                  Şarjcıyı İşten Çıkar
                </button>
              ) : (
                <button
                  onClick={() => {
                    sounds.playClick();
                    hirePumpAttendant(building.id);
                  }}
                  disabled={gameState.player.cash < attendantConf.hireCost}
                  className={`w-full py-3.5 rounded-2xl font-extrabold text-sm transition-all shadow-lg active:scale-98 ${
                    gameState.player.cash >= attendantConf.hireCost
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                      : 'bg-slate-800 text-slate-500 border border-white/5 cursor-not-allowed'
                  }`}
                >
                  Şarjcı Al — ₺{attendantConf.hireCost.toLocaleString('tr-TR')}
                </button>
              ))}
            {isGenerator && (
              <button
                onClick={() => toggleGenerator(building.id)}
                className={`w-full py-3.5 rounded-2xl font-extrabold text-sm transition-all shadow-lg active:scale-98 ${
                  building.generatorOff
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                    : 'bg-[#d83f3f] hover:bg-[#c63232] text-white'
                }`}
              >
                {building.generatorOff ? 'Jeneratörü Çalıştır' : 'Jeneratörü Durdur'}
              </button>
            )}
            {upgrade ? (
              <button
                onClick={() => upgradeBuilding(building.id)}
                title={upgrade.effectsDescription}
                className={`w-full py-3.5 rounded-2xl font-extrabold text-sm transition-all shadow-lg active:scale-98 ${
                  canAffordUpgrade
                    ? 'bg-[#27a85a] hover:bg-[#20924d] text-white shadow-emerald-950/40'
                    : 'bg-emerald-950/60 text-emerald-200/60 border border-emerald-500/20'
                }`}
              >
                Sv.{building.level + 1} Yükselt — ₺{upgrade.cost.toLocaleString('tr-TR')}
              </button>
            ) : (
              GAME_CONFIG.buildingUpgrades[upgradePathFor(building.type)] && (
                <div className="w-full py-2.5 rounded-2xl bg-slate-800/60 border border-white/5 text-slate-500 text-center font-bold text-xs">
                  Maksimum Seviye (Sv.{building.level})
                </div>
              )
            )}

            {!fixed && (
              <button
                onClick={() => {
                  sounds.playClick();
                  relocateStructure(building.id);
                }}
                className={dark}
              >
                Taşı
              </button>
            )}

            {!fixed && !square && (
              <button onClick={() => rotateBuilding(building.id)} className={dark}>
                Döndür
              </button>
            )}

            {!fixed && (
              <button
                onClick={() => sellStructure(building.id)}
                className="w-full py-3.5 bg-[#d83f3f] hover:bg-[#c63232] active:scale-98 text-white rounded-2xl font-extrabold text-sm transition-all shadow-lg"
              >
                Yık — +₺{value.toLocaleString('tr-TR')}
              </button>
            )}

            {fixed && (
              <div className="w-full py-2.5 rounded-2xl bg-slate-800/60 border border-white/5 text-slate-500 text-center font-bold text-xs">
                İstasyonun sabit donanımı — taşınmaz, satılmaz
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
