import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { LESSONS, LESSON_GAP_MS, lessonById, lessonToStart, lessonView } from './lessons/lessons';
import { resolveDyn, type LessonStep, type LessonView } from './lessons/lessonTypes';
import { worldTarget, type ScreenRect } from './lessons/worldTarget';
import { sounds } from '../audio/soundEffects';

/**
 * Lessons on screen (Emre, 2026-09-11). One card, one lit thing.
 *
 * A step that points at something dims the screen and cuts a hole round the
 * thing — a HUD door, a button in a panel, a car standing at the pump — and
 * only the hole can be clicked, so the lesson cannot be half-followed into
 * some other menu. A step that waits on the world (the fuel pouring) rings
 * the thing and leaves the screen alone.
 *
 * This component is also the director: it offers a lesson when one is due,
 * moves a running one on when its condition is met, and drops it when the
 * situation it teaches has gone.
 */

const CARD_WIDTH = 340;
const HOLE_PAD = 8;
const EDGE = 12;
const GAP = 18;
/** A moment for the scene to draw before the first lesson points into it. */
const FIRST_LESSON_DELAY_MS = 1500;
/** How often a lesson's conditions are asked: often enough that a press feels answered. */
const CHECK_EVERY_MS = 120;

type Store = ReturnType<typeof useGameStore.getState>;

function viewOf(store: Store): LessonView {
  return lessonView(store);
}

/** The step as it reads on the card, worked out once when the step comes up. */
interface Shown {
  key: string;
  lessonTitle: string;
  title: string;
  body: string[];
  advance: LessonStep['advance']['kind'];
  open: boolean;
  press: LessonStep['press'];
  index: number;
  count: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function sameRect(a: ScreenRect | null, b: ScreenRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
}

type Placement = { style: React.CSSProperties; arrow: React.CSSProperties | null };

/**
 * Where the card goes. Beside the hole when there is room and the hole is
 * not hugging the top or bottom edge; otherwise under it or over it,
 * whichever side has the room. With nothing lit, the middle of the screen —
 * or, on a waiting step, out of the way at the bottom.
 */
export function placeCard(
  hole: ScreenRect | null,
  viewport: { w: number; h: number },
  cardW: number,
  cardH: number,
  open: boolean
): Placement {
  if (!hole) {
    // Placed by arithmetic, never by a centring transform: the card's fade-in
    // owns `transform`, and it put the card's corner rather than its middle
    // on the centre of the screen (Emre, 2026-09-12).
    const left = Math.max(EDGE, (viewport.w - cardW) / 2);
    return open
      ? { style: { left, top: Math.max(EDGE, viewport.h - 110 - cardH), width: cardW }, arrow: null }
      : { style: { left, top: Math.max(EDGE, (viewport.h - cardH) / 2), width: cardW }, arrow: null };
  }

  const cx = hole.x + hole.w / 2;
  const cy = hole.y + hole.h / 2;
  const fitsRight = hole.x + hole.w + GAP + cardW + EDGE <= viewport.w;
  const fitsLeft = hole.x - GAP - cardW - EDGE >= 0;
  const fitsBelow = hole.y + hole.h + GAP + cardH + EDGE <= viewport.h;
  const fitsAbove = hole.y - GAP - cardH - EDGE >= 0;
  const edgeRow = cy < viewport.h * 0.25 || cy > viewport.h * 0.75;

  if (!edgeRow && (fitsRight || fitsLeft)) {
    const top = clamp(cy - cardH / 2, EDGE, Math.max(EDGE, viewport.h - EDGE - cardH));
    const arrowTop = clamp(cy - top, 22, Math.max(22, cardH - 22));
    return fitsRight
      ? {
          style: { left: hole.x + hole.w + GAP, top, width: cardW },
          arrow: { left: -11, top: arrowTop, transform: 'translateY(-50%) rotate(-45deg)' }
        }
      : {
          style: { left: hole.x - GAP - cardW, top, width: cardW },
          arrow: { right: -11, top: arrowTop, transform: 'translateY(-50%) rotate(135deg)' }
        };
  }

  const below = cy < viewport.h / 2 ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
  const left = clamp(cx - cardW / 2, EDGE, Math.max(EDGE, viewport.w - cardW - EDGE));
  const arrowLeft = clamp(cx - left, 22, cardW - 22);
  const maxTop = Math.max(EDGE, viewport.h - cardH - EDGE);
  return below
    ? {
        style: { left, top: clamp(hole.y + hole.h + GAP, EDGE, maxTop), width: cardW },
        arrow: { left: arrowLeft, top: -11, transform: 'translateX(-50%) rotate(45deg)' }
      }
    : {
        style: { left, top: clamp(hole.y - GAP - cardH, EDGE, maxTop), width: cardW },
        arrow: { left: arrowLeft, bottom: -11, transform: 'translateX(-50%) rotate(225deg)' }
      };
}

/** Four transparent panes round the hole that swallow every click but the one that matters. */
const Blockers: React.FC<{ hole: ScreenRect | null; viewport: { w: number; h: number } }> = ({ hole, viewport }) => {
  if (!hole) return <div className="absolute inset-0 pointer-events-auto" />;
  const top = clamp(hole.y, 0, viewport.h);
  const bottom = clamp(hole.y + hole.h, 0, viewport.h);
  const left = clamp(hole.x, 0, viewport.w);
  const right = clamp(hole.x + hole.w, 0, viewport.w);
  return (
    <>
      <div className="absolute pointer-events-auto" style={{ left: 0, top: 0, width: '100%', height: top }} />
      <div className="absolute pointer-events-auto" style={{ left: 0, top: bottom, width: '100%', bottom: 0 }} />
      <div className="absolute pointer-events-auto" style={{ left: 0, top, width: left, height: bottom - top }} />
      <div className="absolute pointer-events-auto" style={{ left: right, top, right: 0, height: bottom - top }} />
    </>
  );
};

export const LessonOverlay: React.FC = () => {
  const lesson = useGameStore((s) => s.lesson);
  const advanceLesson = useGameStore((s) => s.advanceLesson);
  const endLesson = useGameStore((s) => s.endLesson);
  const [shown, setShown] = useState<Shown | null>(null);
  const [hole, setHole] = useState<ScreenRect | null>(null);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [cardH, setCardH] = useState(180);
  const cardRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<Element | null>(null);
  const mountedAt = useRef(Date.now());

  // The director.
  useEffect(() => {
    const id = window.setInterval(() => {
      const store = useGameStore.getState();
      const view = viewOf(store);
      const current = store.lesson;

      if (!current.id) {
        const now = Date.now();
        if (now - mountedAt.current < FIRST_LESSON_DELAY_MS) return;
        // A panel the player opened asked for its lesson; the pause between
        // lessons is for the ones the game brings up on its own.
        const panelsOnly = now - current.endedAt < LESSON_GAP_MS;
        const due = lessonToStart(view, LESSONS, { panelsOnly });
        if (due) store.startLesson(due.id, due.subject);
        return;
      }

      const def = lessonById(current.id);
      const step = def?.steps[current.step];
      if (!def || !step || !view.state.dayState.isDayActive) {
        store.endLesson('lost');
        return;
      }

      const gone = def.abandon?.(view, current.subject, current.step) ?? null;
      if (gone) {
        store.endLesson(gone === 'skip' ? 'skipped' : 'lost');
        return;
      }

      if (step.advance.kind === 'until' && step.advance.done(view, current.subject)) {
        store.advanceLesson();
      }
    }, CHECK_EVERY_MS);
    return () => window.clearInterval(id);
  }, []);

  // The card's words, once per step.
  useEffect(() => {
    const def = lessonById(lesson.id);
    const step = def?.steps[lesson.step];
    if (!def || !step) {
      setShown(null);
      return;
    }
    const view = viewOf(useGameStore.getState());
    // Counted over the steps this player will actually see: a card reading
    // "4 / 8" that then ends the lesson, the rest skipped, reads as broken.
    const seen = def.steps.map((s, i) => i === lesson.step || !s.skip?.(view, lesson.subject));
    setShown({
      key: `${lesson.id}:${lesson.step}`,
      lessonTitle: def.title,
      title: resolveDyn(step.title, view, lesson.subject),
      body: resolveDyn(step.body, view, lesson.subject),
      advance: step.advance.kind,
      open: !!step.open,
      press: step.press,
      index: seen.slice(0, lesson.step).filter(Boolean).length,
      count: seen.filter(Boolean).length
    });
  }, [lesson.id, lesson.step, lesson.subject]);

  // The lit thing, measured every frame: panels reflow and cars move.
  useEffect(() => {
    const step = lessonById(lesson.id)?.steps[lesson.step];
    if (!step) {
      setHole(null);
      return;
    }
    let frame = 0;
    let last: ScreenRect | null = null;
    let scrolled = false;

    const tick = () => {
      const target = resolveDyn(step.target, viewOf(useGameStore.getState()), lesson.subject);
      let rect: ScreenRect | null = null;
      anchorRef.current = null;

      if (target?.kind === 'dom') {
        worldTarget.box = null;
        const el = document.querySelector(`[data-tour="${target.anchor}"]`);
        if (el) {
          anchorRef.current = el;
          // Once per step: a card far down a panel's list is brought into
          // view, rather than a hole cut round something scrolled out of sight.
          if (!scrolled) {
            scrolled = true;
            el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) rect = { x: r.left, y: r.top, w: r.width, h: r.height };
        }
      } else if (target?.kind === 'world') {
        worldTarget.box = target.box;
        rect = worldTarget.rect;
      } else {
        worldTarget.box = null;
      }

      const padded = rect
        ? { x: rect.x - HOLE_PAD, y: rect.y - HOLE_PAD, w: rect.w + HOLE_PAD * 2, h: rect.h + HOLE_PAD * 2 }
        : null;
      if (!sameRect(padded, last)) {
        last = padded;
        setHole(padded);
      }
      frame = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      cancelAnimationFrame(frame);
      worldTarget.box = null;
    };
  }, [lesson.id, lesson.step, lesson.subject]);

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // A press on the lit thing moves a click step on — after the button has
  // done its own job, so the panel it opens is there for the next step.
  useEffect(() => {
    if (!shown || shown.advance !== 'click') return;
    const key = shown.key;
    const onClick = (e: MouseEvent) => {
      const el = anchorRef.current;
      if (!el || !(e.target instanceof Node) || !el.contains(e.target)) return;
      window.setTimeout(() => {
        const { lesson: now, advanceLesson: advance } = useGameStore.getState();
        if (`${now.id}:${now.step}` === key) advance();
      }, 0);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [shown]);

  // While a step points at something, the keyboard answers the lesson and
  // nothing behind it: Esc would shut the very panel being explained.
  useEffect(() => {
    if (!shown || shown.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      e.stopPropagation();
      if (shown.advance === 'next' && (e.key === 'Enter' || e.key === 'ArrowRight')) {
        e.preventDefault();
        useGameStore.getState().advanceLesson();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [shown]);

  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 1) setCardH(h);
  });

  if (!lesson.id || !shown) return null;

  const blocking = !shown.open;
  const last = shown.index === shown.count - 1;
  const cardW = Math.min(CARD_WIDTH, viewport.w - EDGE * 2);
  const { style: cardStyle, arrow } = placeCard(hole, viewport, cardW, cardH, shown.open);

  return (
    <div className="fixed inset-0 z-[70] select-none pointer-events-none" role="dialog" aria-label={shown.lessonTitle}>
      <svg className="absolute inset-0 w-full h-full" width={viewport.w} height={viewport.h}>
        {blocking && (
          <>
            <defs>
              <mask id="lesson-mask">
                <rect width="100%" height="100%" fill="white" />
                {hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="10" fill="black" />}
              </mask>
            </defs>
            <rect width="100%" height="100%" mask="url(#lesson-mask)" style={{ fill: 'rgb(var(--k-dim) / 0.58)' }} />
          </>
        )}
        {hole && (
          <rect
            x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="10"
            fill="none" strokeWidth="3" className="animate-pulse" style={{ stroke: 'rgb(var(--k-yel))' }}
          />
        )}
      </svg>

      {blocking && <Blockers hole={hole} viewport={viewport} />}

      {/* On a step about something in the scene, the whole lit area is its button. */}
      {blocking && hole && shown.press && (
        <button
          type="button"
          aria-label="Işıklı yere tıkla"
          className="absolute pointer-events-auto cursor-pointer bg-transparent"
          style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
          onClick={() => {
            const store = useGameStore.getState();
            const step = lessonById(store.lesson.id)?.steps[store.lesson.step];
            step?.press?.(
              { openFuelingPanelForVehicle: store.openFuelingPanelForVehicle, selectPump: store.selectPump },
              viewOf(store),
              store.lesson.subject
            );
          }}
        />
      )}

      <div ref={cardRef} key={shown.key} className="absolute game-surface pointer-events-auto animate-fade-in" style={cardStyle}>
        {arrow && (
          <span
            aria-hidden="true"
            className="absolute w-[18px] h-[18px] bg-paper border-l-[3px] border-t-[3px] border-ink"
            style={arrow}
          />
        )}
        <div className="k-head k-head-yel !py-2">
          <span className="font-display text-base">{shown.title}</span>
          <span className="k-label text-[11px] whitespace-nowrap">{shown.index + 1} / {shown.count}</span>
        </div>
        <div className="px-4 pt-3 pb-2 flex flex-col gap-1.5">
          {shown.body.map((line, i) => (
            <p key={i} className="text-[13px] font-semibold text-ink leading-relaxed">{line}</p>
          ))}
        </div>
        <div className="px-4 pb-3 flex items-center gap-2">
          <button
            onClick={() => { sounds.playClick(); endLesson('skipped'); }}
            className="game-btn px-3 py-1.5 rounded-md font-display text-xs uppercase tracking-wide bg-card text-mute"
            title="Bu dersi bir daha gösterme"
          >
            Atla
          </button>
          <span className="flex-1" />
          {shown.advance === 'next' ? (
            <button
              onClick={() => { sounds.playClick(); advanceLesson(); }}
              className="game-btn px-4 py-1.5 rounded-md font-display text-xs uppercase tracking-wide bg-kgrn text-white"
            >
              {last ? 'Bitir' : 'İleri'}
            </button>
          ) : (
            <span className="font-display text-xs uppercase tracking-wide text-kred">
              {shown.open || !hole ? 'Bekleniyor…' : 'Işıklı yere tıkla'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
