import React, { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { X, Bell, Trash2 } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';
import { styleFor, timeAgo } from '../notificationStyle';
import { TONE_DOT, TONE_TEXT } from '../gameStyle';

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
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh]">
        <div className="k-head k-head-yel shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="game-icon-badge w-10 h-10 bg-paper">
              <Bell className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="k-label text-ink/70">İstasyon Günlüğü</div>
              <div className="font-display text-xl tracking-wide">Bildirimler</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center shrink-0"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 py-3 overflow-y-auto flex-1 flex flex-col gap-2">
          {notifications.length === 0 ? (
            <div className="text-center py-14 text-mute text-sm font-bold">
              Henüz bildirim yok.
            </div>
          ) : (
            notifications.map((notif) => {
              const style = styleFor(notif.type);
              return (
                <div
                  key={notif.id}
                  className="flex items-start gap-3 bg-board border-2 border-ink rounded-md px-3 py-2"
                >
                  <span className={`w-2.5 h-2.5 rounded-full border border-ink mt-1.5 shrink-0 ${TONE_DOT[style.tone]}`} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-[13px] font-extrabold leading-snug break-words ${TONE_TEXT[style.tone]}`}>
                      {notif.title}
                      {notif.count > 1 && (
                        <span className="ml-1.5 text-[11px] font-extrabold tabular-nums opacity-80">
                          ×{notif.count}
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] font-medium leading-[1.45] break-words text-ink mt-0.5">
                      {notif.message}
                    </div>
                  </div>
                  <span className="text-[11px] font-bold text-mute whitespace-nowrap shrink-0 mt-0.5">
                    {timeAgo(notif.timestamp, now)}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {notifications.length > 0 && (
          <div className="px-4 py-3 border-t-2 border-ink flex justify-end shrink-0">
            <button
              onClick={() => {
                sounds.playClick();
                clearNotifications();
              }}
              className="game-btn bg-card hover:bg-board text-ink font-display text-sm tracking-wide flex items-center gap-1.5 px-3 py-1.5"
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
