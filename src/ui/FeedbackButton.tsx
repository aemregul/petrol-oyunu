import React from 'react';
import { MessageSquareText } from 'lucide-react';
import { useGameStore } from '../store/gameStore';
import { sounds } from '../audio/soundEffects';

/**
 * The corner button that opens the feedback card (Emre, 2026-09-09). Bottom
 * right, clear of the bottom bar, under the tour's dim so a first-timer is
 * not asked for an opinion before they have one.
 */
export const FeedbackButton: React.FC = () => {
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const buildMode = useGameStore((s) => s.buildMode);
  if (buildMode.active) return null;

  return (
    <button
      onClick={() => { sounds.playClick(); setActiveModal('FEEDBACK'); }}
      data-tour="feedback"
      title="Sorun / Öneri Bildir"
      aria-label="Sorun / Öneri Bildir"
      className={`fixed right-3 bottom-3 z-30 game-surface game-btn w-11 h-11 rounded-full flex items-center justify-center ${
        activeModal === 'FEEDBACK' ? 'bg-kred text-white' : 'text-ink hover:bg-card'
      }`}
    >
      <MessageSquareText className="w-5 h-5" />
    </button>
  );
};
