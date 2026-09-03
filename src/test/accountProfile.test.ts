import { describe, it, expect } from 'vitest';
import { backendReadyFrom, profileFrom } from '../services/account';

/**
 * Hesap katmanı (Emre, 2026-09-03): Google / e-posta / misafir girişi.
 * Firebase'e dokunmadan sınanabilen iki sözleşme çivilenir: profil eşlemesi
 * (sağlayıcı ve görünen ad seçimi) ve "anahtar yoksa sistem kapalı" kuralı —
 * oyun, yapılandırmasız ortamda girişsiz ama sapasağlam çalışmalıdır.
 */
describe('the account layer', () => {
  it('is politely off unless every Firebase key is present', () => {
    // Anahtarsız ya da yarım yapılandırma = kapalı sistem; oyun yerelde yaşar.
    expect(backendReadyFrom({})).toBe(false);
    expect(backendReadyFrom({ apiKey: 'x', authDomain: 'y', projectId: 'z' })).toBe(false);
    expect(
      backendReadyFrom({ apiKey: 'x', authDomain: 'y', projectId: 'z', appId: 'w' })
    ).toBe(true);
  });

  it('maps Firebase users to honest profiles', () => {
    expect(
      profileFrom({
        uid: 'u1', isAnonymous: false, displayName: 'Arda Emre',
        email: 'e@example.com', providerData: [{ providerId: 'google.com' }]
      })
    ).toEqual({ uid: 'u1', name: 'Arda Emre', email: 'e@example.com', provider: 'google' });

    // E-posta hesabında ad yoksa adresin sahibi kadar dürüst bir ad: kullanıcı adı.
    expect(
      profileFrom({
        uid: 'u2', isAnonymous: false, displayName: null,
        email: 'gulpetrol@example.com', providerData: [{ providerId: 'password' }]
      })
    ).toEqual({ uid: 'u2', name: 'gulpetrol', email: 'gulpetrol@example.com', provider: 'email' });

    // Misafir misafirdir: adsız, e-postasız, ama profilsiz değil.
    expect(
      profileFrom({ uid: 'u3', isAnonymous: true, displayName: null, email: null, providerData: [] })
    ).toEqual({ uid: 'u3', name: 'Misafir İşletmeci', email: null, provider: 'guest' });
  });
});
