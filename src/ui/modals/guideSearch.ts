/** Search Turkish guide copy without making the player type every accent. */
export function normalizeGuideSearch(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every word may live anywhere in the title or body. */
export function matchesGuideSearch(query: string, text: string): boolean {
  const words = normalizeGuideSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeGuideSearch(text);
  return words.every((word) => haystack.includes(word));
}
