# Project Highway — Akaryakıt İstasyonu Simülatörü

İzometrik bir akaryakıt istasyonu işletme simülasyonu. Oyuncu pompalara hizmet
verir, yakıt tedarik eder, fiyat belirler, personel çalıştırır, arsa satın alıp
tesisini büyütür.

React + TypeScript + Three.js (react-three-fiber) ile yazıldı, durum yönetimi
Zustand üzerinde.

## Çalıştırma

```bash
npm install
npm run dev        # http://localhost:3000
```

| Komut | Ne yapar |
| --- | --- |
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | Üretim derlemesi (`tsc` + `vite build`) |
| `npm test` | Test paketi (vitest) |
| `npm run screenshot -- out.png` | Oyunu headless tarayıcıda açıp ekran görüntüsü alır |

## Mimari

Simülasyon, arayüzden tamamen ayrık bir katmanda çalışır:

- **`src/domain/services/simulationEngine.ts`** — oyun döngüsünün tamamı. Tüm
  fonksiyonlar tek bir state taslağını değiştirir ve yan etkileri (bildirim, ses)
  bir toplayıcıya yazar; store sonucu **tek bir `set`** ile işler. Bu sayede tick
  içinde iç içe store yazımı olmaz.
- **`src/domain/stateMachines/`** — araç, pompa, çalışan ve sipariş durum
  makineleri. Her geçiş doğrulanır; testlerden biri yoğun bir istasyonu bir gün
  boyunca sürüp tek bir geçersiz geçiş olmadığını garanti eder.
- **`src/domain/services/land.ts`** — parsel bazlı arsa sahipliği. Arsa satın
  alma ve beton dökme ayrı işlemlerdir.
- **`src/domain/services/placement.ts`** — inşaat yerleşim kuralları (sınır,
  çakışma, seviye kilidi, betonlanmış zemin şartı).
- **`src/domain/formulas/economy.ts`** — GDD'deki ekonomi formülleri.
- **`src/rendering/`** — Three.js sahnesi. Hazır GLTF modelleri ve elle yazılmış
  geometriler bir arada kullanılır; model yüklenemezse yedek geometriye düşer.

## Geliştirici yardımcıları

- **Test Paneli** (sol alt) — para ekleme ve "Her Şeyin Kilidini Aç" butonu.
- `?showcase=buildings` — inşaat kataloğundaki tüm yapıların vitrini.
- `?showcase=vehicles` — araç modellerinin vitrini.

## Varlıklar

3B modeller [Kenney](https://kenney.nl) kitlerinden alınmıştır (Car Kit,
City Kit Commercial, City Kit Roads, Factory Kit) ve **CC0** lisanslıdır.
Pompa, sundurma, fiyat totemi, şarj üniteleri, servis binaları ve park alanları
gibi hazır karşılığı olmayan parçalar proje içinde geometri olarak yazılmıştır.
