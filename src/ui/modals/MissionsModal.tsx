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
      className={`bg-slate-950/80 border rounded-2xl p-4 flex flex-col gap-3 ${
        mission.completed
          ? 'border-emerald-600/60'
          : isMain
            ? 'border-amber-600/50'
            : 'border-slate-800'
      }`}
    >
      <div className="flex items-start gap-3">
        {mission.completed ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        ) : isMain ? (
          <Star className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        ) : (
          <Circle className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" />
        )}
        <div className="flex-1">
          <div className="text-sm font-extrabold text-white">{mission.description}</div>
          <div className="text-xs text-slate-400 font-bold mt-0.5">
            Ödül: ₺{mission.rewardCash.toLocaleString('tr-TR')} · {mission.rewardXp} XP
            {isMain && <span className="text-amber-400"> · Ana Görev</span>}
          </div>
        </div>
        <span className="text-xs font-mono font-bold text-slate-300 shrink-0">
          {formatValue(mission.progress)} / {formatValue(mission.target)}
        </span>
      </div>

      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
        <div
          className={`h-full transition-all duration-300 ${
            mission.completed ? 'bg-emerald-500' : isMain ? 'bg-amber-500' : 'bg-sky-500'
          }`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>

      {mission.completed && (
        <button
          onClick={onClaim}
          className="game-btn bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 border-2 border-emerald-300/60 text-white text-xs font-extrabold px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all"
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
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[85vh]">
        <div className="bg-gradient-to-b from-slate-800 to-slate-800/60 px-6 py-4 border-b-2 border-slate-700 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="game-icon-badge !rounded-2xl w-10 h-10 !bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase font-bold text-slate-400 tracking-wider">
                Görevler & İlerleme
              </div>
              <div className="text-base font-extrabold text-white">
                Eğitim Görevleri ({done.length}/{missions.length} tamamlandı)
              </div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="game-btn w-8 h-8 rounded-xl bg-slate-700 border-2 border-slate-600 hover:bg-slate-600 text-slate-200 hover:text-white flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-3 overflow-y-auto flex-1">
          {pending.length === 0 && (
            <div className="text-center py-10 text-slate-400 text-sm font-bold">
              Tüm eğitim görevleri tamamlandı. İstasyonu büyütmeye devam edin!
            </div>
          )}

          {dailies.length > 0 && (
            <>
              <div className="text-xs font-bold text-slate-500 uppercase">Günlük Görevler</div>
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
              <div className="text-xs font-bold text-slate-500 uppercase mt-2">
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
              <div className="text-xs font-bold text-slate-500 uppercase">Tamamlananlar</div>
              {done.map((mission) => (
                <div
                  key={mission.id}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-950/50 border border-slate-800/60"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="text-xs font-bold text-slate-400 line-through">
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
