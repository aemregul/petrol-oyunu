import React from 'react';
import { MonitorX } from 'lucide-react';

/**
 * What a player sees instead of a black screen when the browser cannot
 * give the game a WebGL 2 context (Emre, 2026-09-09). Says what is
 * missing, what usually fixes it, and lets them try anyway in case the
 * probe was wrong.
 */
export const UnsupportedGraphics: React.FC<{ onTryAnyway: () => void }> = ({ onTryAnyway }) => (
  <div className="w-screen h-screen bg-paper text-ink flex items-center justify-center p-6 select-none">
    <div className="game-surface max-w-lg w-full overflow-hidden">
      <div className="k-head k-head-red">
        <div className="flex items-center gap-3">
          <div className="game-icon-badge w-10 h-10"><MonitorX className="w-5 h-5" /></div>
          <div>
            <div className="text-[10px] uppercase font-bold font-sans text-white/80 tracking-wider">Petrol Oyunu</div>
            <div className="font-display text-xl tracking-wide">Tarayıcın WebGL 2 desteklemiyor</div>
          </div>
        </div>
      </div>
      <div className="p-5 flex flex-col gap-3 text-[13px] font-semibold leading-relaxed">
        <p>
          Oyunun sahnesi WebGL 2 ile çiziliyor ve bu tarayıcı bunu açamadı. Genelde sebep eski bir
          tarayıcı, kapalı donanım hızlandırma ya da güncel olmayan ekran kartı sürücüsü.
        </p>
        <ul className="flex flex-col gap-1.5 pl-1">
          {[
            'Chrome, Edge ya da Firefox\'un güncel bir sürümünü kullan. Windows 8.1\'de son sürümler Chrome/Edge 109 ve Firefox 115.',
            'Tarayıcı ayarlarında "Donanım hızlandırma" açık olsun; kapalıysa aç ve tarayıcıyı yeniden başlat.',
            'Ekran kartı sürücüsünü güncelle. DirectX 11 çalıştıramayan çok eski kartlarda WebGL 2 açılmaz.',
            'Chrome\'da adres çubuğuna chrome://gpu yaz: "WebGL2: Hardware accelerated" görünmeli.'
          ].map((line, i) => (
            <li key={i} className="flex gap-2"><span className="text-kred shrink-0">•</span><span>{line}</span></li>
          ))}
        </ul>
        <div className="pt-1">
          <button
            onClick={onTryAnyway}
            className="game-btn px-4 py-2.5 rounded-md font-display text-xs uppercase tracking-wide bg-card hover:bg-board text-ink"
          >
            Yine de dene
          </button>
        </div>
      </div>
    </div>
  </div>
);
