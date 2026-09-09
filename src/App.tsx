import React, { useEffect, useMemo, useState } from 'react';
import { StationScene } from './rendering/StationScene';
import { HUD } from './ui/HUD';
import { ModalContainer } from './ui/ModalContainer';
import { TourOverlay } from './ui/TourOverlay';
import { FeedbackButton } from './ui/FeedbackButton';
import { UnsupportedGraphics } from './ui/UnsupportedGraphics';
import { probeWebGL2 } from './services/graphicsSupport';
import { NotificationToast } from './ui/NotificationToast';
import { PerformanceOverlay } from './ui/PerformanceOverlay';
import { SimulationLoop } from './simulation/SimulationLoop';
import { useGameStore } from './store/gameStore';
import { watchAccount, finishRedirectSignIn, describeAuthError } from './services/account';
import { sounds } from './audio/soundEffects';
import {
  WelcomeGate,
  GateCurtain,
  SPLASH_FADE_MS,
  gateIsOpen,
  gateSettled,
  splashHoldMs
} from './ui/WelcomeGate';
import {
  ElectricVehicleShowcase,
  ModelShowcase,
  PumpDockingShowcase
} from './rendering/ModelShowcase';
import { BuildingShowcase } from './rendering/BuildingShowcase';

/** How often a changed save goes up to the cloud, in milliseconds. */
const CLOUD_PUSH_EVERY_MS = 10_000;

/** Pixels of virtual drag one arrow-key press is worth. */
const PAN_STEP_PX = 60;

export const App: React.FC = () => {
  // Asked once, before any scene mounts: a browser with no WebGL 2 gets a
  // card that says so instead of a black screen (Emre, 2026-09-09).
  const graphics = useMemo(probeWebGL2, []);
  const [tryAnyway, setTryAnyway] = useState(false);
  const rotateCamera = useGameStore((s) => s.rotateCamera);
  const gateOpen = useGameStore((s) =>
    gateIsOpen({ accountReady: s.accountReady, accountResolved: s.accountResolved, account: s.account })
  );
  // Firebase "kim var kim yok" demeden oyun çizilmez: yoksa girişsiz oyuncu
  // kapı gelene kadar oyunu görür (Emre, 2026-09-09).
  const settled = useGameStore((s) =>
    gateSettled({ accountReady: s.accountReady, accountResolved: s.accountResolved })
  );

  // The splash (Emre, 2026-09-09: "o kadar hızlı ki hiçbir şey gözükmüyor").
  // index.html paints it before any script runs; on mount React takes it
  // over pixel for pixel and drops the static copy. It then stays until
  // Firebase has decided AND a minimum time since the first paint has
  // passed, and fades out over whatever is underneath — gate or game.
  const [splashHeld, setSplashHeld] = useState(true);
  const [curtain, setCurtain] = useState<'on' | 'leaving' | 'off'>('on');
  useEffect(() => {
    document.getElementById('splash')?.remove();
    const id = window.setTimeout(() => setSplashHeld(false), splashHoldMs(performance.now()));
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (curtain === 'on' && !splashHeld && settled) setCurtain('leaving');
  }, [curtain, splashHeld, settled]);
  // Ayrı efekt: aynı efekte koyunca 'leaving'e geçiş kendi temizleyicisini
  // tetikleyip zamanlayıcıyı iptal ediyordu, perde görünmez ama asılı kalıyordu.
  useEffect(() => {
    if (curtain !== 'leaving') return;
    const id = window.setTimeout(() => setCurtain('off'), SPLASH_FADE_MS);
    return () => window.clearTimeout(id);
  }, [curtain]);

  const gameVisible = curtain !== 'on' && !gateOpen;

  // Oturum, oyunun değil tarayıcının ömrünü yaşar: Firebase kim olduğumuzu
  // söyledikçe store'a işlenir. Yapılandırma yoksa watchAccount tek seferlik
  // null der ve bir daha ses çıkarmaz — oyun yerel kayıtla oynanır.
  // The sound settings live in the save; the engine has to be told them at
  // start-up and whenever they change, or a muted station comes back loud
  // after a refresh (Emre, 2026-09-07).
  const masterVolume = useGameStore((s) => s.gameState.settings.masterVolume);
  const sfxVolume = useGameStore((s) => s.gameState.settings.sfxVolume);
  useEffect(() => {
    sounds.setMasterVolume(masterVolume);
    sounds.toggleMute(sfxVolume <= 0);
  }, [masterVolume, sfxVolume]);

  // The first-run tour (Emre, 2026-09-09): once the gate is through and the
  // station is on screen, a player who has never taken it gets it. A moment's
  // delay lets the scene draw first, so the spotlight has something to cut.
  const tourSeen = useGameStore((s) => s.gameState.settings.tourSeen ?? false);
  const startTour = useGameStore((s) => s.startTour);
  useEffect(() => {
    if (!gameVisible || tourSeen) return;
    const id = window.setTimeout(startTour, 1500);
    return () => window.clearTimeout(id);
  }, [gameVisible, tourSeen, startTour]);

  // The palette is a data attribute on the root: every token in index.css
  // reads through it, so the whole HUD turns with one switch.
  const theme = useGameStore((s) => s.gameState.settings.theme ?? 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(
    () => watchAccount((profile) => useGameStore.setState({ account: profile, accountResolved: true })),
    []
  );
  // Back from a redirect sign-in (the popup-blocked fallback): a failure
  // would otherwise vanish; a success comes through watchAccount.
  useEffect(() => {
    finishRedirectSignIn().catch((error) => useGameStore.setState({ accountError: describeAuthError(error) }));
  }, []);

  // The cloud copy of the save (Emre, 2026-09-09). When an account signs in
  // the two copies are reconciled; after that the local save goes up every
  // ten seconds it has changed, and once more when the tab is left. Ten,
  // not thirty: a player who closes the tab and opens it elsewhere should
  // find the last few moments too, and a save is a dozen kilobytes.
  const accountUid = useGameStore((s) => s.account?.uid ?? null);
  const accountProvider = useGameStore((s) => s.account?.provider ?? null);
  const syncCloudSave = useGameStore((s) => s.syncCloudSave);
  const pushCloudSaveNow = useGameStore((s) => s.pushCloudSaveNow);
  useEffect(() => {
    if (!accountUid || accountProvider === 'guest') return;
    void syncCloudSave();
    const push = () => {
      const { gameState, cloudSync } = useGameStore.getState();
      if (gameState.updatedAt > cloudSync.pushedAt) void pushCloudSaveNow();
    };
    const id = window.setInterval(push, CLOUD_PUSH_EVERY_MS);
    const onHide = () => { if (document.visibilityState === 'hidden') push(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', push);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', push);
    };
  }, [accountUid, accountProvider, syncCloudSave, pushCloudSaveNow]);
  const setCameraZoom = useGameStore((s) => s.setCameraZoom);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const buildMode = useGameStore((s) => s.buildMode);
  const rotateBuildPreview = useGameStore((s) => s.rotateBuildPreview);
  const nudgeBuildPreview = useGameStore((s) => s.nudgeBuildPreview);
  const exitBuildMode = useGameStore((s) => s.exitBuildMode);
  const panCamera = useGameStore((s) => s.panCamera);
  const resetCamera = useGameStore((s) => s.resetCamera);

  // Keyboard Shortcuts (GDD Section 6.4)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid triggering when focused on input fields
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'q':
          rotateCamera('LEFT');
          break;
        case 'e':
          rotateCamera('RIGHT');
          break;
        case 'b':
          if (buildMode.active) exitBuildMode();
          else setActiveModal('BUILD');
          break;
        case 'r':
          if (buildMode.active) rotateBuildPreview();
          break;
        case 'escape':
          if (buildMode.active) exitBuildMode();
          else setActiveModal('NONE');
          break;
        case '+':
        case '=':
          setCameraZoom((z) => z + 1);
          break;
        case '-':
        case '_':
          setCameraZoom((z) => z - 1);
          break;
        // Arrow keys and WASD nudge the camera around the forecourt.
        case 'arrowup':
        case 'w':
          e.preventDefault();
          if (buildMode.active && buildMode.pinned) nudgeBuildPreview('UP');
          else panCamera(0, PAN_STEP_PX);
          break;
        case 'arrowdown':
        case 's':
          e.preventDefault();
          if (buildMode.active && buildMode.pinned) nudgeBuildPreview('DOWN');
          else panCamera(0, -PAN_STEP_PX);
          break;
        case 'arrowleft':
        case 'a':
          e.preventDefault();
          if (buildMode.active && buildMode.pinned) nudgeBuildPreview('LEFT');
          else panCamera(PAN_STEP_PX, 0);
          break;
        case 'arrowright':
        case 'd':
          e.preventDefault();
          if (buildMode.active && buildMode.pinned) nudgeBuildPreview('RIGHT');
          else panCamera(-PAN_STEP_PX, 0);
          break;
        case 'f':
          resetCamera();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    rotateCamera,
    setCameraZoom,
    setActiveModal,
    buildMode.active,
    buildMode.pinned,
    rotateBuildPreview,
    nudgeBuildPreview,
    exitBuildMode,
    panCamera,
    resetCamera
  ]);

  if (!graphics.supported && !tryAnyway) {
    return <UnsupportedGraphics onTryAnyway={() => setTryAnyway(true)} />;
  }

  // Development aid: model line-ups for reviewing art, instead of the game.
  if (typeof window !== 'undefined') {
    const showcase = new URLSearchParams(window.location.search).get('showcase');
    if (showcase === 'buildings') return <BuildingShowcase />;
    if (showcase === 'ev') return <ElectricVehicleShowcase />;
    if (showcase === 'docking') return <PumpDockingShowcase />;
    if (showcase) return <ModelShowcase />;
  }

  return (
    <div className="w-screen h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col relative select-none font-sans">
      <SimulationLoop />
      {/* Kapı açıkken oyun sahnesini ve HUD'ı hiç çizmeyiz: kapının kendi 3B
          sahnesi var, ikisi birden iki WebGL bağlamı demek olurdu. */}
      {gameVisible && (
        <>
          <StationScene />
          <HUD />
          <ModalContainer />
          <FeedbackButton />
          <TourOverlay />
        </>
      )}
      {curtain !== 'on' && <WelcomeGate />}
      {curtain !== 'off' && <GateCurtain leaving={curtain === 'leaving'} />}
      <NotificationToast />
      <PerformanceOverlay />
    </div>
  );
};
