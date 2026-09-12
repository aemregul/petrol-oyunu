import { describe, expect, it } from 'vitest';
import { matchesGuideSearch, normalizeGuideSearch } from '../ui/modals/guideSearch';

describe('guide search', () => {
  it('matches Turkish copy without requiring Turkish keyboard characters', () => {
    expect(normalizeGuideSearch('İnşaat, Müdür ve Yakıt')).toBe('insaat, mudur ve yakit');
    expect(matchesGuideSearch('mudur yakit', 'Müdür yakıt sipariş eder.')).toBe(true);
  });

  it('requires every search word but lets them appear anywhere in the section', () => {
    const section = 'Gece aydınlatması müşteri trafiğini korur. Dört direk tam etki sağlar.';
    expect(matchesGuideSearch('gece musteri', section)).toBe(true);
    expect(matchesGuideSearch('gece tanker', section)).toBe(false);
  });

  it('shows every section for an empty search', () => {
    expect(matchesGuideSearch('   ', 'Herhangi bir bölüm')).toBe(true);
  });
});
