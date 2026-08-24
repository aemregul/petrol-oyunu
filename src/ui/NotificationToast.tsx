import React from 'react';
import { useGameStore } from '../store/gameStore';
import { ShieldAlert, AlertTriangle, Info, Award, X } from 'lucide-react';

export const NotificationToast: React.FC = () => {
  const notifications = useGameStore((s) => s.gameState.notifications);
  const dismissNotification = useGameStore((s) => s.dismissNotification);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 flex flex-col gap-2.5 z-40 max-w-sm pointer-events-none select-none">
      {notifications.slice(0, 4).map((notif) => {
        let borderBg = 'border-sky-500/50 bg-slate-900/95 text-sky-300';
        let IconComp = Info;

        if (notif.type === 'CRITICAL') {
          borderBg = 'border-red-500/80 bg-red-950/95 text-red-200';
          IconComp = ShieldAlert;
        } else if (notif.type === 'WARNING') {
          borderBg = 'border-amber-500/80 bg-amber-950/95 text-amber-200';
          IconComp = AlertTriangle;
        } else if (notif.type === 'REWARD') {
          borderBg = 'border-emerald-500/80 bg-emerald-950/95 text-emerald-200';
          IconComp = Award;
        }

        return (
          <div
            key={notif.id}
            className={`pointer-events-auto border rounded-2xl p-3.5 shadow-2xl backdrop-blur-md flex items-start gap-3 animate-fade-in ${borderBg}`}
          >
            <IconComp className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1 pr-2">
              <div className="font-extrabold text-xs text-white">{notif.title}</div>
              <div className="text-[11px] text-slate-300 mt-0.5 leading-tight">{notif.message}</div>
            </div>
            <button
              onClick={() => dismissNotification(notif.id)}
              className="text-slate-400 hover:text-white p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
