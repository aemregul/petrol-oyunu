/**
 * The colour half of the game look. The shape half — borders, shadows, the
 * pressed state — lives in the `game-*` component classes in index.css.
 *
 * Tailwind only ships classes it can find written out in full, so these are
 * whole literal strings rather than anything assembled from parts.
 */

export type Tone = 'red' | 'amber' | 'green' | 'blue' | 'violet' | 'slate';

/**
 * Coloured glass: a dark pane in the tone's own hue, lit at the rim.
 *
 * Saturated fills read as neon over a bright forecourt and drown everything
 * behind them. Taking the colour down to the `-950` end and letting the border
 * and the text carry it keeps a red pill unmistakably red while the scene still
 * shows through. Pair with `game-glass`.
 */
export const TONE_GLASS: Record<Tone, string> = {
  red: 'bg-paper border-kred',
  amber: 'bg-paper border-kyel-dark',
  green: 'bg-paper border-kgrn',
  blue: 'bg-paper border-kblu',
  violet: 'bg-paper border-kvio',
  slate: 'bg-paper border-ink'
};

/** Text on a card: the tone at reading strength on cream. */
export const TONE_TEXT: Record<Tone, string> = {
  red: 'text-kred',
  amber: 'text-kyel-dark',
  green: 'text-kgrn',
  blue: 'text-kblu',
  violet: 'text-kvio',
  slate: 'text-ink'
};

/** The dot marking a tone where there is no room for anything else. */
export const TONE_DOT: Record<Tone, string> = {
  red: 'bg-kred',
  amber: 'bg-kyel',
  green: 'bg-kgrn',
  blue: 'bg-kblu',
  violet: 'bg-kvio',
  slate: 'bg-mute'
};

/**
 * The fill for a pressable button: a flat sticker colour, ink line, hard
 * shadow (the shape comes from `game-btn`).
 */
export const TONE_BUTTON: Record<Tone, string> = {
  red: 'bg-kred hover:bg-kred-dark text-white',
  amber: 'bg-kyel hover:bg-kyel-dark text-ink',
  green: 'bg-kgrn hover:bg-kgrn-dark text-white',
  blue: 'bg-kblu hover:bg-kblu-dark text-white',
  violet: 'bg-kvio hover:bg-kvio-dark text-white',
  slate: 'bg-card hover:bg-board text-ink'
};

/** Body text on a card — readable, but a step back from the title. */
export const PILL_BODY = 'text-mute';
