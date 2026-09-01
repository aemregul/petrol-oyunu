import React, { useEffect } from 'react';
import { StationScene } from './rendering/StationScene';
import { HUD } from './ui/HUD';
import { ModalContainer } from './ui/ModalContainer';
import { NotificationToast } from './ui/NotificationToast';
import { PerformanceOverlay } from './ui/PerformanceOverlay';
import { SimulationLoop } from './simulation/SimulationLoop';
import { useGameStore } from './store/gameStore';
import { ModelShowcase } from './rendering/ModelShowcase';
import { BuildingShowcase } from './rendering/BuildingShowcase';

/** Pixels of virtual drag one arrow-key press is worth. */
const PAN_STEP_PX = 60;

export const App: React.FC = () => {
  const rotateCamera = useGameStore((s) => s.rotateCamera);
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

  // Development aid: model line-ups for reviewing art, instead of the game.
  if (typeof window !== 'undefined') {
    const showcase = new URLSearchParams(window.location.search).get('showcase');
    if (showcase === 'buildings') return <BuildingShowcase />;
    if (showcase) return <ModelShowcase />;
  }

  return (
    <div className="w-screen h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col relative select-none font-sans">
      <SimulationLoop />
      <StationScene />
      <HUD />
      <ModalContainer />
      <NotificationToast />
      <PerformanceOverlay />
    </div>
  );
};
