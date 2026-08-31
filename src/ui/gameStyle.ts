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
  red: 'bg-red-950/75 border-red-400/40',
  amber: 'bg-amber-950/75 border-amber-400/40',
  green: 'bg-emerald-950/75 border-emerald-400/40',
  blue: 'bg-sky-950/75 border-sky-400/40',
  violet: 'bg-violet-950/75 border-violet-400/40',
  slate: 'bg-slate-900/75 border-slate-500/40'
};

/** Text on coloured glass: the tone at reading strength. */
export const TONE_TEXT: Record<Tone, string> = {
  red: 'text-red-200',
  amber: 'text-amber-200',
  green: 'text-emerald-200',
  blue: 'text-sky-200',
  violet: 'text-violet-200',
  slate: 'text-slate-200'
};

/** The dot marking a tone where there is no room for anything else. */
export const TONE_DOT: Record<Tone, string> = {
  red: 'bg-red-400',
  amber: 'bg-amber-400',
  green: 'bg-emerald-400',
  blue: 'bg-sky-400',
  violet: 'bg-violet-400',
  slate: 'bg-slate-400'
};

/**
 * The fill for a pressable button. Kept translucent and a stop deeper than the
 * pills so a screen full of buttons does not glow.
 */
export const TONE_BUTTON: Record<Tone, string> = {
  red: 'bg-gradient-to-b from-red-600/90 to-red-700/90 hover:from-red-500 hover:to-red-600 border-2 border-red-400/40 text-white',
  amber:
    'bg-gradient-to-b from-amber-600/90 to-orange-700/90 hover:from-amber-500 hover:to-orange-600 border-2 border-amber-400/40 text-white',
  green:
    'bg-gradient-to-b from-emerald-600/90 to-emerald-700/90 hover:from-emerald-500 hover:to-emerald-600 border-2 border-emerald-400/40 text-white',
  blue: 'bg-gradient-to-b from-sky-600/90 to-blue-700/90 hover:from-sky-500 hover:to-blue-600 border-2 border-sky-400/40 text-white',
  violet:
    'bg-gradient-to-b from-violet-600/90 to-violet-700/90 hover:from-violet-500 hover:to-violet-600 border-2 border-violet-400/40 text-white',
  slate:
    'bg-gradient-to-b from-slate-700/90 to-slate-800/90 hover:from-slate-600 hover:to-slate-700 border-2 border-slate-500/50 text-white'
};

/** Body text on a coloured pill — readable, but a step back from the title. */
export const PILL_BODY = 'text-white/70';
