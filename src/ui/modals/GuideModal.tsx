import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore, EDIT_MODE_LEVEL } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';
import { GAME_EVENTS } from '../../config/eventConfig';
import { FUEL_DEAL_DISCOUNT, FUEL_DEAL_NAME, eventEffectSummary } from '../../domain/services/simulationEngine';
import { X, BookOpen, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';
import { matchesGuideSearch } from './guideSearch';
import { CHARGE_GLYPH, DEPARTURE_GLYPHS, FACILITY_GLYPHS, PATIENCE_GLYPHS } from '../../rendering/vehicleMood';

/**
 * The guide (Emre, 2026-09-09): everything the lessons say, at length, plus
 * what a lesson card cannot fit — why a thing is locked and when it opens, what
 * each event on the road means, and how to grow faster. Figures are read
 * from the config so the book never drifts from the game.
 */

type Section = { id: string; title: string; render: () => React.ReactNode };

/** Extract the words already rendered by a section, including UL `items`. */
function guideNodeText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(guideNodeText).join(' ');
  if (!React.isValidElement<{ children?: React.ReactNode; items?: React.ReactNode[] }>(node)) {
    return '';
  }
  return [node.props.children, node.props.items].map(guideNodeText).join(' ');
}

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
          <P>Araç pompaya yanaşır ve bekler. Üstüne tıklayınca panel açılır: istediği yakıt türü ve tutar yazar. Aynı tabancayı seç, istediği tutarı kutuya yaz ya da hazır tutarlardan seç, dolumu başlat; sayaç kendi akar, bitince teslim edip parasını alırsın.</P>
          <P>Tutarı tutturmak senin işin: az doldurursan müşteri döküleni öder ama memnuniyeti düşer; fazla doldurursan yalnızca istediğini öder, fazlası senin zararın.</P>
          <H>Cam temizleme ne kazandırır</H>
          <P>Cam temizle düğmesi müşteri memnuniyetine sekiz puan ekler ve bahşiş ihtimalini artırır. Memnuniyet gün sonunda itibara döner, itibar yarınki trafiği belirler. Küçük bir tık, büyük bir zincir.</P>
          <H>Sabır</H>
          <P>Her müşterinin sabrı var; kuyrukta ve pompada erir. Sabrı biten gider, kaybedilen her müşteri itibardan 0,015 düşürür. Tank boşsa ya da pompa arızalıysa müşteri bakar ve hemen gider.</P>
          <H>Pompacı</H>
          <P>Seviye 3'te işe alınır, {lira(attendant.hireCost)} işe alım ve günde {lira(attendant.dailyWage)} maaş. Pompayı senin yerine işletir. Hizmet sayısı arttıkça eğitilir: daha hızlı dolum, daha kısa tepki. Bir pompacı bir pompaya bakar; Personel kartındaki kalemle adını değiştirebilirsin.</P>
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
      id: 'moods',
      title: 'Araç üstü emojiler',
      render: () => (
        <>
          <P>Araçların üstündeki emojiler müşteriyi uzaktan okumanı sağlar: ne için geldiğini, sabrının ne durumda olduğunu ve giderken neden gittiğini. Giderken çıkan emoji birkaç saniye görünür, sonra kaybolur.</P>
          <H>Ne için geldi</H>
          <UL items={[
            <>⛽ <b>{Object.values(GAME_CONFIG.fuels).map((f) => f.shortName).join(', ')}</b>: yakıt almaya geldi; yanında istediği yakıt yazar.</>,
            <>{CHARGE_GLYPH.emoji} <b>{CHARGE_GLYPH.label}</b>: elektrikli araç; pompaya değil şarj ünitesine gelir.</>,
            <>{Object.values(FACILITY_GLYPHS).map((g) => `${g.emoji} ${g.label}`).join('  ·  ')}: o tesis için uğradı, ya da yakıtını alıp tesise yürüdü.</>
          ]} />
          <H>Sabrı</H>
          <UL items={PATIENCE_GLYPHS.map((g) => <>{g.emoji} <b>{g.label}</b>: {g.hint}</>)} />
          <H>Neden gitti</H>
          <UL items={Object.values(DEPARTURE_GLYPHS).map((g) => <>{g.emoji} <b>{g.label}</b>: {g.hint}</>)} />
        </>
      )
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
          <H>Ada sundurması</H>
          <P>Katalogda değil, pompanın kendi panelinde: pompaya tıkla, "+ Sundurma Ekle" de. Bir çatı bir pompayı örter, {lira(GAME_CONFIG.buildings.canopy.price)} eder, günde {lira(GAME_CONFIG.buildings.canopy.dailyUpkeep)} bakım ister.</P>
          <UL items={[
            'O pompada dolum yüzde 5 hızlanır; kuyruk daha çabuk erir.',
            'Çatı altında servis sahayı daha az kirletir: bütün pompalar örtülüyse kirlenme yüzde 30 yavaşlar.',
            'Her çatı istasyonun çekiciliğine ve müşteri memnuniyetine küçük bir pay ekler.',
            `Güneş panelleri yalnızca sundurmaya takılır (Seviye ${solar.unlockLevel}); çatısız pompaya panel yok.`,
            `Sökersen bedelin yüzde ${Math.round(GAME_CONFIG.economy.refundRatio * 100)}'ı geri gelir, üstündeki paneller de onunla gider.`
          ]} />
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
            <><b>{FUEL_DEAL_NAME} %{Math.round(FUEL_DEAL_DISCOUNT * 100)}</b>: arada bir, piyasanın sakin olduğu bir günde, rastgele bir saatte ve yalnızca bir dakika açık kalan pencere. Zam, kur ya da tedarik indirimi olan günlerde ve art arda iki gün gelmez. Sağ üstte geri sayımla görünür. Yakalarsan tüm yakıtlarda alış fiyatı üçte bir düşer; depoyu fullemenin tam zamanı. Sv.3 müdür bunu senin yerine yapar.</>,
            <><b>Tedarik İndirimi</b>: bir olaydır, gün boyu sürer, alışı yüzde altı ucuzlatır. Küçük ama uzun.</>,
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
          <P>Ofis → Fiyat'ta her yakıtın satış fiyatını ayarlarsın. Temel kural nettir: fiyatı düşürmek daha çok müşterinin durmasını, fiyatı artırmak daha az müşterinin durmasını sağlar. Düşük fiyat satış hacmini büyütür; yüksek fiyat litre başına marjı büyütür.</P>
          <P>“Tahmini müşteri ilgisi” göstergesinde yüzde 100 normal seviyedir. Yüzde 80 yaklaşık yüzde 20 daha az, yüzde 120 yaklaşık yüzde 20 daha fazla ilgi demektir. Bu toplam tahmine fiyatın yanında itibar, tesisler, yoğun saat ve gece aydınlatması da girer.</P>
          <P>Fiyat satırındaki küçük rakam alış maliyetidir. Ok ise satış fiyatının bölge ortalamasına göre ucuz mu pahalı mı olduğunu gösterir.</P>
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
            `Saha kirlenir; kirli saha memnuniyeti düşürür. Her eksik 25 puan ${lira(GAME_CONFIG.economy.siteCleanCost)}; düğmedeki toplam bedel sahayı tek seferde yüzde 100 yapar.`,
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
              <div className="font-display text-[14px] text-ink">{FUEL_DEAL_NAME} %{Math.round(FUEL_DEAL_DISCOUNT * 100)}</div>
              <div className="text-[12px] font-semibold text-mute">Sakin günlerde arada bir, bir dakikalık alış indirimi. Depoyu fullemenin zamanı.</div>
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
          `${FUEL_DEAL_NAME} penceresini kaçırma; Sv.3 müdür yakalar.`,
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
  const all = useMemo(() => sections(), []);
  const [active, setActive] = useState(all[0].id);
  const [query, setQuery] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const searchable = useMemo(
    () => all.map((section) => ({ section, text: `${section.title} ${guideNodeText(section.render())}` })),
    [all]
  );
  const visible = useMemo(
    () => searchable.filter(({ text }) => matchesGuideSearch(query, text)).map(({ section }) => section),
    [query, searchable]
  );
  const current = visible.find((section) => section.id === active) ?? visible[0] ?? null;
  const currentIndex = current ? visible.findIndex((section) => section.id === current.id) : -1;

  useEffect(() => {
    if (current && current.id !== active) setActive(current.id);
  }, [active, current]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [current?.id]);

  const openSection = (id: string) => {
    sounds.playClick();
    setActive(id);
  };

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
          <div className="w-52 shrink-0 border-r-2 border-ink bg-board p-2 flex flex-col gap-2 min-h-0">
            <label className="relative block shrink-0">
              <span className="sr-only">Rehberde ara</span>
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-mute pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Rehberde ara…"
                className="w-full h-9 rounded-md border-2 border-ink bg-card pl-8 pr-2 text-[12px] font-bold text-ink outline-none focus:border-kblu"
              />
            </label>
            <div className="flex-1 min-h-0 flex flex-col gap-1.5 overflow-y-auto">
              {visible.map((section) => {
                const order = all.findIndex((item) => item.id === section.id) + 1;
                return (
                  <button
                    key={section.id}
                    onClick={() => openSection(section.id)}
                    className={`k-tab text-left text-[13px] flex items-baseline gap-2 ${section.id === current?.id ? 'k-tab-on' : ''}`}
                  >
                    <span className="font-mono text-[10px] opacity-60 tabular-nums">{String(order).padStart(2, '0')}</span>
                    <span>{section.title}</span>
                  </button>
                );
              })}
              {visible.length === 0 && (
                <div className="px-2 py-3 text-[12px] font-semibold text-mute">Eşleşen bölüm bulunamadı.</div>
              )}
            </div>
            {query && (
              <div className="shrink-0 px-1 text-[10px] font-bold text-mute">
                {visible.length} / {all.length} bölüm
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div ref={contentRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-2">
              {current ? (
                <>
                  <div className="font-display text-xl text-ink">{current.title}</div>
                  {current.render()}
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-center text-mute">
                  <Search className="w-8 h-8" />
                  <div className="font-display text-lg text-ink">Sonuç bulunamadı</div>
                  <P>Başka bir kelimeyle tekrar ara.</P>
                </div>
              )}
            </div>
            {current && (
              <div className="shrink-0 border-t-2 border-ink bg-board px-4 py-2 flex items-center justify-between gap-3">
                <button
                  onClick={() => currentIndex > 0 && openSection(visible[currentIndex - 1].id)}
                  disabled={currentIndex <= 0}
                  className="game-btn px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" /> Önceki
                </button>
                <span className="k-label text-[10px] tabular-nums">
                  {currentIndex + 1} / {visible.length}
                </span>
                <button
                  onClick={() => currentIndex < visible.length - 1 && openSection(visible[currentIndex + 1].id)}
                  disabled={currentIndex >= visible.length - 1}
                  className="game-btn px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Sonraki <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
