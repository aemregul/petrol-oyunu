import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { MissionEntity } from '../../domain/types/gameState';
import { X, Target, CheckCircle2, Gift, Circle, Star } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

const MissionRow: React.FC<{ mission: MissionEntity; onClaim: () => void }> = ({
  mission,
  onClaim
}) => {
  const ratio = Math.min(1, mission.progress / mission.target);
  const isMain = mission.type === 'DAILY_MAIN';

  // Money goals read better rounded; counts stay exact.
  const formatValue = (value: number) =>
    mission.target >= 1000
      ? Math.round(value).toLocaleString('tr-TR')
      : Math.round(value * 10) / 10;

  return (
    <div
      className={`bg-paper border-2 rounded-md p-4 flex flex-col gap-3 shadow-k ${
        mission.completed
          ? 'border-kgrn'
          : isMain
            ? 'border-kyel-dark'
            : 'border-ink'
      }`}
    >
      <div className="flex items-start gap-3">
        {mission.completed ? (
          <CheckCircle2 className="w-5 h-5 text-kgrn shrink-0 mt-0.5" />
        ) : isMain ? (
          <Star className="w-5 h-5 text-kyel-dark shrink-0 mt-0.5" />
        ) : (
          <Circle className="w-5 h-5 text-mute shrink-0 mt-0.5" />
        )}
        <div className="flex-1">
          <div className="text-sm font-extrabold text-ink">{mission.description}</div>
          <div className="text-xs text-mute font-bold mt-0.5">
            Ödül: ₺{mission.rewardCash.toLocaleString('tr-TR')} · {mission.rewardXp} XP
            {isMain && <span className="text-kyel-dark"> · Ana Görev</span>}
          </div>
        </div>
        <span className="text-xs font-mono font-bold text-ink shrink-0">
          {formatValue(mission.progress)} / {formatValue(mission.target)}
        </span>
      </div>

      <div className="w-full k-bar">
        <div
          className={`h-full transition-all duration-300 ${
            mission.completed ? 'bg-kgrn' : isMain ? 'bg-kyel' : 'bg-kblu'
          }`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>

      {mission.completed && (
        <button
          onClick={onClaim}
          className="game-btn bg-kgrn hover:bg-kgrn-dark text-white text-sm font-display tracking-wide px-4 py-2.5 flex items-center justify-center gap-2"
        >
          <Gift className="w-4 h-4" />
          <span>Ödülü Al</span>
        </button>
      )}
    </div>
  );
};

export const MissionsModal: React.FC = () => {
  const missions = useGameStore((s) => s.gameState.missions);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const claimMissionReward = useGameStore((s) => s.claimMissionReward);

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  const pending = missions.filter((m) => !m.claimed);
  const done = missions.filter((m) => m.claimed);

  const tutorials = pending.filter((m) => m.type === 'TUTORIAL');
  const dailies = pending.filter((m) => m.type !== 'TUTORIAL');

  return (
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="k-head k-head-grn shrink-0">
          <div className="flex items-center gap-3">
            <div className="game-icon-badge w-9 h-9">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-black tracking-[0.12em] opacity-80 font-sans">
                Görevler & İlerleme
              </div>
              <div className="font-display text-xl tracking-wide leading-tight">
                Eğitim Görevleri ({done.length}/{missions.length} tamamlandı)
              </div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-3 overflow-y-auto flex-1">
          {pending.length === 0 && (
            <div className="text-center py-10 text-mute text-sm font-bold">
              Tüm eğitim görevleri tamamlandı. İstasyonu büyütmeye devam edin!
            </div>
          )}

          {dailies.length > 0 && (
            <>
              <div className="k-label text-[11px] border-b-2 border-ink pb-1">Günlük Görevler</div>
              {dailies.map((mission) => (
                <MissionRow
                  key={mission.id}
                  mission={mission}
                  onClaim={() => claimMissionReward(mission.id)}
                />
              ))}
            </>
          )}

          {tutorials.length > 0 && (
            <>
              <div className="k-label text-[11px] border-b-2 border-ink pb-1 mt-2">
                Eğitim Görevleri
              </div>
              {tutorials.map((mission) => (
                <MissionRow
                  key={mission.id}
                  mission={mission}
                  onClaim={() => claimMissionReward(mission.id)}
                />
              ))}
            </>
          )}

          {done.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              <div className="k-label text-[11px] border-b-2 border-ink pb-1">Tamamlananlar</div>
              {done.map((mission) => (
                <div
                  key={mission.id}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-md bg-board border-2 border-ink"
                >
                  <CheckCircle2 className="w-4 h-4 text-kgrn shrink-0" />
                  <span className="text-xs font-bold text-mute line-through">
                    {mission.description}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
