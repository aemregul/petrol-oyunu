import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { X, ArrowLeft, Bell, LogOut, RotateCcw } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';
import { styleFor, timeAgo } from '../notificationStyle';

/**
 * The settings card, in the office's dress: one dark card, sections with a
 * small capitals heading, choices as a row of pills, switches as a wide
 * button that names its state. The notification log is a page inside the
 * card rather than a screen of its own (Emre, 2026-09-07).
 */

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-slate-400 pt-5 pb-2">
    {children}
  </div>
);

const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[12px] font-semibold text-slate-400 -mt-1 pb-2">{children}</p>
);

/** A row of choices, one lit. */
const Choice: React.FC<{
  options: Array<{ id: string; label: string; soon?: boolean }>;
  value: string;
  onPick: (id: string) => void;
  tone?: 'green' | 'red';
}> = ({ options, value, onPick, tone = 'green' }) => (
  <div className={`grid gap-3 ${options.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
    {options.map((o) => {
      const active = o.id === value;
      return (
        <button
          key={o.id}
          onClick={() => {
            if (o.soon || active) return;
            sounds.playClick();
            onPick(o.id);
          }}
          disabled={o.soon}
          title={o.soon ? 'Yakında' : undefined}
          className={`py-3 rounded-2xl text-[14px] font-extrabold border transition-all ${
            active
              ? tone === 'green'
                ? 'bg-[#1f9d55] border-emerald-300/40 text-white shadow-lg'
                : 'bg-[#d64b4b] border-red-300/40 text-white shadow-lg'
              : o.soon
                ? 'bg-[#2a2427] border-white/5 text-slate-500 cursor-not-allowed'
                : 'bg-[#2a2427] border-white/10 text-slate-200 hover:bg-[#362f33]'
          }`}
        >
          {o.label}
        </button>
      );
    })}
  </div>
);

/** A wide button that says what it is set to. */
const Switch: React.FC<{ label: string; onClick: () => void; tone?: 'plain' | 'red' | 'amber' | 'green' }> = ({
  label,
  onClick,
  tone = 'plain'
}) => (
  <button
    onClick={() => {
      sounds.playClick();
      onClick();
    }}
    className={`w-full py-3.5 rounded-2xl text-[14px] font-extrabold border transition-all ${
      tone === 'red'
        ? 'bg-[#d64b4b] hover:bg-[#c43f3f] border-red-300/30 text-white shadow-lg'
        : tone === 'amber'
          ? 'bg-[#e0851d] hover:bg-[#c97417] border-amber-200/30 text-white shadow-lg'
          : tone === 'green'
            ? 'bg-[#1f9d55] hover:bg-[#1a8a4a] border-emerald-300/30 text-white shadow-lg'
            : 'bg-[#2a2427] hover:bg-[#362f33] border-white/10 text-white'
    }`}
  >
    {label}
  </button>
);

const Slider: React.FC<{ label: string; value: number; onChange: (v: number) => void }> = ({
  label,
  value,
  onChange
}) => (
  <div className="flex items-center gap-4 py-2">
    <span className="text-[15px] font-extrabold text-white w-20">{label}</span>
    <input
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="flex-1 h-2 rounded-full appearance-none cursor-pointer accent-[#d64b4b] bg-[#1a1618]"
    />
    <span className="text-[14px] font-extrabold font-mono tabular-nums text-slate-300 w-14 text-right">
      %{Math.round(value * 100)}
    </span>
  </div>
);

export const SettingsModal: React.FC = () => {
  const settings = useGameStore((s) => s.gameState.settings);
  const notifications = useGameStore((s) => s.gameState.notifications);
  const account = useGameStore((s) => s.account);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const resetGameSave = useGameStore((s) => s.resetGameSave);
  const markNotificationsRead = useGameStore((s) => s.markNotificationsRead);
  const clearNotifications = useGameStore((s) => s.clearNotifications);
  const signOutAccount = useGameStore((s) => s.signOutAccount);

  const [page, setPage] = useState<'settings' | 'log'>('settings');
  const [confirmReset, setConfirmReset] = useState(false);

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  const setVolume = (masterVolume: number) => {
    sounds.setMasterVolume(masterVolume);
    updateSettings({ masterVolume });
  };
  const effectsOn = settings.sfxVolume > 0;
  const toggleEffects = () => {
    sounds.toggleMute(effectsOn);
    updateSettings({ sfxVolume: effectsOn ? 0 : 0.8 });
  };

  const openLog = () => {
    markNotificationsRead();
    setPage('log');
  };

  const now = Date.now();
  const providerLabel =
    account?.provider === 'google' ? 'Google' : account?.provider === 'email' ? 'E-posta' : 'Misafir';

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-[#231e21] border border-white/10 rounded-[2rem] w-full max-w-lg shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[88vh]">
        <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            {page === 'log' ? (
              <button
                onClick={() => {
                  sounds.playClick();
                  setPage('settings');
                }}
                className="w-10 h-10 rounded-2xl bg-[#2f292c] border border-white/10 hover:bg-[#3a3337] text-slate-200 flex items-center justify-center"
                aria-label="Ayarlara dön"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <span className="w-1.5 h-8 rounded-full bg-[#d64b4b]" />
            )}
            <span className="text-2xl font-black text-white">{page === 'log' ? 'Bildirim Geçmişi' : 'Ayarlar'}</span>
          </div>
          <button
            onClick={handleClose}
            className="w-11 h-11 rounded-2xl bg-[#2f292c] border border-white/10 hover:bg-[#3a3337] text-slate-200 flex items-center justify-center transition-colors"
            aria-label="Kapat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6 overflow-y-auto flex-1">
          {page === 'log' ? (
            <div className="pt-3">
              {notifications.length === 0 ? (
                <div className="text-center py-14 text-slate-500 text-sm font-bold">Henüz bildirim yok.</div>
              ) : (
                notifications.map((notif) => {
                  const style = styleFor(notif.type);
                  return (
                    <div key={notif.id} className="flex items-start gap-3 py-2.5 border-b border-white/10">
                      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${style.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className={`text-[13px] font-bold leading-snug break-words ${style.tint}`}>
                          {notif.title}
                          {notif.count > 1 && (
                            <span className="ml-1.5 text-[11px] font-extrabold tabular-nums opacity-80">×{notif.count}</span>
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
              {notifications.length > 0 && (
                <div className="pt-4">
                  <Switch
                    label="Günlüğü Temizle"
                    onClick={() => {
                      clearNotifications();
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <>
              <SectionTitle>Dil</SectionTitle>
              <Choice
                options={[
                  { id: 'tr', label: 'Türkçe' },
                  { id: 'en', label: 'English', soon: true }
                ]}
                value={settings.language}
                onPick={(id) => updateSettings({ language: id as 'tr' | 'en' })}
              />

              <SectionTitle>Grafik</SectionTitle>
              <Hint>Düşük ayar gölgeleri ve kenar yumuşatmayı kapatır; zayıf makinelerde akıcılık kazandırır.</Hint>
              <Choice
                options={[
                  { id: 'LOW', label: 'Düşük' },
                  { id: 'MEDIUM', label: 'Orta' },
                  { id: 'HIGH', label: 'Yüksek' }
                ]}
                value={settings.graphicsQuality}
                onPick={(id) => updateSettings({ graphicsQuality: id as 'LOW' | 'MEDIUM' | 'HIGH' })}
                tone="red"
              />

              <SectionTitle>Ses</SectionTitle>
              <Slider label="Ses" value={settings.masterVolume} onChange={setVolume} />
              <div className="pt-2">
                <Switch label={`Efektler: ${effectsOn ? 'Açık' : 'Kapalı'}`} onClick={toggleEffects} />
              </div>

              <SectionTitle>Bildirimler</SectionTitle>
              <Hint>Sol alttaki mesajlar kaybolur; hepsi burada saklanır.</Hint>
              <button
                onClick={() => {
                  sounds.playClick();
                  openLog();
                }}
                className="w-full py-3.5 rounded-2xl text-[14px] font-extrabold border bg-[#2a2427] hover:bg-[#362f33] border-white/10 text-white flex items-center justify-center gap-2"
              >
                <Bell className="w-4 h-4" />
                <span>Bildirim Geçmişi{notifications.length > 0 ? ` (${notifications.length})` : ''}</span>
              </button>

              <SectionTitle>Hesap (kaydın bulutta saklanır)</SectionTitle>
              <div className="flex items-center justify-between gap-3 py-1 pb-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-extrabold text-white truncate">{account?.name ?? 'Giriş yapılmadı'}</div>
                  <div className="text-[12px] font-semibold text-slate-400 truncate">
                    {account ? `${providerLabel}${account.email ? ` · ${account.email}` : ''}` : 'Kayıt bu cihazda tutulur.'}
                  </div>
                </div>
                {account && (
                  <button
                    onClick={() => {
                      sounds.playClick();
                      void signOutAccount();
                    }}
                    className="px-4 py-2.5 rounded-xl bg-[#2a2427] hover:bg-[#362f33] border border-white/10 text-[13px] font-extrabold text-white flex items-center gap-1.5 shrink-0"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Çıkış Yap</span>
                  </button>
                )}
              </div>
              <Hint>Oyun kaydı otomatik tutulur (her 15 sn).</Hint>

              <SectionTitle>Baştan Başla</SectionTitle>
              <Hint>
                İstasyonun, paran, günün ve yapıların SİLİNİR — 1. günden 15.000 TL ile sıfırdan başlarsın. Hesabın
                durur.
              </Hint>
              <button
                onClick={() => {
                  sounds.playClick();
                  if (!confirmReset) setConfirmReset(true);
                  else resetGameSave();
                }}
                className={`w-full py-3.5 rounded-2xl text-[14px] font-extrabold border transition-all text-white flex items-center justify-center gap-2 ${
                  confirmReset
                    ? 'bg-[#b91c1c] border-red-300/40 animate-pulse'
                    : 'bg-[#d64b4b] hover:bg-[#c43f3f] border-red-300/30 shadow-lg'
                }`}
              >
                <RotateCcw className="w-4 h-4" />
                <span>{confirmReset ? 'Emin misin? Onaylamak için tekrar tıkla' : 'Baştan Başla'}</span>
              </button>
              {confirmReset && (
                <button
                  onClick={() => {
                    sounds.playClick();
                    setConfirmReset(false);
                  }}
                  className="w-full mt-2 py-2 text-[13px] font-bold text-slate-400 hover:text-white"
                >
                  Vazgeç
                </button>
              )}
              <div className="h-2" />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

