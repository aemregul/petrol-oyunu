import { EDIT_MODE_LEVEL } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';

/**
 * The first-run tour (Emre, 2026-09-09): a spotlight on one piece of the
 * screen at a time, an arrow, and a few lines on what it is for. Every
 * target names a `data-tour` attribute in the HUD; a step with no target is
 * a plain card in the middle. The guide behind Ayarlar says the same things
 * at length, for whenever the player wants them again.
 */
export interface TourStep {
  id: string;
  /** The `data-tour` key of the thing to point at, or null for a centred card. */
  target: string | null;
  title: string;
  body: string[];
}

const attendant = GAME_CONFIG.employees.pumpAttendant.tierLevels[0];
const manager = GAME_CONFIG.employees.manager;

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    target: null,
    title: 'Hoş geldin patron',
    body: [
      'Yol kenarında tek pompalı küçük bir istasyonun var. Araçlar yoldan sapıp yakıt alır, sen de kazandığını yeni pompalara, marketlere ve tesislere yatırırsın.',
      'Bu tur ekrandaki her şeyi tek tek gösterir. İstediğin an Atla diyebilirsin; aynı anlatım Ayarlar → Rehber altında hep durur.'
    ]
  },
  {
    id: 'stats',
    target: 'stats',
    title: 'Gün, kasa, itibar, seviye',
    body: [
      'Gün, kaçıncı günde olduğun; günün gelir gider dökümü Ofis → Muhasebe\'de. Kasa harcayabildiğin para.',
      'İtibar 1 ile 5 arasında; yoldan geçenlerin kaçının sana döneceğini belirler. Müşteri kaybetmek düşürür, iyi hizmet yükseltir.',
      'Seviye deneyimle artar ve yeni yapıları, personeli ve düzenleme modunu açar.'
    ]
  },
  {
    id: 'clock',
    target: 'clock',
    title: 'Saat ve açık/kapalı',
    body: [
      'Bir oyun günü dört gerçek dakika sürer, sabah altıdan ertesi sabah altıya. Gece trafiği azdır ve aydınlatmasız saha geceleri müşteri kaçırır.',
      'AÇIK düğmesi istasyonu kapatır: yeni araç gelmez ama saat işler. Rahat rahat inşaat yapmak için kullan.'
    ]
  },
  {
    id: 'stock',
    target: 'stock',
    title: 'Tanklarındaki yakıt',
    body: [
      'Sattığın her litre buradan düşer. Tank boşalınca gelen müşteri hizmet alamadan gider ve itibarın düşer.',
      'Yeni yakıtı Tedarik düğmesinden tankerle sipariş edersin. Tanker yolda biraz zaman alır; stok yüzde yirmiye inmeden düşün.'
    ]
  },
  {
    id: 'serve',
    target: null,
    title: 'Müşteriye servis',
    body: [
      'Araç pompaya yanaşınca üstüne tıkla. Panelde ne istediği yazar: yakıt türü ve miktar. Aynı türü seçip dolumu başlat.',
      'Cam temizle düğmesi ufak bir iş ama müşteri memnuniyetine sekiz puan ekler ve bahşiş ihtimalini artırır. Memnuniyet itibara döner.',
      'Her müşterinin sabrı var. Bekletirsen gider ve itibardan yer. Pompacı işe alana kadar servis senin işin.'
    ]
  },
  {
    id: 'build',
    target: 'build',
    title: 'İnşaat',
    body: [
      'Pompa, market, tuvalet, kafe, yıkama, şarj ünitesi ve daha fazlası burada. Kart üstündeki rozet kaç tane kurabileceğini söyler: kimi arsa başına bir, kimi istasyonda tek.',
      'Her ek birim bir öncekinden pahalıdır. Yerleştirirken kırmızı taralı alan araç yoludur, oraya yapı gelmez.',
      'Sattığın yapı bedelinin yalnızca yüzde kırkını geri verir; nereye koyacağını düşün.'
    ]
  },
  {
    id: 'fuel',
    target: 'fuel',
    title: 'Tedarik ve indirimler',
    body: [
      'Toptan alış fiyatı her gün oynar. En az beş yüz litre sipariş edilir, her tankerin nakliye ücreti vardır.',
      'İki farklı indirim var. Yakıtta İndirim günde bir kez, bir dakikalığına açılan yüzde otuzluk penceredir; yakalarsan depoyu fulle. Tedarikçi İndirimi ise gün boyu süren yüzde altılık bir olaydır.',
      'Rafineri Zammı ve Kur Dalgalanması tersine, o gün alışı pahalılaştırır.'
    ]
  },
  {
    id: 'staff',
    target: 'staff',
    title: 'Personel',
    body: [
      `Pompacı seviye 3'te işe alınır, günde ₺${attendant.dailyWage.toLocaleString('tr-TR')} maaşla pompayı senin yerine işletir. Hizmet sayısı arttıkça eğitilir, hızlanır.`,
      `İstasyon müdürü seviye ${manager.minLevel}'da, ${manager.minReputation.toFixed(2)} itibar ve iki pompacıyla gelir. Üç kademesi var; kademe yükseldikçe daha çok işi devralır: sipariş, fiyat, bakım, tamir, indirimde stoklama.`
    ]
  },
  {
    id: 'office',
    target: 'office',
    title: 'Ofis',
    body: [
      'Fiyat sekmesinde satış fiyatını bölge ortalamasına göre ayarlarsın; ucuz fiyat müşteri çeker ama litre başına kazancı düşürür.',
      'Muhasebe kredileri ve günlük giderleri gösterir. Görevler sekmesindeki hedefler nakit ödül verir; ilk günlerde en hızlı para orada.'
    ]
  },
  {
    id: 'maintenance',
    target: 'maintenance',
    title: 'Bakım masası',
    body: [
      'Pompalar zamanla yıpranır, sağlığı yüzde yirmi beşin altına düşen pompa arızalanabilir ve müşteri kaybettirir. Bakım ve tamir burada.',
      'Saha kirlenir, kirli saha memnuniyeti düşürür. Güneş panellerinin camı tozlanır ve üretim yarıya iner; yağmur biraz yıkar, gerisi senin.',
      'Anahtar üstündeki kırmızı sayı ilgi bekleyen şeyleri sayar.'
    ]
  },
  {
    id: 'edit',
    target: 'edit',
    title: 'Düzenleme modu',
    body: [
      `Kurduğun yapıları taşımak için. Seviye ${EDIT_MODE_LEVEL}'te açılır, o yüzden şimdilik sönük. Açılınca düğmeye bas, sonra taşımak istediğin yapıya tıkla.`,
      'Taşımanın küçük bir ücreti vardır ama satıp yeniden kurmaktan çok daha ucuzdur.'
    ]
  },
  {
    id: 'camera',
    target: 'camera',
    title: 'Kamera',
    body: [
      'Bu düğme bakış açısını değiştirir. Q ve E döndürür, tekerlek yakınlaştırır, sürükleyince kaydırır, F ortalar.'
    ]
  },
  {
    id: 'settings',
    target: 'settings',
    title: 'Ayarlar ve Rehber',
    body: [
      'Ses, grafik ve koyu mod burada. Rehber de burada: neyin neden kilitli olduğu, olayların ne anlama geldiği, daha hızlı büyümenin yolları.',
      'Bu turu istediğin zaman oradan yeniden başlatabilirsin. Bol kazançlar patron.'
    ]
  }
];
