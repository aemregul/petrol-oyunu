import React, { useLayoutEffect, useRef, useState } from 'react';
import { useGameStore, EDIT_MODE_LEVEL } from '../store/gameStore';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, Box, Building2, Check, Cloud, CloudRain, ClipboardList, Crosshair, Eye, Fuel, Grid2x2, Hammer, Map as MapIcon, Move, Power, RotateCcw, RotateCw, Settings as SettingsIcon, ShieldAlert, Sun, Target, Umbrella, UserRound, Users, X } from 'lucide-react';
import { GAME_CONFIG } from '../config/gameConfig';
import { absorbedByRestComplex } from '../domain/services/placement';
import { calculateRepairCost } from '../domain/formulas/economy';
import { drivewaySideAt, hourOfDay } from '../domain/services/simulationEngine';
import { ActiveEventsBar } from './ActiveEventsBar';
import { TankerStatusBar } from './TankerStatusBar';
import { StockStrip } from './StockStrip';
import { PumpPanel } from './PumpPanel';
import { FacilityPanel } from './FacilityPanel';
import { StructurePanel } from './StructurePanel';
import { CAMERA_VIEWS, type CameraViewId } from '../rendering/cameraFrame';
import { TONE_BUTTON } from './gameStyle';

/** The face the camera button wears in each of the three views. */
const VIEW_ICONS: Record<CameraViewId, React.ElementType> = {
  ISOMETRIC: Box,
  TOP_DOWN: Grid2x2,
  LOW: Eye
};

const WEATHER_DISPLAY = {
  SUNNY: { icon: Sun, color: 'text-kyel-dark', label: 'Güneşli' },
  OVERCAST: { icon: Cloud, color: 'text-ink', label: 'Parçalı Bulutlu' },
  RAIN: { icon: CloudRain, color: 'text-kblu', label: 'Yağmurlu' }
} as const;

export const HUD: React.FC = () => {
  const hudRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const placementDockRef = useRef<HTMLDivElement>(null);
  const gameState = useGameStore((s) => s.gameState);
  const activeModal = useGameStore((s) => s.activeModal);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const openOffice = useGameStore((s) => s.openOffice);
  const officeTab = useGameStore((s) => s.officeTab);
  const rotateCamera = useGameStore((s) => s.rotateCamera);
  const cameraView = useGameStore((s) => s.cameraView);
  const cycleCameraView = useGameStore((s) => s.cycleCameraView);
  const buildMode = useGameStore((s) => s.buildMode);
  const fittingCanopy = useGameStore((s) => s.fittingCanopy);
  const exitCanopyMode = useGameStore((s) => s.exitCanopyMode);
  const confirmBuildPlacement = useGameStore((s) => s.confirmBuildPlacement);
  const rotateBuildPreview = useGameStore((s) => s.rotateBuildPreview);
  const nudgeBuildPreview = useGameStore((s) => s.nudgeBuildPreview);
  const exitBuildMode = useGameStore((s) => s.exitBuildMode);
  const resetCamera = useGameStore((s) => s.resetCamera);
  const landMode = useGameStore((s) => s.landMode);
  const exitLandMode = useGameStore((s) => s.exitLandMode);
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

  // The bottom bar's doors, in the order they sit. Colour marks the door,
  // red marks the one that is open.
  type Door = {
    key: string;
    label: string;
    title: string;
    dot: string;
    badge: number;
    open: () => void;
    isOn: (modal: typeof activeModal, tab: typeof officeTab) => boolean;
  };
  const NAV: Door[] = [
    { key: 'office', label: 'Ofis', title: 'Ofis', dot: 'bg-kyel', badge: 0, open: () => openOffice('summary'), isOn: (m, t) => m === 'OFFICE' && t !== 'missions' },
    { key: 'build', label: 'İnşaat', title: 'İnşaat & Yatırım', dot: 'bg-kblu', badge: 0, open: () => setActiveModal('BUILD'), isOn: (m) => m === 'BUILD' },
    { key: 'fuel', label: 'Tedarik', title: 'Yakıt Siparişi', dot: 'bg-kgrn', badge: 0, open: () => setActiveModal('FUEL_ORDER'), isOn: (m) => m === 'FUEL_ORDER' },
    { key: 'staff', label: 'Personel', title: 'Personel & Müdür', dot: 'bg-kred', badge: 0, open: () => setActiveModal('STAFF'), isOn: (m) => m === 'STAFF' }
  ];
  const ICONS: Array<Door & { icon: React.ElementType; badgeTone: string }> = [
    { key: 'missions', label: '', title: 'Görevler', dot: '', badge: claimableMissions, badgeTone: 'bg-kgrn', icon: ClipboardList, open: () => openOffice('missions'), isOn: (m, t) => m === 'OFFICE' && t === 'missions' },
    { key: 'account', label: '', title: 'Hesabım', dot: '', badge: 0, badgeTone: '', icon: UserRound, open: () => setActiveModal('ACCOUNT'), isOn: (m) => m === 'ACCOUNT' },
    { key: 'bell', label: '', title: 'Bildirimler', dot: '', badge: unreadNotifications, badgeTone: 'bg-kred', icon: Bell, open: () => setActiveModal('NOTIFICATIONS'), isOn: (m) => m === 'NOTIFICATIONS' },
    { key: 'settings', label: '', title: 'Ayarlar', dot: '', badge: 0, badgeTone: '', icon: SettingsIcon, open: () => setActiveModal('SETTINGS'), isOn: (m) => m === 'SETTINGS' }
  ];

  return (
    <div
      ref={hudRef}
      className={`hud-root absolute inset-0 pointer-events-none flex flex-col justify-between font-sans select-none z-10 ${buildMode.active ? 'hud-building' : ''}`}
    >
      {/* ================= TOP STRIP ================= */}
      {/* One strip across the top, the way the Karton mock has it (Emre,
          2026-09-07): the station's name on the left, the figures as
          cardboard tiles in the middle, the clock and the open switch on the
          right. The event cards hang under its right end. */}
      <div className="hud-top flex flex-col items-stretch w-full gap-2">
        <div className="hud-strip game-surface relative pointer-events-auto px-4 py-2 grid grid-cols-[auto_1fr_auto] items-center gap-4">
          <span className="k-tape k-tape-l" aria-hidden="true" />
          <span className="k-tape k-tape-r" aria-hidden="true" />

          {/* The name, as the sign out front spells it. */}
          <div className="hud-brand font-display text-2xl leading-none text-kred whitespace-nowrap" style={{ textShadow: '0.12em 0.12em 0 #f2c230' }}>
            {gameState.station.name || 'Gül Petrol'}
          </div>

          <div className="hud-tiles flex justify-center gap-2 min-w-0">
            <div className="hud-tile bg-card border-2 border-ink rounded-md px-3 py-1 min-w-[8.5rem]">
              <div className="k-label">Kasa</div>
              <div className="font-display text-xl leading-tight text-kgrn tabular-nums">₺{player.cash.toLocaleString('tr-TR')}</div>
            </div>
            <div className="hud-tile bg-card border-2 border-ink rounded-md px-3 py-1 min-w-[7rem]">
              <div className="k-label">Bugün</div>
              <div className="font-display text-xl leading-tight text-kblu tabular-nums">+₺{dayState.todayStats.fuelRevenue.toLocaleString('tr-TR')}</div>
            </div>
            <div className="hud-tile bg-card border-2 border-ink rounded-md px-3 py-1 min-w-[6.5rem]">
              <div className="k-label">İtibar</div>
              <div className="font-display text-xl leading-tight text-kred tabular-nums">★ {player.reputation.toFixed(2)}</div>
            </div>
            <div className="hud-tile bg-card border-2 border-ink rounded-md px-3 py-1 min-w-[6.5rem]" title={`${player.xp} XP`}>
              <div className="k-label">Seviye</div>
              <div className="flex items-center gap-2">
                <span className="font-display text-xl leading-tight text-ink tabular-nums">{player.level}</span>
                <span className="k-bar flex-1 h-2 min-w-[2.5rem]">
                  <i className="bg-kblu" style={{ width: `${xpPercent}%` }} />
                </span>
              </div>
            </div>
          </div>

          <div className="hud-day flex items-center gap-2">
            <div
              className="bg-kyel border-2 border-ink rounded-md px-2.5 py-1 font-display text-base text-ink flex items-center gap-1.5 tabular-nums"
              title={`${weatherStyle.label} · Gün ${dayState.currentDay}`}
            >
              <WeatherIcon className={`w-4 h-4 ${weatherStyle.color}`} />
              {/* The display face has no tabular figures, so a fixed box keeps
                  the strip from twitching as the minutes tick. */}
              <span className="inline-block w-[3.3em] text-center">{timeFormatted}</span>
            </div>
            {/* Open / closed. Shutting up shop stops new arrivals without
                stopping the clock, so the player can rebuild in peace. */}
            <button
              onClick={toggleStationOpen}
              className={`game-btn px-3 py-1 font-display text-base tracking-wide ${
                gameState.station.open ? 'bg-kgrn text-white hover:bg-kgrn-dark' : 'bg-kred text-white hover:bg-kred-dark'
              }`}
              title={gameState.station.open ? 'İstasyonu kapat' : 'İstasyonu aç'}
            >
              {gameState.station.open ? 'AÇIK' : 'KAPALI'}
            </button>
          </div>
        </div>

        {/* Under the strip: what is in the tanks and the battery, centred;
            the day's events hang off the right end. */}
        <div className="flex items-start justify-between gap-2">
          <div className="hud-under-left w-48 shrink-0" />
          <StockStrip />
          <div className="hud-events">
            <ActiveEventsBar />
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
            className="game-surface game-btn w-12 h-12 hover:bg-card flex items-center justify-center text-ink hover:text-ink"
            title={`Bakış açısı: ${currentView.label} — sıradaki: ${nextView.label}`}
          >
            <ViewIcon className="w-5 h-5" />
          </button>

          {/* One switch for rearranging what is already built, in place of a
              move button on every structure panel. It lives with the camera
              controls rather than in the bottom bar (Emre, 2026-09-07). */}
          <button
            onClick={toggleEditMode}
            disabled={!canEdit}
            className={`game-surface game-btn w-12 h-12 flex items-center justify-center transition-all ${
              !canEdit
                ? 'text-mute/50 cursor-not-allowed'
                : editMode
                  ? `${TONE_BUTTON.blue} !border-ink`
                  : 'hover:bg-card text-ink hover:text-ink'
            }`}
            title={
              canEdit
                ? `Düzenle — yapıları taşımak için aç, sonra taşımak istediğin yapıya tıkla${editMode ? ' (açık)' : ''}`
                : `Düzenle — Seviye ${EDIT_MODE_LEVEL} gerekiyor`
            }
            aria-label="Düzenleme modu"
          >
            <Move className={`w-5 h-5 ${editMode ? 'text-white' : canEdit ? 'text-kblu' : 'text-mute/50'}`} />
          </button>

          <div className="game-surface p-1.5 flex flex-col gap-1 w-12">
            <button
              onClick={() => rotateCamera('LEFT')}
              className="p-2 rounded-xl text-ink hover:bg-card hover:text-ink transition-all flex items-center justify-center"
              title="Kamerayı Sola Döndür (Q)"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => rotateCamera('RIGHT')}
              className="p-2 rounded-xl text-ink hover:bg-card hover:text-ink transition-all flex items-center justify-center"
              title="Kamerayı Sağa Döndür (E)"
            >
              <RotateCw className="w-4 h-4" />
            </button>
            <div className="h-px bg-mute/40 mx-1 my-0.5" />
            <button
              onClick={resetCamera}
              className="p-2 rounded-xl text-ink hover:bg-card hover:text-ink transition-all flex items-center justify-center"
              title="Kamerayı Ortala (F) — Sürükle: kaydır, Tekerlek: yakınlaştır"
            >
              <Crosshair className="w-4 h-4" />
            </button>
          </div>

        </div>

        {/* Land is bought and paved from the catalogue's Arsa cards; on the
            map the only thing left to say is which job is on and how to
            stop. */}
        {landMode.active && (
          <div className="fixed bottom-24 inset-x-0 z-40 flex justify-center pointer-events-none">
            <div className="game-surface !border-kgrn px-3 py-2 flex items-center gap-3 text-xs font-bold text-ink pointer-events-auto animate-fade-in">
              <MapIcon className="w-4 h-4 text-kgrn" />
              <span>
                {landMode.intent === 'PAVE'
                  ? 'Beton dökmek için betonsuz parsele tıkla'
                  : 'Satın almak için mavi parsele tıkla'}
              </span>
              <button
                onClick={exitLandMode}
                className={`game-btn rounded-xl w-8 h-8 flex items-center justify-center ${TONE_BUTTON.red}`}
                title="Bitti"
                aria-label="Arsa işini bitir"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Fitting a canopy has no ground preview to cancel, so it gets its
            own way out — without one the mode can only be left by paying for
            a roof. */}
        {fittingCanopy && (
          <div className="fixed bottom-24 inset-x-0 z-40 flex justify-center pointer-events-none">
            <div className="game-surface !border-kblu px-3 py-2 flex items-center gap-3 text-xs font-bold text-ink pointer-events-auto animate-fade-in">
              <Umbrella className="w-4 h-4 text-kblu" />
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
              <div className="hud-placement-hint game-surface !border-kblu px-3 py-2 flex items-center gap-2 text-xs font-bold text-ink">
                <Target className="w-4 h-4 text-kblu" />
                <span>Konumu sabitlemek için sahaya tıkla</span>
              </div>
            ) : (
              <div className="game-surface !border-kblu p-1.5 grid grid-cols-3 gap-1">
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
          <div className="game-surface !border-kyel-dark px-6 py-4 pointer-events-auto max-w-md animate-fade-in">
            <div className="flex items-center gap-2 text-kyel-dark font-extrabold text-sm mb-1">
              <ShieldAlert className="w-4 h-4" />
              Mevcut Yapılar Birleştirilecek
            </div>
            <p className="text-xs text-ink leading-relaxed mb-3">
              Dinlenme Tesisi; market, restoran, kahveci ve WC birimlerini tek çatı
              altında toplar. Bu tesisi kurarsanız aşağıdaki yapılar sökülecek ve
              yerine tek bir tesis geçecek — <b>bedelleri iade edilmez</b>.
            </p>
            <ul className="text-xs text-ink font-bold mb-4 space-y-0.5">
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

      </div>

      <TankerStatusBar />
      <PumpPanel />
      <FacilityPanel />
      <StructurePanel />

      {/* ================= BOTTOM ACTION BAR ================= */}
      <div ref={bottomBarRef} className="hud-bottom flex justify-center items-center w-full">
        <div className="hud-nav game-surface p-1.5 pointer-events-auto flex items-center gap-1.5">
          {NAV.map((item) => {
            const on = item.isOn(activeModal, officeTab);
            return (
              <button
                key={item.key}
                onClick={item.open}
                className={`relative flex items-center gap-2 px-3.5 py-2 font-display text-[15px] tracking-wide border-2 border-ink rounded-md transition-colors ${
                  on ? 'bg-kred text-white' : 'bg-card text-ink hover:bg-board'
                }`}
                title={item.title}
              >
                <span className={`w-3 h-3 rounded-full border-2 border-ink shrink-0 ${item.dot}`} />
                <span className="hud-nav-label">{item.label}</span>
                {item.badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-kgrn border-2 border-ink text-white text-[10px] font-black flex items-center justify-center tabular-nums animate-pulse">
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </button>
            );
          })}

          <span className="w-0.5 h-7 bg-ink/30 mx-0.5" />

          {ICONS.map((item) => {
            const on = item.isOn(activeModal, officeTab);
            return (
              <button
                key={item.key}
                onClick={item.open}
                className={`relative w-9 h-9 flex items-center justify-center border-2 border-ink rounded-md transition-colors ${
                  on ? 'bg-kred text-white' : 'bg-card text-ink hover:bg-board'
                }`}
                title={item.title}
                aria-label={item.title}
              >
                <item.icon className="w-4 h-4" />
                {item.badge > 0 && (
                  <span className={`absolute -top-1.5 -right-1.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full border-2 border-ink text-white text-[10px] font-black flex items-center justify-center tabular-nums ${item.badgeTone}`}>
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
