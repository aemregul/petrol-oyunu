import React, { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { TOUR_STEPS } from './tour/tourSteps';
import { sounds } from '../audio/soundEffects';

/**
 * The first-run tour (Emre, 2026-09-09): the screen dims except for a hole
 * cut round the thing being explained, a Karton card sits beside it with
 * an arrow into the hole, and the player steps through with İleri or the
 * arrow keys. Nothing underneath can be clicked while it is up, so the tour
 * cannot be half-followed into a modal.
 *
 * Targets are found by `data-tour` attributes and re-measured a few times a
 * second, because the HUD reflows as its labels change.
 */

const CARD_WIDTH = 380;
const HOLE_PAD = 8;
const EDGE = 12;

type Hole = { x: number; y: number; w: number; h: number };

export const TourOverlay: React.FC = () => {
  const tour = useGameStore((s) => s.tour);
  const nextTourStep = useGameStore((s) => s.nextTourStep);
  const prevTourStep = useGameStore((s) => s.prevTourStep);
  const endTour = useGameStore((s) => s.endTour);
  const step = TOUR_STEPS[tour.step];
  const [hole, setHole] = useState<Hole | null>(null);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    if (!tour.active || !step) return;
    const measure = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null;
      if (!el) {
        setHole(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setHole({ x: r.left - HOLE_PAD, y: r.top - HOLE_PAD, w: r.width + HOLE_PAD * 2, h: r.height + HOLE_PAD * 2 });
    };
    measure();
    const id = window.setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [tour.active, tour.step, step]);

  useEffect(() => {
    if (!tour.active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); nextTourStep(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prevTourStep(); }
      else if (e.key === 'Escape') { e.preventDefault(); endTour(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tour.active, nextTourStep, prevTourStep, endTour]);

  if (!tour.active || !step) return null;

  const last = tour.step === TOUR_STEPS.length - 1;
  const cardW = Math.min(CARD_WIDTH, viewport.w - EDGE * 2);

  // Where the card goes: beside a target on the left edge, otherwise under a
  // target in the top half and over one in the bottom half. No target, the
  // middle of the screen.
  let cardStyle: React.CSSProperties;
  let arrow: React.CSSProperties | null = null;
  if (!hole) {
    cardStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: cardW };
  } else if (hole.x + hole.w / 2 < 200) {
    const left = Math.min(hole.x + hole.w + 18, viewport.w - cardW - EDGE);
    const top = Math.max(EDGE, Math.min(hole.y + hole.h / 2, viewport.h - EDGE - 160));
    cardStyle = { left, top, transform: 'translateY(-50%)', width: cardW };
    arrow = { left: -9, top: '50%', transform: 'translateY(-50%) rotate(45deg)' };
  } else {
    const below = hole.y + hole.h / 2 < viewport.h / 2;
    const left = Math.max(EDGE, Math.min(hole.x + hole.w / 2 - cardW / 2, viewport.w - cardW - EDGE));
    const arrowX = Math.max(24, Math.min(hole.x + hole.w / 2 - left, cardW - 24));
    cardStyle = below
      ? { left, top: hole.y + hole.h + 18, width: cardW }
      : { left, bottom: viewport.h - hole.y + 18, width: cardW };
    arrow = below
      ? { left: arrowX, top: -9, transform: 'translateX(-50%) rotate(45deg)' }
      : { left: arrowX, bottom: -9, transform: 'translateX(-50%) rotate(45deg)' };
  }

  return (
    <div className="fixed inset-0 z-[70] select-none" role="dialog" aria-label="Tanıtım turu">
      <svg className="absolute inset-0 w-full h-full" width={viewport.w} height={viewport.h}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="10" fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" mask="url(#tour-mask)" style={{ fill: 'rgb(var(--k-dim) / 0.62)' }} />
        {hole && (
          <rect
            x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="10"
            fill="none" strokeWidth="3" className="animate-pulse" style={{ stroke: 'rgb(var(--k-yel))' }}
          />
        )}
      </svg>

      <div className="absolute game-surface" style={cardStyle}>
        {arrow && (
          <span
            aria-hidden="true"
            className="absolute w-[18px] h-[18px] bg-paper border-l-[3px] border-t-[3px] border-ink"
            style={arrow}
          />
        )}
        <div className="k-head k-head-yel !py-2">
          <span className="font-display text-base">{step.title}</span>
          <span className="k-label text-[11px]">{tour.step + 1} / {TOUR_STEPS.length}</span>
        </div>
        <div className="p-4 flex flex-col gap-2">
          {step.body.map((line, i) => (
            <p key={i} className="text-[13px] font-semibold text-ink leading-relaxed">{line}</p>
          ))}
        </div>
        <div className="px-4 pb-4 flex items-center gap-2">
          <button
            onClick={() => { sounds.playClick(); endTour(); }}
            className="game-btn px-3 py-2 rounded-md font-display text-xs uppercase tracking-wide bg-card text-mute"
          >
            Atla
          </button>
          <span className="flex-1" />
          {tour.step > 0 && (
            <button
              onClick={() => { sounds.playClick(); prevTourStep(); }}
              className="game-btn px-3 py-2 rounded-md font-display text-xs uppercase tracking-wide bg-board text-ink"
            >
              Geri
            </button>
          )}
          <button
            onClick={() => { sounds.playClick(); nextTourStep(); }}
            className="game-btn px-4 py-2 rounded-md font-display text-xs uppercase tracking-wide bg-kgrn text-white"
          >
            {last ? 'Bitir' : 'İleri'}
          </button>
        </div>
      </div>
    </div>
  );
};
