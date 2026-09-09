import React, { useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';
import { GAME_EVENTS } from '../../config/eventConfig';
import { X, ShieldCheck, Coins, Unlock, RotateCcw, Zap, Inbox, ClipboardCopy, SunMedium } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';
import { firebaseAppIfReady } from '../../services/account';
import { FeedbackNote } from '../../services/feedback';
import { stripForCloud } from '../../services/cloudSave';

/**
 * The owner's panel (Emre, 2026-09-09), in place of the developer's test
 * panel: money and progress for testing the game, the road's events on
 * demand, the players' notes from the feedback box, and the save as text.
 * Opens only for accounts listed in .env (services/admin.ts).
 */

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <div className="k-label text-[11px] pt-4 pb-1 border-b-2 border-ink">{title}</div>
    <div className="pt-3 flex flex-col gap-2">{children}</div>
  </div>
);

const Chip: React.FC<{ onClick: () => void; tone?: 'green' | 'blue' | 'red' | 'plain'; children: React.ReactNode; disabled?: boolean }> = ({
  onClick, tone = 'plain', children, disabled
}) => (
  <button
    onClick={() => { sounds.playClick(); onClick(); }}
    disabled={disabled}
    className={`game-btn px-3 py-2 rounded-md font-display text-xs uppercase tracking-wide flex items-center gap-1.5 ${
      disabled ? 'bg-card text-mute cursor-not-allowed'
        : tone === 'green' ? 'bg-kgrn text-white'
          : tone === 'blue' ? 'bg-kblu text-white'
            : tone === 'red' ? 'bg-kred text-white'
              : 'bg-card hover:bg-board text-ink'
    }`}
  >
    {children}
  </button>
);

type NoteRow = FeedbackNote & { id: string; createdAt: number | null };

export const AdminModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const account = useGameStore((s) => s.account);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const adminGrantCash = useGameStore((s) => s.adminGrantCash);
  const adminSetLevel = useGameStore((s) => s.adminSetLevel);
  const adminTriggerEvent = useGameStore((s) => s.adminTriggerEvent);
  const devUnlockEverything = useGameStore((s) => s.devUnlockEverything);
  const endDayAndShowReport = useGameStore((s) => s.endDayAndShowReport);
  const resetGameSave = useGameStore((s) => s.resetGameSave);
  const [confirmReset, setConfirmReset] = useState(false);
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const app = firebaseAppIfReady();
      if (!app) { setNotesError('Firebase yapılandırması yok.'); return; }
      try {
        const { getFirestore, collection, getDocs, query, orderBy, limit } = await import('firebase/firestore');
        const snap = await getDocs(query(collection(getFirestore(app), 'feedback'), orderBy('createdAt', 'desc'), limit(50)));
        if (cancelled) return;
        setNotes(snap.docs.map((d) => {
          const data = d.data() as FeedbackNote & { createdAt?: { toMillis?: () => number } };
          return { ...data, id: d.id, createdAt: data.createdAt?.toMillis?.() ?? null };
        }));
      } catch (e) {
        if (!cancelled) setNotesError(e instanceof Error ? e.message : 'Okunamadı.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const copySave = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(stripForCloud(gameState)));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard refused; nothing to do */ }
  };

  return (
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-2xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="k-head k-head-vio shrink-0">
          <div className="flex items-center gap-3">
            <div className="game-icon-badge w-10 h-10"><ShieldCheck className="w-5 h-5" /></div>
            <div>
              <div className="text-[10px] uppercase font-bold font-sans text-white/80 tracking-wider">{account?.email ?? account?.name ?? 'yönetici'}</div>
              <div className="font-display text-xl tracking-wide">Yönetici Paneli</div>
            </div>
          </div>
          <button onClick={() => { sounds.playClick(); setActiveModal('NONE'); }} className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center" aria-label="Kapat">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-5 overflow-y-auto flex-1">
          <p className="text-[12px] font-semibold text-mute pt-3">
            Yalnızca senin hesabın görür; her şey senin kaydına işler, başka oyuncuya dokunmaz.
          </p>

          <Section title="Kasa">
            <div className="flex flex-wrap gap-2">
              {[10_000, 100_000, 1_000_000].map((n) => (
                <Chip key={n} tone="green" onClick={() => adminGrantCash(n)}>
                  <Coins className="w-3.5 h-3.5" />+₺{n.toLocaleString('tr-TR')}
                </Chip>
              ))}
            </div>
          </Section>

          <Section title="İlerleme">
            <div className="flex flex-wrap gap-2">
              <Chip tone="blue" onClick={() => adminSetLevel(gameState.player.level + 1)} disabled={gameState.player.level >= GAME_CONFIG.levels.length}>
                Seviye +1 (şimdi {gameState.player.level})
              </Chip>
              <Chip onClick={() => adminSetLevel(1)}>Seviye 1'e dön</Chip>
              <Chip tone="blue" onClick={devUnlockEverything}>
                <Unlock className="w-3.5 h-3.5" />Her şeyi aç
              </Chip>
              <Chip onClick={endDayAndShowReport}>
                <SunMedium className="w-3.5 h-3.5" />Günü bitir
              </Chip>
            </div>
            <div className="text-[11px] font-semibold text-mute">
              "Her şeyi aç": son seviye, itibar 5, +₺500.000, tüm tanklar ve tabancalar.
            </div>
          </Section>

          <Section title="Olay tetikle">
            <div className="flex flex-wrap gap-2">
              {GAME_EVENTS.map((e) => (
                <Chip key={e.id} onClick={() => adminTriggerEvent(e.id)}>
                  <Zap className="w-3.5 h-3.5" />{e.name}
                </Chip>
              ))}
            </div>
          </Section>

          <Section title="Oyuncu notları">
            {notesError ? (
              <div className="text-[12px] font-semibold text-kred">
                Okunamadı: {notesError}. firestore.rules içindeki feedback okuma satırına e-postanı yazıp kuralları yayımlamak gerekiyor.
              </div>
            ) : notes === null ? (
              <div className="text-[12px] font-semibold text-mute">Yükleniyor…</div>
            ) : notes.length === 0 ? (
              <div className="text-[12px] font-semibold text-mute">Henüz not yok. Web3Forms kullanılıyorsa notlar e-postada, burada değil.</div>
            ) : (
              notes.map((n) => (
                <div key={n.id} className="bg-board border-2 border-ink rounded-md px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-display text-[13px] text-ink">[{n.kind === 'bug' ? 'Hata' : n.kind === 'idea' ? 'Fikir' : 'Diğer'}] {n.context?.account ?? ''}</span>
                    <span className="text-[11px] font-mono text-mute whitespace-nowrap">{n.createdAt ? new Date(n.createdAt).toLocaleString('tr-TR') : ''}</span>
                  </div>
                  <div className="text-[12px] font-semibold text-ink whitespace-pre-wrap">{n.text}</div>
                  <div className="text-[11px] font-mono text-mute">Gün {n.context?.day} · Sv.{n.context?.level} · ₺{n.context?.cash?.toLocaleString('tr-TR')} · {n.context?.version}</div>
                </div>
              ))
            )}
          </Section>

          <Section title="Kayıt">
            <div className="flex flex-wrap gap-2">
              <Chip onClick={() => { void copySave(); }}>
                <ClipboardCopy className="w-3.5 h-3.5" />{copied ? 'Kopyalandı' : 'Kaydı panoya kopyala'}
              </Chip>
              <Chip tone={confirmReset ? 'red' : 'plain'} onClick={() => { if (!confirmReset) { setConfirmReset(true); return; } resetGameSave(); setConfirmReset(false); setActiveModal('NONE'); }}>
                <RotateCcw className="w-3.5 h-3.5" />{confirmReset ? 'Emin misin? Tekrar tıkla' : 'Oyunu sıfırla'}
              </Chip>
            </div>
            <div className="text-[11px] font-semibold text-mute flex items-center gap-1">
              <Inbox className="w-3.5 h-3.5" /> Kopya, geri bildirimle gelen bir hatayı aynı kayıtla yeniden üretmek için.
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
};
