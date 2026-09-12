import React from 'react';
import { Gift, Target } from 'lucide-react';
import { useGameStore } from '../store/gameStore';
import { MISSION_CHAIN, chainGoal, chainStatus } from '../domain/services/missionChain';
import { sounds } from '../audio/soundEffects';

const lira = (n: number) => `₺${Math.round(n).toLocaleString('tr-TR')}`;
const count = (n: number) => Math.round(n).toLocaleString('tr-TR');

/**
 * The main goal, always in view under the top strip (Emre, 2026-09-12): what
 * to do next, how far along it is, and either the Göster that walks the
 * player there or the reward waiting to be taken. The header opens Görevler.
 */
export const GoalCard: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const lessonActive = useGameStore((s) => s.lesson.id !== null);
  // Out of the way while something is being put down or land is being picked.
  const placing = useGameStore((s) => s.buildMode.active || s.landMode.active);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const showGuide = useGameStore((s) => s.showGuide);
  const claimChainReward = useGameStore((s) => s.claimChainReward);

  const status = chainStatus(gameState);
  if (!status || placing) return null;
  const goal = chainGoal(gameState, status);
  const share = goal.target > 0 ? Math.min(100, (goal.value / goal.target) * 100) : 0;

  return (
    <div className="hud-goal game-surface pointer-events-auto w-full max-w-[17rem] overflow-hidden" data-tour="goal-card">
      <button
        type="button"
        onClick={() => {
          sounds.playClick();
          setActiveModal('MISSIONS');
        }}
        className="k-head k-head-yel !py-1.5 !px-3 w-full text-left"
        title="Görevleri aç"
      >
        <span className="flex items-center gap-1.5 text-[15px]">
          <Target className="w-4 h-4" />
          Ana Görev
        </span>
        <span className="k-label text-[10px] tabular-nums">
          {status.index + 1} / {MISSION_CHAIN.length}
        </span>
      </button>
      <div className="px-3 pt-2 pb-2.5 flex flex-col gap-1.5">
        <div className="font-display text-[15px] leading-tight text-ink">{goal.title}</div>
        <div className="flex items-center gap-2">
          <span className="k-bar flex-1 h-2">
            <i
              className={status.complete ? 'bg-kgrn' : status.locked ? 'bg-kblu' : 'bg-kyel'}
              style={{ width: `${share}%` }}
            />
          </span>
          <span className="text-[11px] font-mono font-bold text-ink tabular-nums whitespace-nowrap">
            {count(goal.value)} / {count(goal.target)}
            {status.locked ? ' XP' : ''}
          </span>
        </div>
        {status.complete ? (
          <button
            type="button"
            onClick={() => claimChainReward()}
            data-tour="goal-claim"
            className="game-btn bg-kgrn hover:bg-kgrn-dark text-white font-display text-xs uppercase tracking-wide py-1.5 flex items-center justify-center gap-1.5"
          >
            <Gift className="w-3.5 h-3.5" />
            <span>Ödülü Al · {lira(status.step.rewardCash)}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              showGuide(goal.guide);
            }}
            disabled={lessonActive}
            data-tour="goal-show"
            className="game-btn bg-card hover:bg-board text-ink font-display text-xs uppercase tracking-wide py-1.5 disabled:opacity-50"
          >
            Göster
          </button>
        )}
      </div>
    </div>
  );
};
