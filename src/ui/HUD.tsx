import React, { useState } from 'react';
import { useGameStore, EDIT_MODE_LEVEL } from '../store/gameStore';
import { Award, Bell, Building2, Cloud, CloudRain, Crosshair, Fuel, Hammer, Landmark, Map as MapIcon, Move, Power, RotateCcw, RotateCw, Settings as SettingsIcon, ShieldAlert, Sparkles, Sun, Tag, Target, Trash2, Users, ZoomIn, ZoomOut } from 'lucide-react';
import { GAME_CONFIG, upgradePathFor } from '../config/gameConfig';
import { absorbedByRestComplex } from '../domain/services/placement';
import { calculateRepairCost } from '../domain/formulas/economy';
import { drivewaySideAt, hourOfDay } from '../domain/services/simulationEngine';
import { ActiveEventsBar } from './ActiveEventsBar';
import { TankerStatusBar } from './TankerStatusBar';
import { PumpPanel } from './PumpPanel';

const WEATHER_DISPLAY = {
  SUNNY: { icon: Sun, color: 'text-amber-400', label: 'Güneşli' },
  OVERCAST: { icon: Cloud, color: 'text-slate-300', label: 'Parçalı Bulutlu' },
  RAIN: { icon: CloudRain, color: 'text-sky-400', label: 'Yağmurlu' }
} as const;

export const HUD: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const activeModal = useGameStore((s) => s.activeModal);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const rotateCamera = useGameStore((s) => s.rotateCamera);
  const setCameraZoom = useGameStore((s) => s.setCameraZoom);
  const cleanStation = useGameStore((s) => s.cleanStation);
  const buildMode = useGameStore((s) => s.buildMode);
  const confirmBuildPlacement = useGameStore((s) => s.confirmBuildPlacement);
  const rotateBuildPreview = useGameStore((s) => s.rotateBuildPreview);
  const exitBuildMode = useGameStore((s) => s.exitBuildMode);
  const resetCamera = useGameStore((s) => s.resetCamera);
  const landMode = useGameStore((s) => s.landMode);
  const enterLandMode = useGameStore((s) => s.enterLandMode);
  const exitLandMode = useGameStore((s) => s.exitLandMode);
  const upgradeRoad = useGameStore((s) => s.upgradeRoad);
  const selectedBuildingId = useGameStore((s) => s.selectedBuildingId);
  const selectedPumpId = useGameStore((s) => s.selectedPumpId);
  const selectBuilding = useGameStore((s) => s.selectBuilding);
  const selectPump = useGameStore((s) => s.selectPump);
  const structureValue = useGameStore((s) => s.structureValue);
  const sellStructure = useGameStore((s) => s.sellStructure);
  const upgradeBuilding = useGameStore((s) => s.upgradeBuilding);
  const toggleStationOpen = useGameStore((s) => s.toggleStationOpen);
  const editMode = useGameStore((s) => s.editMode);
  const toggleEditMode = useGameStore((s) => s.toggleEditMode);
  const canEdit = gameState.player.level >= EDIT_MODE_LEVEL;

  const { player, dayState, tanks } = gameState;

  // The pump or building under the cursor's last click, if any.
  // What a rest complex would swallow if it were placed where the preview is.
  const wouldAbsorb =
    buildMode.active && buildMode.buildingType === 'rest_complex'
      ? absorbedByRestComplex(gameState, drivewaySideAt(buildMode.position[1]))
      : [];

  // Pumps open their own card (PumpPanel); this bar serves buildings only.
  const selected = (() => {
    if (selectedPumpId) return null;
    const building = selectedBuildingId ? gameState.buildings[selectedBuildingId] : null;
    if (!building) return null;

    return {
      id: building.id,
      level: building.level,
      name: GAME_CONFIG.buildings[building.type]?.name ?? building.type,
      value: structureValue(building.id),
      upgrade:
        GAME_CONFIG.buildingUpgrades[upgradePathFor(building.type)]?.[building.level + 1] ?? null
    };
  })();
  const claimableMissions = gameState.missions.filter((m) => m.completed && !m.claimed).length;
  const unreadNotifications = gameState.notifications.filter((n) => !n.read).length;
  const weatherStyle = WEATHER_DISPLAY[dayState.weather] || WEATHER_DISPLAY.SUNNY;
  const WeatherIcon = weatherStyle.icon;

  // Format Game Time (e.g. 6.5 -> 06:30)
  // The clock counts past midnight to keep the day one rising number, so the
  // face shows the hour of the day rather than the raw value.
  const hours = Math.floor(hourOfDay(dayState.gameTime));
  const minutes = Math.floor((dayState.gameTime % 1) * 60);
  const timeFormatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

  // Find next level xp target
  const nextLvlConf = GAME_CONFIG.levels.find((l) => l.level === player.level + 1);
  const currentLvlConf = GAME_CONFIG.levels.find((l) => l.level === player.level);
  const prevXp = currentLvlConf ? currentLvlConf.requiredTotalXp : 0;
  const targetXp = nextLvlConf ? nextLvlConf.requiredTotalXp : prevXp + 1000;
  const xpPercent = Math.min(100, Math.max(0, ((player.xp - prevXp) / (targetXp - prevXp)) * 100));

  // Critical stock warning
  const isGasolineCritical = tanks.gasoline.stock <= tanks.gasoline.capacity * 0.15;

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 font-sans select-none z-10">
      {/* ================= TOP BAR ================= */}
      <div className="flex justify-between items-start w-full">
        {/* Top-Left: Day, Clock & Time Controls */}
        <div className="bg-slate-900/90 border border-slate-700/80 backdrop-blur-md rounded-2xl p-2.5 shadow-2xl pointer-events-auto flex items-center gap-3.5">
          <div className="flex items-center gap-2 border-r border-slate-700/80 pr-3">
            <div className="w-8 h-8 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold font-mono text-sm border border-sky-500/30">
              G{dayState.currentDay}
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                {weatherStyle.label}
              </div>
              <div className="text-base font-extrabold font-mono text-white flex items-center gap-1.5">
                <WeatherIcon className={`w-3.5 h-3.5 ${weatherStyle.color}`} />
                {timeFormatted}
              </div>
            </div>
          </div>

          {/* Open / closed. Shutting up shop stops new arrivals without
              stopping the clock, so the player can rebuild in peace. */}
          <button
            onClick={toggleStationOpen}
            className={`px-2.5 py-1.5 rounded-xl text-[10px] font-extrabold uppercase tracking-wider border transition-all flex items-center gap-1.5 ${
              gameState.station.open
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/25'
                : 'bg-red-500/15 text-red-400 border-red-500/40 hover:bg-red-500/25'
            }`}
            title={gameState.station.open ? 'İstasyonu kapat' : 'İstasyonu aç'}
          >
            <Power className="w-3.5 h-3.5" />
            {gameState.station.open ? 'Açık' : 'Kapalı'}
          </button>
        </div>

        {/* Top-Center: Cash Balance & Today's Net Revenue */}
        <div className="bg-slate-900/90 border border-slate-700/80 backdrop-blur-md rounded-2xl px-5 py-2.5 shadow-2xl pointer-events-auto flex items-center gap-4 text-center">
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">İstasyon Kasası</div>
            <div className="text-xl font-black font-mono text-emerald-400 tracking-tight flex items-center justify-center gap-1">
              <span>₺</span>
              <span>{player.cash.toLocaleString('tr-TR')}</span>
            </div>
          </div>
          <div className="h-7 w-px bg-slate-700/80" />
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Bugün Gelir</div>
            <div className="text-sm font-bold font-mono text-sky-400">
              +₺{dayState.todayStats.fuelRevenue.toLocaleString('tr-TR')}
            </div>
          </div>
        </div>

        {/* Top-Right: Reputation, Level & XP */}
        <div className="bg-slate-900/90 border border-slate-700/80 backdrop-blur-md rounded-2xl p-2.5 shadow-2xl pointer-events-auto flex items-center gap-3.5">
          {/* Reputation Stars */}
          <div className="flex items-center gap-1.5 border-r border-slate-700/80 pr-3">
            <span className="text-amber-400 text-base">★</span>
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">İtibar</div>
              <div className="text-sm font-extrabold font-mono text-amber-400">
                {player.reputation.toFixed(2)} <span className="text-[10px] text-slate-400">/ 5.00</span>
              </div>
            </div>
          </div>

          {/* Level & XP */}
          <div>
            <div className="flex justify-between items-center text-[10px] font-bold text-slate-300 mb-0.5">
              <span>Seviye {player.level}</span>
              <span className="text-slate-400 font-mono">{player.xp} XP</span>
            </div>
            <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-300"
                style={{ width: `${xpPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ================= FLOATING ACTION & CAMERA WIDGETS ================= */}
      <div className="flex justify-between items-end w-full mb-2">
        {/* Left Widget: Camera Controls & Cleaning */}
        <div className="flex flex-col gap-2 pointer-events-auto">
          {/* Camera Rotation and Zoom Buttons */}
          <div className="bg-slate-900/90 border border-slate-700/80 backdrop-blur-md p-1.5 rounded-2xl shadow-2xl flex flex-col gap-1 w-10">
            <button
              onClick={() => rotateCamera('LEFT')}
              className="p-2 rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white transition-all flex items-center justify-center"
              title="Kamerayı Sola Döndür (Q)"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => rotateCamera('RIGHT')}
              className="p-2 rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white transition-all flex items-center justify-center"
              title="Kamerayı Sağa Döndür (E)"
            >
              <RotateCw className="w-4 h-4" />
            </button>
            <div className="h-px bg-slate-700 mx-1 my-0.5" />
            <button
              onClick={() => setCameraZoom((z) => z + 1)}
              className="p-2 rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white transition-all flex items-center justify-center"
              title="Yakınlaş (+)"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCameraZoom((z) => z - 1)}
              className="p-2 rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white transition-all flex items-center justify-center"
              title="Uzaklaş (-)"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <div className="h-px bg-slate-700 mx-1 my-0.5" />
            <button
              onClick={resetCamera}
              className="p-2 rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white transition-all flex items-center justify-center"
              title="Kamerayı Ortala (F) — Sürükle: kaydır, Tekerlek: yakınlaştır"
            >
              <Crosshair className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Clean Station Button */}
          <button
            onClick={cleanStation}
            className="bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-white text-xs font-bold px-3 py-2 rounded-2xl shadow-2xl flex items-center gap-2 transition-all hover:scale-105"
            title="İstasyon Sahasını Temizle (300 TL)"
          >
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>Temizle (%{Math.round(gameState.station.cleanliness)})</span>
          </button>
        </div>

        {/* Buying land needs no caption telling the player to click a parcel —
            the parcels light up on their own. What it does need is the one
            action that has nowhere else to live. */}
        {landMode.active && gameState.station.roadLevel < 2 && (
          <button
            onClick={upgradeRoad}
            className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-4 py-2.5 rounded-2xl shadow-2xl pointer-events-auto flex flex-col items-start leading-tight animate-fade-in"
            title={`Seviye ${GAME_CONFIG.roadUpgrade.minLevel}, ${GAME_CONFIG.roadUpgrade.minReputation.toFixed(2)} itibar gerekir`}
          >
            <span>Yolu Genişlet — ₺{GAME_CONFIG.roadUpgrade.price.toLocaleString('tr-TR')}</span>
            <span className="text-[10px] font-semibold text-amber-100/80">
              Çift şerit + yolun karşısı açılır
            </span>
          </button>
        )}

        {/* Center / Right: Build Mode Placement Bar (When active) */}
        {buildMode.active && (
          <div className="bg-slate-900/95 border-2 border-sky-500 backdrop-blur-md rounded-2xl px-4 py-3 shadow-2xl pointer-events-auto flex items-center gap-3 animate-fade-in">
            <button
              onClick={rotateBuildPreview}
              className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl border border-slate-600 flex items-center gap-1.5"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Döndür (R)</span>
            </button>
            <button
              onClick={() => {
                if (wouldAbsorb.length > 0) setConfirmMerge(true);
                else confirmBuildPlacement();
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg flex items-center gap-1.5"
            >
              <span>Onayla & İnşa Et</span>
            </button>
            <button
              onClick={exitBuildMode}
              className="bg-red-600/80 hover:bg-red-600 text-white text-xs font-bold px-3 py-2 rounded-xl"
            >
              İptal
            </button>
          </div>
        )}

        {/* A rest complex replaces the parade it is built over, and that is
            not something to discover after paying for it. */}
        {confirmMerge && buildMode.active && (
          <div className="bg-slate-900/97 border-2 border-amber-500 backdrop-blur-md rounded-2xl px-6 py-4 shadow-2xl pointer-events-auto max-w-md animate-fade-in">
            <div className="flex items-center gap-2 text-amber-400 font-extrabold text-sm mb-1">
              <ShieldAlert className="w-4 h-4" />
              Mevcut Yapılar Birleştirilecek
            </div>
            <p className="text-xs text-slate-300 leading-relaxed mb-3">
              Dinlenme Tesisi; market, restoran, kahveci ve WC birimlerini tek çatı
              altında toplar. Bu tesisi kurarsanız aşağıdaki yapılar sökülecek ve
              yerine tek bir tesis geçecek — <b>bedelleri iade edilmez</b>.
            </p>
            <ul className="text-xs text-white font-bold mb-4 space-y-0.5">
              {wouldAbsorb.map((b) => (
                <li key={b.id}>• {b.name}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setConfirmMerge(false);
                  confirmBuildPlacement();
                }}
                className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-4 py-2 rounded-xl"
              >
                Anladım, Birleştir
              </button>
              <button
                onClick={() => setConfirmMerge(false)}
                className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-3 py-2 rounded-xl border border-slate-600"
              >
                Vazgeç
              </button>
            </div>
          </div>
        )}

        {/* Whatever the player has clicked on: what it is worth, and the two
            things they can do with it. */}
        {selected && !buildMode.active && (
          <div className="bg-slate-900/95 border-2 border-sky-500 backdrop-blur-md rounded-2xl px-5 py-3 shadow-2xl pointer-events-auto flex items-center gap-4 animate-fade-in">
            <div>
              <div className="text-xs uppercase font-bold text-sky-400">
                {selected.name} · Sv{selected.level}
              </div>
              <div className="text-sm font-extrabold text-white">
                Satış değeri ₺{selected.value.toLocaleString('tr-TR')}
              </div>
            </div>
            {selected.upgrade && (
              <button
                onClick={() => upgradeBuilding(selected.id)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg flex items-center gap-1.5"
                title={selected.upgrade.effectsDescription}
              >
                <span>Sv{selected.level + 1} Yükselt · ₺{selected.upgrade.cost.toLocaleString('tr-TR')}</span>
              </button>
            )}
            <button
              onClick={() => sellStructure(selected.id)}
              className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Sat</span>
            </button>
            <button
              onClick={() => {
                selectBuilding(null);
                selectPump(null);
              }}
              className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-3 py-2 rounded-xl border border-slate-600"
            >
              Kapat
            </button>
          </div>
        )}

        {/* Critical Stock Warning Banner */}
        {isGasolineCritical && (
          <button
            onClick={() => setActiveModal('FUEL_ORDER')}
            className="bg-red-600 hover:bg-red-500 text-white text-xs font-extrabold px-4 py-2.5 rounded-2xl shadow-2xl pointer-events-auto flex items-center gap-2 animate-pulse"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>KRİTİK STOK: Benzin Siparişi Ver!</span>
          </button>
        )}

        <ActiveEventsBar />
      </div>

      <TankerStatusBar />
      <PumpPanel />

      {/* ================= BOTTOM ACTION BAR ================= */}
      <div className="flex justify-center items-center w-full">
        <div className="bg-slate-900/90 border border-slate-700/80 backdrop-blur-md rounded-2xl p-1.5 shadow-2xl pointer-events-auto flex items-center gap-1">
          <button
            onClick={() => setActiveModal('OFFICE')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeModal === 'OFFICE' ? 'bg-sky-600 text-white shadow-lg' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Building2 className="w-4 h-4 text-sky-400" />
            <span>Ofis</span>
          </button>

          <button
            onClick={() => setActiveModal('BUILD')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeModal === 'BUILD' ? 'bg-sky-600 text-white shadow-lg' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Hammer className="w-4 h-4 text-amber-400" />
            <span>İnşaat</span>
          </button>

          {/* One switch for rearranging what is already built, in place of a
              move button on every structure panel. */}
          <button
            onClick={toggleEditMode}
            disabled={!canEdit}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              !canEdit
                ? 'text-slate-600 cursor-not-allowed'
                : editMode
                  ? 'bg-sky-600 text-white shadow-lg'
                  : 'text-slate-300 hover:bg-slate-800'
            }`}
            title={
              canEdit
                ? 'Yapıları taşımak için aç, sonra taşımak istediğin yapıya tıkla'
                : `Seviye ${EDIT_MODE_LEVEL} gerekiyor`
            }
          >
            <Move
              className={`w-4 h-4 ${editMode ? 'text-white' : canEdit ? 'text-sky-400' : 'text-slate-600'}`}
            />
            <span>Düzenle</span>
          </button>

          <button
            onClick={() => (landMode.active ? exitLandMode() : enterLandMode())}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              landMode.active ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <MapIcon className="w-4 h-4 text-emerald-400" />
            <span>Arsa Al</span>
          </button>

          <button
            onClick={() => setActiveModal('MISSIONS')}
            className={`relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeModal === 'MISSIONS' ? 'bg-sky-600 text-white shadow-lg' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Target className="w-4 h-4 text-rose-400" />
            <span>Görevler</span>
            {claimableMissions > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] font-extrabold flex items-center justify-center animate-pulse">
                {claimableMissions}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveModal('FUEL_ORDER')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeModal === 'FUEL_ORDER' ? 'bg-sky-600 text-white shadow-lg' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Fuel className="w-4 h-4 text-emerald-400" />
            <span>Yakıt Tedarik</span>
          </button>

          <button
            onClick={() => setActiveModal('STAFF')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeModal === 'STAFF' ? 'bg-sky-600 text-white shadow-lg' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4 text-indigo-400" />
            <span>Personel & Müdür</span>
          </button>

          <button
            onClick={() => setActiveModal('PRICING')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeModal === 'PRICING' ? 'bg-sky-600 text-white shadow-lg' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Tag className="w-4 h-4 text-purple-400" />
            <span>Fiyatlandırma</span>
          </button>

          <button
            onClick={() => setActiveModal('BANK')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeModal === 'BANK' ? 'bg-sky-600 text-white shadow-lg' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Landmark className="w-4 h-4 text-emerald-400" />
            <span>Banka & Kredi</span>
          </button>

          {/* Toasts leave on their own, so the bell is where anything missed
              is still findable. The badge counts what has not been looked at. */}
          <button
            onClick={() => setActiveModal('NOTIFICATIONS')}
            className={`relative p-2 rounded-xl text-slate-300 hover:bg-slate-800 transition-all ${
              activeModal === 'NOTIFICATIONS' ? 'bg-sky-600 text-white' : ''
            }`}
            title="Bildirimler"
          >
            <Bell className="w-4 h-4" />
            {unreadNotifications > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[1rem] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-extrabold flex items-center justify-center tabular-nums">
                {unreadNotifications > 9 ? '9+' : unreadNotifications}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveModal('SETTINGS')}
            className={`p-2 rounded-xl text-slate-300 hover:bg-slate-800 transition-all ${
              activeModal === 'SETTINGS' ? 'bg-sky-600 text-white' : ''
            }`}
            title="Ayarlar"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
