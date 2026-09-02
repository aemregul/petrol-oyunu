import React, { useLayoutEffect, useRef, useState } from 'react';
import { useGameStore, EDIT_MODE_LEVEL } from '../store/gameStore';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Award, Bell, Box, Building2, Check, Cloud, CloudRain, Crosshair, Eye, Fuel, Grid2x2, Hammer, Landmark, Map as MapIcon, Move, Power, RotateCcw, RotateCw, Settings as SettingsIcon, ShieldAlert, Sparkles, Sun, Tag, Target, Trash2, Umbrella, Users, X } from 'lucide-react';
import { GAME_CONFIG, upgradePathFor } from '../config/gameConfig';
import { absorbedByRestComplex } from '../domain/services/placement';
import { calculateRepairCost } from '../domain/formulas/economy';
import { drivewaySideAt, hourOfDay } from '../domain/services/simulationEngine';
import { ActiveEventsBar } from './ActiveEventsBar';
import { TankerStatusBar } from './TankerStatusBar';
import { PumpPanel } from './PumpPanel';
import { CAMERA_VIEWS, type CameraViewId } from '../rendering/cameraFrame';
import { TONE_BUTTON } from './gameStyle';

/** The face the camera button wears in each of the three views. */
const VIEW_ICONS: Record<CameraViewId, React.ElementType> = {
  ISOMETRIC: Box,
  TOP_DOWN: Grid2x2,
  LOW: Eye
};

const WEATHER_DISPLAY = {
  SUNNY: { icon: Sun, color: 'text-amber-400', label: 'Güneşli' },
  OVERCAST: { icon: Cloud, color: 'text-slate-300', label: 'Parçalı Bulutlu' },
  RAIN: { icon: CloudRain, color: 'text-sky-400', label: 'Yağmurlu' }
} as const;

export const HUD: React.FC = () => {
  const hudRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const placementDockRef = useRef<HTMLDivElement>(null);
  const gameState = useGameStore((s) => s.gameState);
  const activeModal = useGameStore((s) => s.activeModal);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const rotateCamera = useGameStore((s) => s.rotateCamera);
  const cameraView = useGameStore((s) => s.cameraView);
  const cycleCameraView = useGameStore((s) => s.cycleCameraView);
  const cleanStation = useGameStore((s) => s.cleanStation);
  const buildMode = useGameStore((s) => s.buildMode);
  const fittingCanopy = useGameStore((s) => s.fittingCanopy);
  const exitCanopyMode = useGameStore((s) => s.exitCanopyMode);
  const confirmBuildPlacement = useGameStore((s) => s.confirmBuildPlacement);
  const rotateBuildPreview = useGameStore((s) => s.rotateBuildPreview);
  const nudgeBuildPreview = useGameStore((s) => s.nudgeBuildPreview);
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

  // The action bar changes size when labels collapse or the viewport is short.
  // Measure the rendered controls instead of relying on a desktop-only offset.
  useLayoutEffect(() => {
    const hud = hudRef.current;
    const bottomBar = bottomBarRef.current;
    if (!hud || !bottomBar) return;

    const updateSafeAreas = () => {
      const bottomBarRect = bottomBar.getBoundingClientRect();
      const dockRect = placementDockRef.current?.getBoundingClientRect();
      hud.style.setProperty(
        '--hud-bottom-clearance',
        `${Math.max(0, window.innerHeight - bottomBarRect.top) + 12}px`
      );
      hud.style.setProperty('--placement-dock-width', `${dockRect?.width ?? 0}px`);
      hud.style.setProperty('--placement-dock-height', `${dockRect?.height ?? 0}px`);
    };

    updateSafeAreas();
    const observer = new ResizeObserver(updateSafeAreas);
    observer.observe(bottomBar);
    if (placementDockRef.current) observer.observe(placementDockRef.current);
    window.addEventListener('resize', updateSafeAreas);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSafeAreas);
    };
  }, [buildMode.active, buildMode.pinned]);

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

  // The button wears the view it is currently in, and names the one it would
  // move to, so a single glance answers both "where am I" and "what next".
  const currentView = CAMERA_VIEWS[cameraView];
  const nextView = CAMERA_VIEWS[(cameraView + 1) % CAMERA_VIEWS.length];
  const ViewIcon = VIEW_ICONS[currentView.id];
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

  return (
    <div
      ref={hudRef}
      className={`hud-root absolute inset-0 pointer-events-none flex flex-col justify-between font-sans select-none z-10 ${buildMode.active ? 'hud-building' : ''}`}
    >
      {/* ================= TOP BAR ================= */}
      <div className="hud-top flex justify-between items-start w-full">
        {/* Top-Left: Day, Clock & Time Controls */}
        <div className="hud-status-card game-surface p-2.5 pointer-events-auto flex items-center gap-3.5">
          <div className="flex items-center gap-2 border-r border-slate-700/80 pr-3">
            <div className="w-8 h-8 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold font-mono text-sm border border-sky-500/30">
              G{dayState.currentDay}
            </div>
            <div className="hud-status-detail">
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
            <span className="hud-status-detail">{gameState.station.open ? 'Açık' : 'Kapalı'}</span>
          </button>
        </div>

        {/* Top-Center: Cash Balance & Today's Net Revenue */}
        <div className="hud-cash-card game-surface px-5 py-2.5 pointer-events-auto flex items-center gap-4 text-center">
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">İstasyon Kasası</div>
            <div className="text-xl font-black font-mono text-emerald-400 tracking-tight flex items-center justify-center gap-1">
              <span>₺</span>
              <span>{player.cash.toLocaleString('tr-TR')}</span>
            </div>
          </div>
          <div className="hud-revenue h-7 w-px bg-slate-700/80" />
          <div className="hud-revenue">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Bugün Gelir</div>
            <div className="text-sm font-bold font-mono text-sky-400">
              +₺{dayState.todayStats.fuelRevenue.toLocaleString('tr-TR')}
            </div>
          </div>
        </div>

        {/* Top-Right: Reputation, Level & XP */}
        <div className="hud-reputation-card game-surface p-2.5 pointer-events-auto flex items-center gap-3.5">
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
          <div className="hud-xp-detail">
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
      <div className="hud-floating flex justify-between items-end w-full">
        {/* Left Widget: Camera Controls & Cleaning */}
        <div className="flex flex-col gap-2 pointer-events-auto">
          {/* The whole camera rig used to live here as five stacked buttons.
              Zoom is the wheel's job and always was, so what is left is the
              view switch and the two things the wheel cannot do. */}
          <button
            onClick={cycleCameraView}
            className="game-surface game-btn w-12 h-12 hover:bg-slate-800 flex items-center justify-center text-slate-200 hover:text-white"
            title={`Bakış açısı: ${currentView.label} — sıradaki: ${nextView.label}`}
          >
            <ViewIcon className="w-5 h-5" />
          </button>

          <div className="game-surface p-1.5 flex flex-col gap-1 w-12">
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
            className="game-surface game-btn hover:bg-slate-800 text-white text-xs font-extrabold px-3.5 py-2 flex items-center gap-2"
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
            className={`game-btn rounded-2xl px-4 py-2.5 pointer-events-auto flex flex-col items-start leading-tight animate-fade-in text-white text-xs font-extrabold ${TONE_BUTTON.amber}`}
            title={`Seviye ${GAME_CONFIG.roadUpgrade.minLevel}, ${GAME_CONFIG.roadUpgrade.minReputation.toFixed(2)} itibar gerekir`}
          >
            <span>Yolu Genişlet — ₺{GAME_CONFIG.roadUpgrade.price.toLocaleString('tr-TR')}</span>
            <span className="text-[10px] font-semibold text-amber-100/80">
              Çift şerit + yolun karşısı açılır
            </span>
          </button>
        )}

        {/* Fitting a canopy has no ground preview to cancel, so it gets its
            own way out — without one the mode can only be left by paying for
            a roof. */}
        {fittingCanopy && (
          <div className="fixed bottom-24 inset-x-0 z-40 flex justify-center pointer-events-none">
            <div className="game-surface !border-sky-500/70 px-3 py-2 flex items-center gap-3 text-xs font-bold text-slate-100 pointer-events-auto animate-fade-in">
              <Umbrella className="w-4 h-4 text-sky-400" />
              <span>Sundurmanın kurulacağı pompaya tıkla</span>
              <button
                onClick={exitCanopyMode}
                className={`game-btn rounded-xl w-8 h-8 flex items-center justify-center ${TONE_BUTTON.red}`}
                title="Vazgeç"
                aria-label="Sundurma takmaktan vazgeç"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* The preview follows the cursor only until the first ground click.
            Once anchored, this compact corner pad takes over so moving the
            mouse towards its buttons cannot drag the structure away. */}
        {buildMode.active && (
          <div ref={placementDockRef} className="hud-placement-dock fixed z-40 pointer-events-auto flex flex-col items-end gap-2 animate-fade-in">
            {!buildMode.pinned ? (
              <div className="hud-placement-hint game-surface !border-sky-500/70 px-3 py-2 flex items-center gap-2 text-xs font-bold text-slate-100">
                <Target className="w-4 h-4 text-sky-400" />
                <span>Konumu sabitlemek için sahaya tıkla</span>
              </div>
            ) : (
              <div className="game-surface !border-sky-500/70 p-1.5 grid grid-cols-3 gap-1">
                <span />
                <button
                  onClick={() => nudgeBuildPreview('UP')}
                  className={`game-btn w-10 h-10 rounded-xl flex items-center justify-center ${TONE_BUTTON.slate}`}
                  title="Yukarı taşı (↑ / W)"
                  aria-label="Yukarı taşı"
                >
                  <ArrowUp className="w-5 h-5" />
                </button>
                <span />
                <button
                  onClick={() => nudgeBuildPreview('LEFT')}
                  className={`game-btn w-10 h-10 rounded-xl flex items-center justify-center ${TONE_BUTTON.slate}`}
                  title="Sola taşı (← / A)"
                  aria-label="Sola taşı"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={rotateBuildPreview}
                  className={`game-btn w-10 h-10 rounded-xl flex items-center justify-center ${TONE_BUTTON.blue}`}
                  title="Döndür (R)"
                  aria-label="Döndür"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => nudgeBuildPreview('RIGHT')}
                  className={`game-btn w-10 h-10 rounded-xl flex items-center justify-center ${TONE_BUTTON.slate}`}
                  title="Sağa taşı (→ / D)"
                  aria-label="Sağa taşı"
                >
                  <ArrowRight className="w-5 h-5" />
                </button>
                <span />
                <button
                  onClick={() => nudgeBuildPreview('DOWN')}
                  className={`game-btn w-10 h-10 rounded-xl flex items-center justify-center ${TONE_BUTTON.slate}`}
                  title="Aşağı taşı (↓ / S)"
                  aria-label="Aşağı taşı"
                >
                  <ArrowDown className="w-5 h-5" />
                </button>
                <span />
              </div>
            )}

            <div className="flex items-center gap-2">
              {buildMode.pinned && (
                <button
                  onClick={() => {
                    if (wouldAbsorb.length > 0) setConfirmMerge(true);
                    else confirmBuildPlacement();
                  }}
                  className={`game-btn rounded-xl px-4 h-10 text-xs font-extrabold flex items-center gap-1.5 ${TONE_BUTTON.green}`}
                  title="Yapıyı bu konuma yerleştir"
                >
                  <Check className="w-4 h-4" />
                  <span>Yerleştir</span>
                </button>
              )}
              <button
                onClick={exitBuildMode}
                className={`game-btn rounded-xl w-10 h-10 flex items-center justify-center ${TONE_BUTTON.red}`}
                title="İptal (Esc)"
                aria-label="Yerleştirmeyi iptal et"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* A rest complex replaces the parade it is built over, and that is
            not something to discover after paying for it. */}
        {confirmMerge && buildMode.active && (
          <div className="game-surface !border-amber-500 px-6 py-4 pointer-events-auto max-w-md animate-fade-in">
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
                className={`game-btn rounded-xl px-4 py-2 text-xs font-extrabold ${TONE_BUTTON.amber}`}
              >
                Anladım, Birleştir
              </button>
              <button
                onClick={() => setConfirmMerge(false)}
                className={`game-btn rounded-xl px-3 py-2 text-xs font-extrabold ${TONE_BUTTON.slate}`}
              >
                Vazgeç
              </button>
            </div>
          </div>
        )}

        {/* Whatever the player has clicked on: what it is worth, and the two
            things they can do with it. */}
        {selected && !buildMode.active && (
          <div className="game-surface !border-sky-500 px-5 py-3 pointer-events-auto flex items-center gap-4 animate-fade-in">
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
                className={`game-btn rounded-xl px-4 py-2 text-xs font-extrabold flex items-center gap-1.5 ${TONE_BUTTON.green}`}
                title={selected.upgrade.effectsDescription}
              >
                <span>Sv{selected.level + 1} Yükselt · ₺{selected.upgrade.cost.toLocaleString('tr-TR')}</span>
              </button>
            )}
            <button
              onClick={() => sellStructure(selected.id)}
              className={`game-btn rounded-xl px-3.5 py-2 text-xs font-extrabold flex items-center gap-1.5 ${TONE_BUTTON.amber}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Sat</span>
            </button>
            <button
              onClick={() => {
                selectBuilding(null);
                selectPump(null);
              }}
              className={`game-btn rounded-xl px-3 py-2 text-xs font-extrabold ${TONE_BUTTON.slate}`}
            >
              Kapat
            </button>
          </div>
        )}

        {/* Kritik stok uyarısı ekranın ortasını işgal etmez: sağdaki olay
            kartlarının arasında, ActiveEventsBar'ın tepesinde yaşar. */}
        <div className="hud-events">
          <ActiveEventsBar />
        </div>
      </div>

      <TankerStatusBar />
      <PumpPanel />

      {/* ================= BOTTOM ACTION BAR ================= */}
      <div ref={bottomBarRef} className="hud-bottom flex justify-center items-center w-full">
        <div className="hud-nav game-surface p-1.5 pointer-events-auto flex items-center gap-1">
          <button
            onClick={() => setActiveModal('OFFICE')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all ${
              activeModal === 'OFFICE' ? `game-btn ${TONE_BUTTON.blue}` : 'text-slate-300 hover:bg-slate-800 border-2 border-transparent'
            }`}
          >
            <Building2 className="w-4 h-4 text-sky-400" />
            <span className="hud-nav-label">Ofis</span>
          </button>

          <button
            onClick={() => setActiveModal('BUILD')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all ${
              activeModal === 'BUILD' ? `game-btn ${TONE_BUTTON.blue}` : 'text-slate-300 hover:bg-slate-800 border-2 border-transparent'
            }`}
          >
            <Hammer className="w-4 h-4 text-amber-400" />
            <span className="hud-nav-label">İnşaat</span>
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
                  ? `game-btn ${TONE_BUTTON.blue}`
                  : 'text-slate-300 hover:bg-slate-800 border-2 border-transparent'
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
            <span className="hud-nav-label">Düzenle</span>
          </button>

          <button
            onClick={() => (landMode.active ? exitLandMode() : enterLandMode())}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              landMode.active ? `game-btn ${TONE_BUTTON.green}` : 'text-slate-300 hover:bg-slate-800 border-2 border-transparent'
            }`}
          >
            <MapIcon className="w-4 h-4 text-emerald-400" />
            <span className="hud-nav-label">Arsa Al</span>
          </button>

          <button
            onClick={() => setActiveModal('MISSIONS')}
            className={`relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all ${
              activeModal === 'MISSIONS' ? `game-btn ${TONE_BUTTON.blue}` : 'text-slate-300 hover:bg-slate-800 border-2 border-transparent'
            }`}
          >
            <Target className="w-4 h-4 text-rose-400" />
            <span className="hud-nav-label">Görevler</span>
            {claimableMissions > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] font-extrabold flex items-center justify-center animate-pulse">
                {claimableMissions}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveModal('FUEL_ORDER')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all ${
              activeModal === 'FUEL_ORDER' ? `game-btn ${TONE_BUTTON.blue}` : 'text-slate-300 hover:bg-slate-800 border-2 border-transparent'
            }`}
          >
            <Fuel className="w-4 h-4 text-emerald-400" />
            <span className="hud-nav-label">Yakıt Tedarik</span>
          </button>

          <button
            onClick={() => setActiveModal('STAFF')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all ${
              activeModal === 'STAFF' ? `game-btn ${TONE_BUTTON.blue}` : 'text-slate-300 hover:bg-slate-800 border-2 border-transparent'
            }`}
          >
            <Users className="w-4 h-4 text-indigo-400" />
            <span className="hud-nav-label">Personel & Müdür</span>
          </button>

          <button
            onClick={() => setActiveModal('PRICING')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all ${
              activeModal === 'PRICING' ? `game-btn ${TONE_BUTTON.blue}` : 'text-slate-300 hover:bg-slate-800 border-2 border-transparent'
            }`}
          >
            <Tag className="w-4 h-4 text-purple-400" />
            <span className="hud-nav-label">Fiyatlandırma</span>
          </button>

          <button
            onClick={() => setActiveModal('BANK')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all ${
              activeModal === 'BANK' ? `game-btn ${TONE_BUTTON.blue}` : 'text-slate-300 hover:bg-slate-800 border-2 border-transparent'
            }`}
          >
            <Landmark className="w-4 h-4 text-emerald-400" />
            <span className="hud-nav-label">Banka & Kredi</span>
          </button>

          {/* Toasts leave on their own, so the bell is where anything missed
              is still findable. The badge counts what has not been looked at. */}
          <button
            onClick={() => setActiveModal('NOTIFICATIONS')}
            className={`relative p-2 rounded-xl text-slate-300 hover:bg-slate-800 transition-all ${
              activeModal === 'NOTIFICATIONS' ? `game-btn ${TONE_BUTTON.blue}` : 'border-2 border-transparent'
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
              activeModal === 'SETTINGS' ? `game-btn ${TONE_BUTTON.blue}` : 'border-2 border-transparent'
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
