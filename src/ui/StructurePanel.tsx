import React from 'react';
import * as Icons from 'lucide-react';
import { useGameStore, EDIT_MODE_LEVEL } from '../store/gameStore';
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
  hourOfDay,
  evPricePerKwh
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
    ? { text: 'Boşta', tone: 'text-kgrn' }
    : plugged.state === 'FUELING'
      ? { text: 'Şarj ediyor', tone: 'text-kgrn' }
      : { text: 'Müşteri bekliyor', tone: 'text-kyel-dark' };
  const kwhPrice = evPricePerKwh(gameState, building.type === 'ev_charger_dc' ? 'dc' : 'ac');

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
      ? { text: 'Kapalı', tone: 'text-mute' }
      : genRunning
        ? { text: 'Çalışıyor', tone: 'text-kgrn' }
        : dieselForGenerator(gameState.tanks.diesel) <= 0
          ? { text: 'Mazot rezervde', tone: 'text-kred' }
          : { text: 'Batarya yeterli, bekliyor', tone: 'text-kyel-dark' };
  const t = gameState.dayState.todayStats;

  const handleClose = () => {
    sounds.playClick();
    selectBuilding(null);
  };

  // The electric line wears violet; everything else on the ground, green.
  const isEnergy = building.type.startsWith('ev_') || isGenerator;
  const headTone = isEnergy ? 'k-head-vio' : 'k-head-grn';

  const neutral =
    'w-full py-3.5 game-btn bg-card hover:bg-board text-ink font-display tracking-wide text-sm';
  const note =
    'w-full py-2.5 rounded-md bg-board border-2 border-dashed border-mute text-mute text-center font-extrabold text-xs';
  // Rearranging is a late-game luxury; the panel says so rather than offering
  // a button that only warns (Emre, 2026-09-10).
  const lockedBtn =
    'w-full py-3.5 game-btn bg-board text-mute cursor-not-allowed font-display tracking-wide text-sm';
  const canMove = gameState.player.level >= EDIT_MODE_LEVEL;
  const moveLockedHint = `Taşımak için Seviye ${EDIT_MODE_LEVEL} gerekiyor`;

  return (
    <div className="fixed inset-0 pointer-events-none z-40 flex items-center justify-center p-4">
      <div className="w-[340px] max-h-[88vh] overflow-y-auto pointer-events-auto select-none game-surface animate-fade-in flex flex-col">
        <div className={`k-head ${headTone}`}>
          <div className="flex items-center gap-2.5">
            <div className="game-icon-badge w-8 h-8">
              <IconComponent className="w-4 h-4" />
            </div>
            <span>
              {catalog.name}
              {upgrade || building.level > 1 ? ` Sv.${building.level}` : ''}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="game-btn bg-card text-ink w-8 h-8 rounded-md flex items-center justify-center"
            aria-label="Kapat"
          >
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 text-xs">
          <p className="text-ink/80 text-[12px] leading-relaxed font-semibold">{catalog.description}</p>

          <div className="flex flex-col text-xs" data-tour="structure-rows">
            <div className="k-row">
              <span>Günlük bakım</span>
              <span className="text-kred">
                ₺{catalog.dailyUpkeep.toLocaleString('tr-TR')}
              </span>
            </div>
            <div className="k-row">
              <span>Sağlık</span>
              <span className={building.health >= 60 ? 'text-kgrn' : 'text-kyel-dark'}>
                %{Math.round(building.health)}
              </span>
            </div>
            {isPost && (
              <>
                <div className="k-row">
                  <span>Durum</span>
                  <span className={postStatus.tone}>{postStatus.text}</span>
                </div>
                <div className="k-row">
                  <span>Tarife</span>
                  <span>₺{kwhPrice.toFixed(1)}/kWh</span>
                </div>
                <div className="k-row">
                  <span>Şarjcı</span>
                  <span className={`uppercase ${attendant ? 'text-kgrn' : 'text-mute'}`}>
                    {attendant ? 'ÇALIŞIYOR' : 'YOK'}
                  </span>
                </div>
                <div className="k-row">
                  <span>Yovmiye</span>
                  <span className={attendant ? 'text-kred' : 'text-mute'}>
                    ₺{attendant ? attendant.wage : attendantConf.dailyWage}/gün
                  </span>
                </div>
              </>
            )}
            {(isPost || isBank) && (
              <div className="py-1.5 border-b-2 border-dotted border-mute/60">
                <div className="flex justify-between items-center gap-3 text-[13px]">
                  <span className="text-mute font-extrabold">{isBank ? 'Dolu' : 'Batarya'}</span>
                  <span className={`font-display text-[15px] tabular-nums ${bankKwh < 1 ? 'text-kred' : 'text-kblu'}`}>
                    {Math.round(bankKwh)} / {bankCapacity} kWh
                  </span>
                </div>
                <div className="k-bar mt-1.5">
                  <div
                    className="h-full bg-kblu"
                    style={{ width: `${bankCapacity > 0 ? Math.min(100, (bankKwh / bankCapacity) * 100) : 0}%` }}
                  />
                </div>
              </div>
            )}
            {isBank && (
              <>
                <div className="k-row">
                  <span>Şebeke dolumu</span>
                  <span className={feeder ? '' : 'text-kred'}>
                    {feeder
                      ? `${gridKwhPerHourFor(feeder.level)} kWh/sa · ₺${gridNow.toFixed(1)} (${tariffLabel})`
                      : 'Trafo yok'}
                  </span>
                </div>
                <div className="k-row">
                  <span>Güneş</span>
                  <span className={solarNow > 0 ? 'text-kyel-dark' : 'text-mute'}>
                    {solarCells > 0 ? `${solarNow.toFixed(1)} kWh/sa` : 'Panel yok'}
                  </span>
                </div>
              </>
            )}
            {isSubstation && (
              <>
                <div className="k-row">
                  <span>Şebeke sözleşmesi</span>
                  <span>{gridKwhPerHourFor(building.level)} kWh/sa</span>
                </div>
                <div className="k-row">
                  <span>Gece tarifesi</span>
                  <span className="text-kgrn">
                    ₺{GAME_CONFIG.ev.gridTariff.night.price.toFixed(1)}/kWh · {GAME_CONFIG.ev.gridTariff.night.from}:00–{GAME_CONFIG.ev.gridTariff.night.to}:00
                  </span>
                </div>
                <div className="k-row">
                  <span>Gündüz</span>
                  <span>₺{GAME_CONFIG.ev.gridPricePerKwh.toFixed(1)}/kWh</span>
                </div>
                <div className="k-row">
                  <span>Pik</span>
                  <span className="text-kred">
                    ₺{GAME_CONFIG.ev.gridTariff.peak.price.toFixed(1)}/kWh · {GAME_CONFIG.ev.gridTariff.peak.from}:00–{GAME_CONFIG.ev.gridTariff.peak.to}:00
                  </span>
                </div>
                <div className="k-row">
                  <span>Şu an</span>
                  <span className="text-kblu">₺{gridNow.toFixed(1)}/kWh ({tariffLabel})</span>
                </div>
                <div className="k-row">
                  <span>Bugünkü enerji gideri</span>
                  <span className="text-kred">₺{Math.round(t.energyCost ?? 0).toLocaleString('tr-TR')}</span>
                </div>
              </>
            )}
            {isGenerator && genStatus && (
              <>
                <div className="k-row">
                  <span>Durum</span>
                  <span className={genStatus.tone}>{genStatus.text}</span>
                </div>
                <div className="k-row">
                  <span>Üretim</span>
                  <span>{GAME_CONFIG.ev.generator.kwhPerHour} kWh/sa</span>
                </div>
                <div className="k-row">
                  <span>Tüketim</span>
                  <span>
                    {(GAME_CONFIG.ev.generator.kwhPerHour * GAME_CONFIG.ev.generator.litersPerKwh).toFixed(0)} L/sa mazot
                  </span>
                </div>
                <div className="k-row">
                  <span>Devreye girer</span>
                  <span>batarya %{GAME_CONFIG.ev.generator.runBelowPercent} altında</span>
                </div>
                <div className="k-row">
                  <span>Yakılabilir mazot</span>
                  <span>
                    {Math.round(dieselForGenerator(gameState.tanks.diesel)).toLocaleString('tr-TR')} L
                  </span>
                </div>
                <div className="k-row">
                  <span>Bugün</span>
                  <span className="text-kyel-dark">
                    {Math.round(t.generatorKwh ?? 0)} kWh · {Math.round(t.generatorLiters ?? 0)} L
                  </span>
                </div>
              </>
            )}
            {!fixed && (
              <div className="k-row">
                <span>Satış değeri</span>
                <span>₺{value.toLocaleString('tr-TR')}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2.5 pt-1" data-tour="structure-actions">
            {isPost &&
              (attendant ? (
                <button
                  onClick={() => {
                    sounds.playClick();
                    fireAttendant(attendant.id);
                  }}
                  className="w-full py-3.5 game-btn bg-kred hover:bg-kred-dark text-white font-display tracking-wide text-sm"
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
                  className="w-full py-3.5 game-btn bg-kgrn hover:bg-kgrn-dark text-white font-display tracking-wide text-sm"
                >
                  Şarjcı Al — ₺{attendantConf.hireCost.toLocaleString('tr-TR')}
                </button>
              ))}
            {isGenerator && (
              <button
                onClick={() => toggleGenerator(building.id)}
                className={`w-full py-3.5 game-btn font-display tracking-wide text-sm ${
                  building.generatorOff
                    ? 'bg-kgrn hover:bg-kgrn-dark text-white'
                    : 'bg-kred hover:bg-kred-dark text-white'
                }`}
              >
                {building.generatorOff ? 'Jeneratörü Çalıştır' : 'Jeneratörü Durdur'}
              </button>
            )}
            {upgrade ? (
              <button
                onClick={() => upgradeBuilding(building.id)}
                title={upgrade.effectsDescription}
                className={`w-full py-3.5 game-btn font-display tracking-wide text-sm ${
                  canAffordUpgrade ? 'bg-kgrn hover:bg-kgrn-dark text-white' : 'bg-card text-mute'
                }`}
              >
                Sv.{building.level + 1} Yükselt — ₺{upgrade.cost.toLocaleString('tr-TR')}
              </button>
            ) : (
              GAME_CONFIG.buildingUpgrades[upgradePathFor(building.type)] && (
                <div className={note}>
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
                disabled={!canMove}
                title={canMove ? 'Yapıyı kaldır ve yeni yerine koy' : moveLockedHint}
                className={canMove ? neutral : lockedBtn}
              >
                {canMove ? 'Taşı' : `Taşı — Sv.${EDIT_MODE_LEVEL}`}
              </button>
            )}

            {!fixed && !square && (
              <button onClick={() => rotateBuilding(building.id)} className={neutral}>
                Döndür
              </button>
            )}

            {!fixed && (
              <button
                onClick={() => sellStructure(building.id)}
                className="w-full py-3.5 game-btn bg-kred hover:bg-kred-dark text-white font-display tracking-wide text-sm"
              >
                Yık — ₺{value.toLocaleString('tr-TR')} iade
              </button>
            )}

            {fixed && (
              <div className={note}>
                İstasyonun sabit donanımı — taşınmaz, satılmaz
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
