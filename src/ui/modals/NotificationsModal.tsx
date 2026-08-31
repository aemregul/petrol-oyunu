import React, { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { X, Bell, Trash2 } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';
import { styleFor, timeAgo } from '../notificationStyle';

/**
 * Everything the corner showed and then took away. Toasts are a glance, not a
 * record — a player who looked away while three customers walked off still has
 * to be able to find out that they did.
 */
export const NotificationsModal: React.FC = () => {
  const notifications = useGameStore((s) => s.gameState.notifications);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const markNotificationsRead = useGameStore((s) => s.markNotificationsRead);
  const clearNotifications = useGameStore((s) => s.clearNotifications);

  // Opening the list is the reading of it; the badge has done its job.
  useEffect(() => {
    markNotificationsRead();
  }, [markNotificationsRead]);

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  const now = Date.now();

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[80vh]">
        <div className="bg-slate-800/80 px-6 py-4 border-b border-slate-700/80 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 border border-sky-500/30 text-sky-400 flex items-center justify-center">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase font-bold text-slate-400 tracking-wider">
                İstasyon Günlüğü
              </div>
              <div className="text-base font-extrabold text-white">Bildirimler</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-all"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 py-2 overflow-y-auto flex-1">
          {notifications.length === 0 ? (
            <div className="text-center py-14 text-slate-500 text-sm font-bold">
              Henüz bildirim yok.
            </div>
          ) : (
            notifications.map((notif) => {
              const style = styleFor(notif.type);
              return (
                <div
                  key={notif.id}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-800/60 transition-colors"
                >
                  <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${style.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-[13px] font-bold leading-snug break-words ${style.tint}`}>
                      {notif.title}
                      {notif.count > 1 && (
                        <span className="ml-1.5 text-[11px] font-extrabold tabular-nums opacity-80">
                          ×{notif.count}
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] font-medium leading-[1.45] break-words text-slate-400 mt-0.5">
                      {notif.message}
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap shrink-0 mt-0.5">
                    {timeAgo(notif.timestamp, now)}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {notifications.length > 0 && (
          <div className="px-6 py-3 border-t border-slate-800 flex justify-end">
            <button
              onClick={() => {
                sounds.playClick();
                clearNotifications();
              }}
              className="text-xs font-bold text-slate-400 hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-xl hover:bg-slate-800 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Günlüğü Temizle
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
