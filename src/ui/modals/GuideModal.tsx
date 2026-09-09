import React, { useState } from 'react';
import { useGameStore, EDIT_MODE_LEVEL } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';
import { GAME_EVENTS } from '../../config/eventConfig';
import { FUEL_DEAL_DISCOUNT, eventEffectSummary } from '../../domain/services/simulationEngine';
import { X, BookOpen, Play } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

/**
 * The guide (Emre, 2026-09-09): everything the tour says, at length, plus
 * what the tour cannot fit — why a thing is locked and when it opens, what
 * each event on the road means, and how to grow faster. Figures are read
 * from the config so the book never drifts from the game.
 */

type Section = { id: string; title: string; render: () => React.ReactNode };

const P: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[13px] font-semibold text-ink leading-relaxed">{children}</p>
);
const H: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="k-label text-[11px] pt-3 pb-1 border-b-2 border-ink">{children}</div>
);
const UL: React.FC<{ items: React.ReactNode[] }> = ({ items }) => (
  <ul className="flex flex-col gap-1.5 pl-1">
    {items.map((it, i) => (
      <li key={i} className="text-[13px] font-semibold text-ink leading-relaxed flex gap-2">
        <span className="text-kred shrink-0">•</span>
        <span>{it}</span>
      </li>
    ))}
  </ul>
);

const lira = (n: number) => `₺${n.toLocaleString('tr-TR')}`;

function sections(): Section[] {
  const attendant = GAME_CONFIG.employees.pumpAttendant.tierLevels[0];
  const manager = GAME_CONFIG.employees.manager;
  const fuel = GAME_CONFIG.fuels.gasoline;
  const solar = GAME_CONFIG.ev.solar;

  return [
    {
      id: 'loop',
      title: 'Nasıl oynanır',
      render: () => (
        <>
          <P>Yol kenarında bir istasyon işletiyorsun. Yoldan geçen araçların bir kısmı sana sapar; ne kadarının sapacağını itibarın, fiyatın ve tesislerin belirler.</P>
          <P>Bir oyun günü dört gerçek dakika. Sabah altıda başlar, ertesi sabah altıda gün sonu raporu gelir: satışlar, giderler, maaşlar, net kâr. Gün sonunda itibarın o günkü hizmete göre yeniden hesaplanır.</P>
          <H>Günün döngüsü</H>
          <UL items={[
            'Müşteriye servis: pompacı varsa o yapar, yoksa araca tıklayıp sen yaparsın.',
            'Stok: tank bitmeden Tedarik\'ten tanker çağır.',
            'Fiyat: Ofis → Fiyat\'tan bölge ortalamasına göre ayarla.',
            'Yatırım: İnşaat\'tan pompa ve tesis kur, sınırları ve artan fiyatları gözet.',
            'Bakım: anahtar rozeti kızarınca Bakım masasına bak.'
          ]} />
        </>
      )
    },
    {
      id: 'serve',
      title: 'Müşteri servisi',
      render: () => (
        <>
          <P>Araç pompaya yanaşır ve bekler. Üstüne tıklayınca panel açılır: istediği yakıt türü ve miktar yazar. Aynı türü seç, dolumu başlat; sayaç kendi akar, bitince ödeme alınır.</P>
          <H>Cam temizleme ne kazandırır</H>
          <P>Cam temizle düğmesi müşteri memnuniyetine sekiz puan ekler ve bahşiş ihtimalini artırır. Memnuniyet gün sonunda itibara döner, itibar yarınki trafiği belirler. Küçük bir tık, büyük bir zincir.</P>
          <H>Sabır</H>
          <P>Her müşterinin sabrı var; kuyrukta ve pompada erir. Sabrı biten gider, kaybedilen her müşteri itibardan 0,015 düşürür. Tank boşsa ya da pompa arızalıysa müşteri bakar ve hemen gider.</P>
          <H>Pompacı</H>
          <P>Seviye 3'te işe alınır, {lira(attendant.hireCost)} işe alım ve günde {lira(attendant.dailyWage)} maaş. Pompayı senin yerine işletir. Hizmet sayısı arttıkça eğitilir: daha hızlı dolum, daha kısa tepki. Bir pompacı bir pompaya bakar.</P>
        </>
      )
    },
    {
      id: 'vehicles',
      title: 'Araçlar',
      render: () => {
        const fuelName = (c: (typeof GAME_CONFIG.customerTypes)[keyof typeof GAME_CONFIG.customerTypes]) =>
          c.requiresCharger ? 'Şarj (kWh)' : c.preferredFuel === 'any' ? 'Herhangi' : GAME_CONFIG.fuels[c.preferredFuel].shortName;
        const sensitivity = { LOW: 'Bakmaz', MEDIUM: 'Orta', HIGH: 'Her kuruşa' } as const;
        const stops = (w: number | undefined) => (w === undefined || w >= 0.9 ? 'Sık' : w >= 0.5 ? 'Orta' : w >= 0.2 ? 'Seyrek' : 'Nadir');
        return (
          <>
            <P>Yoldaki her araç aynı müşteri değil. Kimi ne yakıt aldığını, ne kadar aldığını, ne kadar beklediğini ve fiyata ne kadar baktığını bilirsen hangi tabancayı açacağını ve fiyatı nereye koyacağını bilirsin.</P>
            <P>Kırmızı ışıklı araçlar, yani polis, ambulans ve itfaiye, trafikte sık görünür ama görevde oldukları için istasyona nadiren döner; döndüklerinde büyük depo doldururlar ve fiyata bakmazlar. Ambulansın sabrı en kısa olanıdır.</P>
            <div className="overflow-x-auto pt-1 shrink-0">
              <table className="w-full text-[12px] font-semibold text-ink border-collapse">
                <thead>
                  <tr className="text-left">
                    {['Araç', 'Yakıt', 'Dolum', 'Sabır', 'Fiyata', 'Bahşiş', 'Uğrama'].map((h) => (
                      <th key={h} className="k-label text-[10px] pb-1 pr-2 border-b-2 border-ink whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.values(GAME_CONFIG.customerTypes).map((c) => (
                    <tr key={c.type} className="border-b-2 border-dotted border-mute/60 align-top">
                      <td className="py-1.5 pr-2 font-display whitespace-nowrap">{c.name}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{fuelName(c)}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">{c.minDemand}–{c.maxDemand}{c.requiresCharger ? ' kWh' : ' L'}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">{c.basePatienceSeconds} s</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{sensitivity[c.priceSensitivity]}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">×{c.tipChanceModifier}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{stops(c.stationStopWeight)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <H>Huyları</H>
            <UL items={Object.values(GAME_CONFIG.customerTypes).map((c) => <><b>{c.name}</b>: {c.specialBehavior}</>)} />
            <P>Sabır sütunu pompada ve kuyrukta bekleyebildiği saniyedir; kuyrukta yarı hızda, dolum sırasında tam hızda erir. Bahşiş sütunu bahşiş ihtimalinin katıdır; temiz saha ve cam temizliği hepsinde artırır. Elektrikli araç pompaya değil şarj direğine gelir ve şarj süresi uzun olduğundan bu arada tesisleri kullanır.</P>
          </>
        );
      }
    },
    {
      id: 'build',
      title: 'İnşaat ve sınırlar',
      render: () => (
        <>
          <P>İnşaat düğmesi kataloğu açar. Kartı seç, arsada yere koy, Yerleştir'e bas. Kırmızı taralı alan araç yoludur, oraya yapı gelmez; beton dökülmemiş parsele de gelmez.</P>
          <H>Sınırlar</H>
          <UL items={[
            'Arsa başına bir tane: market, tuvalet, restoran, kahveci, hava-su, TIR parkı, trafo, batarya, jeneratör. Otopark arsa başına iki.',
            'İstasyonda tek: dinlenme tesisi, otel, yağ, lastik, oto yıkama, reklam kulesi.',
            'Şarj: AC en fazla beş, DC en fazla on.',
            'Karşı arsa yol seviyesi 2 ile açılır; oradaki sınırlar ayrı sayılır.'
          ]} />
          <H>Fiyatlar</H>
          <P>Her ek birim bir öncekinden yüzde otuz pahalıdır; ikinci pompa {lira(Math.round(GAME_CONFIG.buildings.pump_standard.price * GAME_CONFIG.economy.priceGrowthPerUnit / 100) * 100)}, üçüncüsü daha fazla. Süs ve aydınlatma yüzde on artar. Sattığın yapı bedelin yüzde {Math.round(GAME_CONFIG.economy.refundRatio * 100)}'ını geri verir.</P>
          <H>Düzenleme modu</H>
          <P>Sol taraftaki ok düğmesi. Seviye {EDIT_MODE_LEVEL}'te açılır; ona kadar sönük durur. Açıkken yapıya tıkla, yeni yerine koy. Taşıma ücreti yapı bedelinin yüzde {Math.round(GAME_CONFIG.economy.moveFeeRatio * 100)}'si.</P>
        </>
      )
    },
    {
      id: 'fuel',
      title: 'Yakıt tedariki',
      render: () => (
        <>
          <P>Tedarik düğmesinden tanker sipariş edersin. En az {fuel.orderMinLiters} litre, {fuel.orderStepLiters} litrelik adımlarla; her tankerin {lira(fuel.deliveryFee)} nakliyesi var. Tanker yolda zaman alır, kapıda sıraya girer, boşaltır.</P>
          <P>Toptan alış fiyatı her sabah bir miktar oynar. Üç tedarikçi var: ucuz ama yavaş depo, standart, hızlı ama pahalı lojistik.</P>
          <H>İki indirim, bir zam: farkları</H>
          <UL items={[
            <><b>Yakıtta İndirim %{Math.round(FUEL_DEAL_DISCOUNT * 100)}</b>: her gün bir kez, rastgele bir saatte, yalnızca bir dakika açık kalan pencere. Sağ üstte geri sayımla görünür. Yakalarsan tüm yakıtlarda alış fiyatı üçte bir düşer; depoyu fullemenin tam zamanı. Sv.3 müdür bunu senin yerine yapar.</>,
            <><b>Tedarikçi İndirimi</b>: bir olaydır, gün boyu sürer, alışı yüzde altı ucuzlatır. Küçük ama uzun.</>,
            <><b>Rafineri Zammı</b> ve <b>Kur Dalgalanması</b>: tersi; o gün alış yüzde sekiz ya da on iki pahalıdır. Stokun varsa o gün sipariş verme.</>
          ]} />
        </>
      )
    },
    {
      id: 'price',
      title: 'Fiyat ve itibar',
      render: () => (
        <>
          <P>Ofis → Fiyat'ta her yakıtın satış fiyatını ayarlarsın. Yanındaki küçük rakam alış fiyatı, ok bölge ortalamasına göre nerede olduğunu gösterir. Bölgenin altı müşteri çeker ama litre başına kazancı düşürür; üstü tersine.</P>
          <P>Kimin sapacağı fiyata duyarlılığa göre değişir: kurye her kuruşa bakar, lüks araç bakmaz. Dizeli ucuz tutmak TIR çeker.</P>
          <H>İtibar</H>
          <P>Bir ile beş arasında. Üç, düz bir istasyon; beş, yoldan geçenin çok daha fazlasını çeker. Memnuniyet yükseltir, kaybedilen müşteri düşürür, kirli saha memnuniyeti yer. Müdür için {manager.minReputation.toFixed(2)} gerekir.</P>
          <H>Gece</H>
          <P>Geceleri trafik azdır ve aydınlatmasız saha müşterinin yüzde kırkını kaçırır. Her aydınlatma direği yüzde on geri kazandırır, dört direk tamamını.</P>
        </>
      )
    },
    {
      id: 'staff',
      title: 'Müdür',
      render: () => (
        <>
          <P>Seviye {manager.minLevel}, {manager.minReputation.toFixed(2)} itibar, {manager.minActiveAttendants} pompacı ve son üç günün ikisi kârlıyken {lira(manager.hireCost)} ile işe alınır. Kademe kademe iş devralır; her görevi tek tek kapatabilirsin.</P>
          {manager.tiers.map((t, i) => (
            <div key={t.level}>
              <H>Sv.{t.level} · yevmiye {lira(t.dailyWage)} · {t.tourSeconds} saniyede bir tur{i > 0 ? ` · terfi ${lira(t.upgradeCost)}` : ''}</H>
              <P>{t.duties.filter((d) => i === 0 || !manager.tiers[i - 1].duties.includes(d)).map((d) => ({
                collectTills: 'kumbara toplar', fuelOrder: 'yakıt sipariş eder', assignAttendants: 'pompacı atar',
                maintenance: 'bakım yaptırır', pricing: 'fiyat dengeler', nightGridFill: 'bataryayı gece doldurur',
                cleanStation: 'sahayı ve panelleri temizler', repair: 'arıza tamir eder', dealStock: 'indirimde depoyu fuller'
              })[d]).join(', ')}.</P>
            </div>
          ))}
        </>
      )
    },
    {
      id: 'maint',
      title: 'Bakım',
      render: () => (
        <>
          <P>Alt çubuktaki anahtar Bakım masasını açar; üstündeki kırmızı sayı ilgi bekleyenleri sayar.</P>
          <UL items={[
            'Pompa sağlığı zamanla düşer. Yüzde 25 altında arızalanabilir; arızalı pompa müşteriyi geri çevirir. Bakım ucuz, tamir pahalıdır.',
            `Saha kirlenir; kirli saha memnuniyeti düşürür. Temizlik ${lira(GAME_CONFIG.economy.siteCleanCost)}, +25 puan.`,
            `Güneş paneli camı tozlanır. Sıfır temizlikte üretim yüzde ${Math.round((1 - solar.minGrimeFactor) * 100)} düşer. Yağmur kısmen yıkar; çatı yıkama ${lira(solar.cleanCostPerCell * 15)}.`,
            'Sv.1 müdür bakımı, Sv.2 müdür tamiri ve temizliği devralır.'
          ]} />
        </>
      )
    },
    {
      id: 'events',
      title: 'Olaylar sözlüğü',
      render: () => (
        <>
          <P>Sağ üstte kartla belirir, süresi dolunca gider. Kimi iyi kimi kötü; iyisini kullan, kötüsünde bekle.</P>
          <div className="flex flex-col gap-2 pt-1">
            <div className="bg-board border-2 border-ink rounded-md px-3 py-2">
              <div className="font-display text-[14px] text-ink">Yakıtta İndirim %{Math.round(FUEL_DEAL_DISCOUNT * 100)}</div>
              <div className="text-[12px] font-semibold text-mute">Günde bir kez, bir dakikalık alış indirimi. Depoyu fullemenin zamanı.</div>
            </div>
            <div className="bg-board border-2 border-ink rounded-md px-3 py-2">
              <div className="font-display text-[14px] text-ink">Müşteri Yoğunluğu</div>
              <div className="text-[12px] font-semibold text-mute">Kısa süreli, yola çok daha fazla araç çıkar. Pompaların hazır olsun.</div>
            </div>
            {GAME_EVENTS.map((e) => (
              <div key={e.id} className="bg-board border-2 border-ink rounded-md px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-[14px] text-ink">{e.name}</span>
                  <span className="text-[11px] font-bold font-mono text-kblu whitespace-nowrap">{eventEffectSummary(e.effects) || 'temizliğe göre'}</span>
                </div>
                <div className="text-[12px] font-semibold text-mute">{e.description}</div>
              </div>
            ))}
          </div>
        </>
      )
    },
    {
      id: 'locks',
      title: 'Neden kilitli',
      render: () => (
        <>
          <P>Çoğu şey seviyeyle açılır. Seviye deneyimle gelir: her servis, her sipariş, her inşaat ve her görev puan verir.</P>
          <div className="flex flex-col gap-1.5 pt-1">
            {GAME_CONFIG.levels.map((l) => (
              <div key={l.level} className="flex gap-3 text-[13px] font-semibold text-ink">
                <span className="font-display w-12 shrink-0">Sv.{l.level}</span>
                <span>{l.unlockedFeatures}{l.rewardCash > 0 ? ` · ${lira(l.rewardCash)} ödül` : ''}</span>
              </div>
            ))}
          </div>
          <H>Ayrıca</H>
          <UL items={[
            `Düzenleme modu: Seviye ${EDIT_MODE_LEVEL}.`,
            `Güneşli sundurma: Seviye ${solar.unlockLevel}; önce sundurma, sonra o blokta trafo ve batarya gerekir.`,
            `Karşı arsa: yol genişletmesi Seviye ${GAME_CONFIG.roadUpgrade.minLevel} ve ${GAME_CONFIG.roadUpgrade.minReputation.toFixed(1)} itibar, ${lira(GAME_CONFIG.roadUpgrade.price)}.`,
            'Şarj üniteleri: önce trafo, sonra batarya, sonra direk. Sıra şart.'
          ]} />
        </>
      )
    },
    {
      id: 'tips',
      title: 'Daha hızlı büyümek',
      render: () => (
        <UL items={[
          'İlk günler görevleri kovala: nakit ödüller başlangıçta en büyük gelir. Ama hepsini hemen harcama, depo dolumu pahalı.',
          'Her müşteride camı temizle: memnuniyet itibara, itibar trafiğe döner.',
          'Fiyatı bölge ortalamasının biraz altına çek; hacim marjdan çok kazandırır.',
          'İkinci pompadan önce pompacı: kaybedilen müşteri boş pompadan pahalıdır.',
          'Yakıtta İndirim penceresini kaçırma; Sv.3 müdür yakalar.',
          'Kafe ve market yakıt müşterisinden beslenir; yanına ulaşılabilir bir otopark koy, ziyaretler tam bedelle biter.',
          'Oto yıkama, lastik ve yağ servisi her yakıt satışında zar atar; erken dönemde en hızlı geri dönen tesislerdir.',
          'Gece için dört aydınlatma direği, tank yüzde yirmiye inmeden sipariş, pompa sağlığı kırkın altına inmeden bakım.',
          'Seviye ödülleri ve kredi "bedava" görünür; ikisini de tank dolumuna sakla.'
        ]} />
      )
    }
  ];
}

export const GuideModal: React.FC = () => {
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const startTour = useGameStore((s) => s.startTour);
  const all = sections();
  const [active, setActive] = useState(all[0].id);
  const current = all.find((s) => s.id === active) ?? all[0];

  return (
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-4xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="k-head k-head-vio shrink-0">
          <div className="flex items-center gap-3">
            <div className="game-icon-badge w-10 h-10"><BookOpen className="w-5 h-5" /></div>
            <div>
              <div className="text-[10px] uppercase font-bold font-sans text-white/80 tracking-wider">Nasıl oynanır</div>
              <div className="font-display text-xl tracking-wide">Rehber</div>
            </div>
          </div>
          <button
            onClick={() => { sounds.playClick(); setActiveModal('NONE'); }}
            className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="w-48 shrink-0 border-r-2 border-ink bg-board p-2 flex flex-col gap-1.5 overflow-y-auto">
            {all.map((s) => (
              <button
                key={s.id}
                onClick={() => { sounds.playClick(); setActive(s.id); }}
                className={`k-tab text-left text-[13px] ${s.id === active ? 'k-tab-on' : ''}`}
              >
                {s.title}
              </button>
            ))}
            <span className="flex-1" />
            <button
              onClick={() => { sounds.playClick(); setActiveModal('NONE'); startTour(); }}
              className="game-btn px-3 py-2 rounded-md font-display text-xs uppercase tracking-wide bg-kyel text-ink flex items-center justify-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              Turu başlat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-2">
            <div className="font-display text-xl text-ink">{current.title}</div>
            {current.render()}
          </div>
        </div>
      </div>
    </div>
  );
};
