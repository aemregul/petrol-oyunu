import React from 'react';
import { useGameStore } from '../../store/gameStore';
import type { MissionEntity } from '../../domain/types/gameState';
import { MISSION_CHAIN, chainGoal, chainStatus } from '../../domain/services/missionChain';
import { X, Gift, CalendarDays, CheckCircle2, Circle, Lock, Star, Target } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

/**
 * Görevler (Emre, 2026-09-12): its own panel behind the HUD's pano door, no
 * longer a tab of the office. The main goal on top — one at a time, with the
 * Göster that walks the player to it and the next few after it — and the
 * day's goals below.
 */

const lira = (n: number) => `₺${Math.round(n).toLocaleString('tr-TR')}`;

function formatTarget(value: number): string {
  return value >= 1000 ? value.toLocaleString('tr-TR') : `${Math.round(value * 10) / 10}`;
}

const Section: React.FC<{ title: string; children: React.ReactNode; tour?: string }> = ({ title, children, tour }) => (
  <div data-tour={tour}>
    <div className="k-label text-[11px] pt-4 pb-1 border-b-2 border-ink">{title}</div>
    {children}
  </div>
);

const MissionRow: React.FC<{ mission: MissionEntity; onClaim: () => void }> = ({ mission, onClaim }) => {
  const headline = mission.type === 'DAILY_MAIN';
  return (
    <div className="flex items-center gap-3 py-3 border-b-2 border-dotted border-mute/60">
      <CalendarDays
        className={`w-5 h-5 shrink-0 ${mission.completed ? 'text-kgrn' : headline ? 'text-kyel-dark' : 'text-mute'}`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-extrabold text-ink truncate">{mission.description}</div>
        <div className="text-[13px] font-bold text-mute font-mono tabular-nums">
          {formatTarget(Math.min(mission.progress, mission.target))} / {formatTarget(mission.target)}
          {headline && <span className="font-sans text-kyel-dark"> · günün ana görevi</span>}
        </div>
      </div>
      {mission.completed ? (
        <button
          onClick={() => {
            sounds.playClick();
            onClaim();
          }}
          className="game-btn px-3.5 py-2 bg-kgrn hover:bg-kgrn-dark text-white text-[13px] font-display tracking-wide flex items-center gap-1.5 shrink-0"
        >
          <Gift className="w-4 h-4" />
          <span>+{lira(mission.rewardCash)}</span>
        </button>
      ) : (
        <span className="text-[15px] font-display tabular-nums text-kgrn shrink-0">+{lira(mission.rewardCash)}</span>
      )}
    </div>
  );
};

export const MissionsModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const claimMissionReward = useGameStore((s) => s.claimMissionReward);
  const claimChainReward = useGameStore((s) => s.claimChainReward);
  const showGuide = useGameStore((s) => s.showGuide);
  const lessonActive = useGameStore((s) => s.lesson.id !== null);

  const status = chainStatus(gameState);
  const goal = status ? chainGoal(gameState, status) : null;
  const reached = status?.index ?? MISSION_CHAIN.length;
  const upcoming = MISSION_CHAIN.slice(reached + 1, reached + 4);
  const dailies = gameState.missions.filter((m) => !m.claimed);
  const share = goal && goal.target > 0 ? Math.min(100, (goal.value / goal.target) * 100) : 0;

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  return (
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-2xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="k-head k-head-grn shrink-0">
          <span className="font-display text-xl tracking-wide flex items-center gap-2">
            <Target className="w-5 h-5" />
            Görevler
          </span>
          <button
            onClick={handleClose}
            className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center"
            aria-label="Kapat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6 overflow-y-auto flex-1">
          <Section title={`Ana Görev · ${reached} / ${MISSION_CHAIN.length} tamam`} tour="missions-chain">
            {status && goal ? (
              <div className="py-3 flex flex-col gap-2.5">
                <div className="flex items-start gap-3">
                  {status.complete ? (
                    <CheckCircle2 className="w-5 h-5 text-kgrn shrink-0 mt-0.5" />
                  ) : status.locked ? (
                    <Lock className="w-5 h-5 text-kblu shrink-0 mt-0.5" />
                  ) : (
                    <Star className="w-5 h-5 text-kyel-dark shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-display text-[18px] leading-tight text-ink">{goal.title}</div>
                    <div className="text-[13px] font-semibold text-mute mt-0.5">{goal.detail}</div>
                  </div>
                  <span className="text-[13px] font-mono font-bold text-ink tabular-nums shrink-0">
                    {formatTarget(goal.value)} / {formatTarget(goal.target)}
                    {status.locked ? ' XP' : ''}
                  </span>
                </div>
                <span className="k-bar w-full h-2.5">
                  <i
                    className={status.complete ? 'bg-kgrn' : status.locked ? 'bg-kblu' : 'bg-kyel'}
                    style={{ width: `${share}%` }}
                  />
                </span>
                <div className="flex items-center gap-3">
                  <span className="flex-1 text-[13px] font-bold text-mute">
                    Ödül: <span className="text-kgrn">{lira(status.step.rewardCash)}</span>
                    {status.step.rewardXp > 0 ? ` · ${status.step.rewardXp} XP` : ''}
                  </span>
                  {status.complete ? (
                    <button
                      onClick={() => claimChainReward()}
                      className="game-btn px-4 py-2 bg-kgrn hover:bg-kgrn-dark text-white text-[13px] font-display tracking-wide flex items-center gap-1.5"
                    >
                      <Gift className="w-4 h-4" />
                      <span>Ödülü Al</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        sounds.playClick();
                        showGuide(goal.guide);
                      }}
                      disabled={lessonActive}
                      data-tour="missions-show"
                      className="game-btn px-4 py-2 bg-kblu hover:bg-kblu-dark text-white text-[13px] font-display tracking-wide disabled:opacity-50"
                    >
                      Göster
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[14px] font-semibold text-mute py-3">
                Bütün ana görevleri bitirdin. İstasyon artık senin eserin; büyütmeye devam et.
              </p>
            )}
            {upcoming.length > 0 && (
              <div className="pb-1">
                <div className="k-label text-[10px] pt-1">Sıradakiler</div>
                {upcoming.map((step) => (
                  <div key={step.id} className="flex items-center gap-2 py-1.5 text-[13px] font-bold text-mute">
                    <Circle className="w-3.5 h-3.5 shrink-0" />
                    <span className="flex-1 truncate">{step.title}</span>
                    {step.level !== undefined && step.level > gameState.player.level && (
                      <span className="font-mono text-[11px]">Sv.{step.level}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Bugünün Görevleri" tour="missions-daily">
            {dailies.length === 0 ? (
              <p className="text-[14px] font-semibold text-mute py-3">Bugün için görev yok; yarın sabah yenileri gelir.</p>
            ) : (
              dailies.map((mission) => (
                <MissionRow key={mission.id} mission={mission} onClaim={() => claimMissionReward(mission.id)} />
              ))
            )}
            <p className="text-[13px] font-semibold text-mute pt-3">
              Günlük görevler her sabah yenilenir. Tamamlananın ödülü yeşil düğmeye basınca kasana geçer.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
};
