import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { X, MessageSquareText, Send, Bug, Lightbulb, MessageCircle } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';
import {
  FEEDBACK_MAX_CHARS,
  FEEDBACK_MIN_CHARS,
  FeedbackKind,
  buildFeedbackNote,
  feedbackChannel,
  sendFeedback,
  validFeedbackText
} from '../../services/feedback';

/**
 * "Sorun / Öneri Bildir" (Emre, 2026-09-09): a card with three chips, a
 * box and a button. The note goes wherever .env says (see services/
 * feedback.ts); the card says where it went, honestly — a clipboard copy
 * is told as a copy, not as a delivery.
 */

const APP_VERSION = '1.0.0';

const KINDS: Array<{ id: FeedbackKind; label: string; icon: React.ElementType; hint: string }> = [
  { id: 'bug', label: 'Hata', icon: Bug, hint: 'Bir şey yanlış çalışıyor' },
  { id: 'idea', label: 'Öneri', icon: Lightbulb, hint: 'Şu olsa süper olur' },
  { id: 'other', label: 'Diğer', icon: MessageCircle, hint: 'Aklına ne geldiyse' }
];

const CHANNEL_NOTE: Record<ReturnType<typeof feedbackChannel>, string> = {
  web3forms: 'Notun doğrudan geliştiricinin e-postasına düşer.',
  firestore: 'Notun geliştiricinin kutusuna yazılır.',
  mailto: 'Gönder deyince e-posta uygulaman hazır bir mesajla açılır.',
  clipboard: 'Bu sürümde gönderim kanalı ayarlı değil: notun panoya kopyalanır, dilediğin yere yapıştırırsın.'
};

export const FeedbackModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const account = useGameStore((s) => s.account);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const [kind, setKind] = useState<FeedbackKind>('idea');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'copied' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const channel = feedbackChannel();
  const valid = validFeedbackText(text);

  const close = () => { sounds.playClick(); setActiveModal('NONE'); };

  const submit = async () => {
    if (!valid || status === 'sending') return;
    sounds.playClick();
    setStatus('sending');
    setError(null);
    try {
      const taken = await sendFeedback(buildFeedbackNote(kind, valid, gameState, account, APP_VERSION));
      setStatus(taken === 'clipboard' ? 'copied' : 'sent');
      if (taken !== 'clipboard') setText('');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Gönderilemedi.');
    }
  };

  return (
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-lg overflow-hidden flex flex-col">
        <div className="k-head k-head-red shrink-0">
          <div className="flex items-center gap-3">
            <div className="game-icon-badge w-10 h-10"><MessageSquareText className="w-5 h-5" /></div>
            <div>
              <div className="text-[10px] uppercase font-bold font-sans text-white/80 tracking-wider">Geliştiriciye not</div>
              <div className="font-display text-xl tracking-wide">Sorun / Öneri Bildir</div>
            </div>
          </div>
          <button onClick={close} className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center" aria-label="Kapat">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-3">
          <p className="text-[13px] font-semibold text-mute">
            Bug mu buldun, önerin mi var? Yaz gönder, hepsini okuyoruz. Gün, seviye ve sürüm bilgin notla birlikte gider.
          </p>

          <div className="flex gap-2">
            {KINDS.map((k) => (
              <button
                key={k.id}
                onClick={() => { sounds.playClick(); setKind(k.id); }}
                title={k.hint}
                className={`game-btn flex-1 py-2 rounded-md font-display text-xs uppercase tracking-wide flex items-center justify-center gap-1.5 ${
                  kind === k.id ? 'bg-kred text-white' : 'bg-card text-ink hover:bg-board'
                }`}
              >
                <k.icon className="w-3.5 h-3.5" />
                {k.label}
              </button>
            ))}
          </div>

          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value.slice(0, FEEDBACK_MAX_CHARS)); if (status !== 'idle') setStatus('idle'); }}
            placeholder="Örn: girişte araçlar sıkışıyor / şu özellik olsa süper olur…"
            rows={5}
            className="w-full bg-paper border-2 border-ink rounded-md text-ink text-[13px] font-semibold p-3 focus:outline-none resize-y placeholder:text-mute/70"
          />
          <div className="flex items-center justify-between text-[11px] font-bold text-mute">
            <span>{text.trim().length < FEEDBACK_MIN_CHARS ? `En az ${FEEDBACK_MIN_CHARS} karakter` : CHANNEL_NOTE[channel]}</span>
            <span className="tabular-nums">{text.length}/{FEEDBACK_MAX_CHARS}</span>
          </div>

          {status === 'sent' && (
            <div className="bg-board border-2 border-ink rounded-md px-3 py-2 text-[13px] font-bold text-kgrn">
              Teşekkürler patron, notun ulaştı.
            </div>
          )}
          {status === 'copied' && (
            <div className="bg-board border-2 border-ink rounded-md px-3 py-2 text-[13px] font-bold text-kyel-dark">
              Not panoya kopyalandı; gönderim kanalı henüz ayarlı değil.
            </div>
          )}
          {status === 'error' && (
            <div className="bg-board border-2 border-ink rounded-md px-3 py-2 text-[13px] font-bold text-kred">
              Gönderilemedi: {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={submit}
              disabled={!valid || status === 'sending'}
              className={`game-btn px-5 py-2.5 rounded-md font-display text-sm uppercase tracking-wide flex items-center gap-2 ${
                !valid || status === 'sending' ? 'bg-card text-mute cursor-not-allowed' : 'bg-kred hover:bg-kred-dark text-white'
              }`}
            >
              <Send className="w-4 h-4" />
              {status === 'sending' ? 'Gönderiliyor…' : 'Gönder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
