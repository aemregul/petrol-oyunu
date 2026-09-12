import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { X, ArrowLeft, Bell, LogOut, RotateCcw, BookOpen, Play } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';
import { styleFor, timeAgo } from '../notificationStyle';
import { TONE_DOT, TONE_TEXT } from '../gameStyle';
import { isAdmin } from '../../services/admin';

/**
 * The settings card, in the office's dress: one paper card, sections with a
 * small capitals heading, choices as a row of pills, switches as a wide
 * button that names its state. The notification log is a page inside the
 * card rather than a screen of its own (Emre, 2026-09-07).
 */

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="k-label pt-5 pb-2">
    {children}
  </div>
);

const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[12px] font-semibold text-mute -mt-1 pb-2">{children}</p>
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
          className={`game-btn py-3 rounded-md text-[14px] font-display tracking-wide ${
            active
              ? tone === 'green'
                ? 'bg-kgrn text-white'
                : 'bg-kred text-white'
              : o.soon
                ? 'bg-card text-mute cursor-not-allowed'
                : 'bg-card text-ink hover:bg-board'
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
    className={`game-btn w-full py-3.5 rounded-md text-[14px] font-display tracking-wide ${
      tone === 'red'
        ? 'bg-kred hover:bg-kred-dark text-white'
        : tone === 'amber'
          ? 'bg-kyel hover:bg-kyel-dark text-ink'
          : tone === 'green'
            ? 'bg-kgrn hover:bg-kgrn-dark text-white'
            : 'bg-card hover:bg-board text-ink'
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
    <span className="text-[15px] font-extrabold text-ink w-20">{label}</span>
    <input
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="flex-1 h-2 cursor-pointer accent-kblu"
    />
    <span className="text-[15px] font-display tabular-nums text-ink w-14 text-right">
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
  const startTour = useGameStore((s) => s.startTour);
  const resetLessons = useGameStore((s) => s.resetLessons);
  const cloudSync = useGameStore((s) => s.cloudSync);
  const pushCloudSaveNow = useGameStore((s) => s.pushCloudSaveNow);

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
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-lg overflow-hidden flex flex-col max-h-[88vh]">
        <div className="k-head k-head-vio shrink-0">
          <div className="flex items-center gap-3">
            {page === 'log' && (
              <button
                onClick={() => {
                  sounds.playClick();
                  setPage('settings');
                }}
                className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center"
                aria-label="Ayarlara dön"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <span className="font-display text-xl tracking-wide">{page === 'log' ? 'Bildirim Geçmişi' : 'Ayarlar'}</span>
          </div>
          <button
            onClick={handleClose}
            className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center"
            aria-label="Kapat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6 overflow-y-auto flex-1">
          {page === 'log' ? (
            <div className="pt-3">
              {notifications.length === 0 ? (
                <div className="text-center py-14 text-mute text-sm font-bold">Henüz bildirim yok.</div>
              ) : (
                notifications.map((notif) => {
                  const style = styleFor(notif.type);
                  return (
                    <div key={notif.id} className="flex items-start gap-3 py-2.5 border-b-2 border-dotted border-mute/60">
                      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${TONE_DOT[style.tone]}`} />
                      <div className="min-w-0 flex-1">
                        <div className={`text-[13px] font-bold leading-snug break-words ${TONE_TEXT[style.tone]}`}>
                          {notif.title}
                          {notif.count > 1 && (
                            <span className="ml-1.5 text-[11px] font-extrabold tabular-nums opacity-80">×{notif.count}</span>
                          )}
                        </div>
                        <div className="text-[12px] font-medium leading-[1.45] break-words text-mute mt-0.5">
                          {notif.message}
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-mute whitespace-nowrap shrink-0 mt-0.5">
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

              <SectionTitle>Rehber</SectionTitle>
              <Hint>Neyin ne olduğu, neyin neden kilitli olduğu, olayların anlamı ve daha hızlı büyümenin yolları.</Hint>
              <div className="grid grid-cols-2 gap-3 pb-1">
                <button
                  onClick={() => { sounds.playClick(); setActiveModal('GUIDE'); }}
                  className="game-btn py-3 rounded-md text-[14px] font-display tracking-wide bg-kvio text-white flex items-center justify-center gap-2"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>Rehberi Aç</span>
                </button>
                <button
                  onClick={() => { sounds.playClick(); startTour(); }}
                  className="game-btn py-3 rounded-md text-[14px] font-display tracking-wide bg-card hover:bg-board text-ink flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4" />
                  <span>Turu Yeniden Başlat</span>
                </button>
              </div>

              <SectionTitle>Dersler</SectionTitle>
              <Hint>Bir şey ilk kez gerektiğinde oyun onu adım adım gösterir. Daha önce yaptığın işler için ders çıkmaz.</Hint>
              <Choice
                options={[
                  { id: 'on', label: 'Açık' },
                  { id: 'off', label: 'Kapalı' }
                ]}
                value={settings.lessonsOff ? 'off' : 'on'}
                onPick={(id) => updateSettings({ lessonsOff: id === 'off' })}
              />
              <div className="pt-3 pb-1">
                <button
                  onClick={() => { sounds.playClick(); resetLessons(); }}
                  className="game-btn w-full py-3 rounded-md text-[14px] font-display tracking-wide bg-card hover:bg-board text-ink flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4" />
                  <span>Atlanan Dersleri Geri Getir</span>
                </button>
              </div>

              <SectionTitle>Görünüm</SectionTitle>
              <Hint>Koyu mod kartları ve yazıları karartır; sahne olduğu gibi kalır.</Hint>
              <Choice
                options={[
                  { id: 'light', label: 'Açık' },
                  { id: 'dark', label: 'Koyu' }
                ]}
                value={settings.theme ?? 'light'}
                onPick={(id) => updateSettings({ theme: id as 'light' | 'dark' })}
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
              <div className="pt-2">
                <Switch
                  label={`FPS Göster: ${settings.showFps ? 'Açık' : 'Kapalı'}`}
                  onClick={() => updateSettings({ showFps: !settings.showFps })}
                />
              </div>

              <SectionTitle>Ses</SectionTitle>
              <div className="bg-board border-2 border-ink rounded-md px-4 py-2">
                <Slider label="Ses" value={settings.masterVolume} onChange={setVolume} />
              </div>
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
                className="game-btn w-full py-3.5 rounded-md text-[14px] font-display tracking-wide bg-card hover:bg-board text-ink flex items-center justify-center gap-2"
              >
                <Bell className="w-4 h-4" />
                <span>Bildirim Geçmişi{notifications.length > 0 ? ` (${notifications.length})` : ''}</span>
              </button>

              <SectionTitle>Hesap (kaydın bulutta saklanır)</SectionTitle>
              <div className="bg-board border-2 border-ink rounded-md p-4 flex items-center justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-display text-ink truncate">{account?.name ?? 'Giriş yapılmadı'}</div>
                  <div className="text-[12px] font-semibold text-mute truncate">
                    {account ? `${providerLabel}${account.email ? ` · ${account.email}` : ''}` : 'Kayıt bu cihazda tutulur.'}
                  </div>
                </div>
                {account && (
                  <button
                    onClick={() => {
                      sounds.playClick();
                      void signOutAccount();
                    }}
                    className="game-btn px-4 py-2.5 rounded-md bg-card hover:bg-board text-[13px] font-display tracking-wide text-ink flex items-center gap-1.5 shrink-0"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Çıkış Yap</span>
                  </button>
                )}
              </div>
              <Hint>
                {account && account.provider !== 'guest'
                  ? cloudSync.status === 'synced' && cloudSync.at
                    ? `Bulut kaydı eşitlendi (${timeAgo(cloudSync.at, now)}); değişiklikler her 10 saniyede bir gider. Başka bir cihazdan aynı hesapla girince kaldığın yerden devam edersin.`
                    : cloudSync.status === 'syncing'
                      ? 'Bulut kaydı eşitleniyor…'
                      : cloudSync.status === 'error'
                        ? `Bulut kaydı eşitlenemedi: ${cloudSync.message ?? 'bilinmeyen hata'}. Kayıt bu cihazda duruyor.`
                        : 'Bulut kaydı hazırlanıyor.'
                  : account
                    ? 'Misafir hesabı bu cihaza bağlı; Google ya da e-posta ile giriş yaparsan kaydın hesabına taşınır.'
                    : 'Oyun kaydı bu cihazda otomatik tutulur (her 15 sn).'}
              </Hint>
              {account && account.provider !== 'guest' && (
                <div className="pb-2">
                  <Switch
                    label={cloudSync.status === 'syncing' ? 'Eşitleniyor…' : 'Şimdi Buluta Kaydet'}
                    onClick={() => { void pushCloudSaveNow(); }}
                  />
                </div>
              )}

              {isAdmin(account) && (
                <>
                  <SectionTitle>Yönetici</SectionTitle>
                  <Hint>Bu bölümü yalnızca .env'de adı geçen hesaplar görür.</Hint>
                  <div className="pb-2">
                    <Switch label="Yönetici Panelini Aç" tone="amber" onClick={() => setActiveModal('ADMIN')} />
                  </div>
                </>
              )}

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
                className={`game-btn w-full py-3.5 rounded-md text-[14px] font-display tracking-wide text-white flex items-center justify-center gap-2 ${
                  confirmReset
                    ? 'bg-kred-dark animate-pulse'
                    : 'bg-kred hover:bg-kred-dark'
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
                  className="w-full mt-2 py-2 text-[13px] font-bold text-mute hover:text-ink"
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

