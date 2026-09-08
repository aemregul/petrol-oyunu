/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // The fonts index.html loads. `sans` carries the interface, `mono` every
      // number the player reads off a meter, and `display` matches the signage
      // already drawn on the canvas (PylonSign, FasciaSign, PriceTotem).
      // Karton (Emre, 2026-09-07): the interface is card and paper, so the
      // faces are a round, warm body and a poster-weight display. The
      // canvas signage keeps Chakra Petch; `mono` stays for meters.
      fontFamily: {
        sans: ['Nunito', 'Rubik', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        // Baloo 2 (Emre's pick, 2026-09-07). Lilita One had no İ, ş, ğ or ı
        // and those fell back to another face mid-word.
        display: ['"Baloo 2"', 'Nunito', 'system-ui', 'sans-serif'],
        sign: ['"Chakra Petch"', 'Rubik', 'system-ui', 'sans-serif']
      },
      colors: {
        // The Karton palette. `paper` is a card's face, `board` the cream
        // ground behind rows and bars, `ink` every line and every word.
        // Read through CSS variables (index.css :root) so the dark palette
        // can swap them with one attribute; the `<alpha-value>` slot keeps
        // border-mute/60 and friends working.
        paper: 'rgb(var(--k-paper) / <alpha-value>)',
        board: 'rgb(var(--k-board) / <alpha-value>)',
        card: 'rgb(var(--k-card) / <alpha-value>)',
        ink: 'rgb(var(--k-ink) / <alpha-value>)',
        mute: 'rgb(var(--k-mute) / <alpha-value>)',
        // The sticker colours go through variables too. These are the
        // colours words and icons are drawn in; the fills for bands and
        // buttons are the separate backgroundColor set below, so after dark
        // a band can go deep while a figure written in the same red stays
        // readable on a dark card.
        kred: { DEFAULT: 'rgb(var(--k-red) / <alpha-value>)', dark: 'rgb(var(--k-red-d) / <alpha-value>)' },
        kgrn: { DEFAULT: 'rgb(var(--k-grn) / <alpha-value>)', dark: 'rgb(var(--k-grn-d) / <alpha-value>)' },
        kblu: { DEFAULT: 'rgb(var(--k-blu) / <alpha-value>)', dark: 'rgb(var(--k-blu-d) / <alpha-value>)' },
        kyel: { DEFAULT: 'rgb(var(--k-yel) / <alpha-value>)', dark: 'rgb(var(--k-yel-d) / <alpha-value>)' },
        kvio: { DEFAULT: 'rgb(var(--k-vio) / <alpha-value>)', dark: 'rgb(var(--k-vio-d) / <alpha-value>)' },
        // White is a token as well: the words on a coloured band are white
        // by day and a soft grey after dark, so nothing on screen glares.
        white: 'rgb(var(--k-white) / <alpha-value>)',
        gasoline: {
          light: '#4ade80',
          DEFAULT: '#22c55e',
          dark: '#16a34a'
        },
        diesel: {
          light: '#fb923c',
          DEFAULT: '#f97316',
          dark: '#ea580c'
        },
        lpg: {
          light: '#60a5fa',
          DEFAULT: '#3b82f6',
          dark: '#2563eb'
        },
        highway: {
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          600: '#475569',
          gold: '#f59e0b',
          amber: '#d97706'
        }
      },
      // The line round a card is its own token, apart from the ink the words
      // are written in: by day both are the same brown, after dark the words
      // go cream while the lines and shadows go black — otherwise a dark
      // card wears a light frame and reads as the light design with the
      // lights off (Emre, 2026-09-08).
      borderColor: {
        ink: 'rgb(var(--k-line) / <alpha-value>)'
      },
      // The fills. Same as the text colours by day; deep, desaturated after
      // dark, so a header band or a button is a dark slab of its hue rather
      // than a bright sticker on a dark card.
      backgroundColor: {
        kred: { DEFAULT: 'rgb(var(--k-red-bg) / <alpha-value>)', dark: 'rgb(var(--k-red-bg-d) / <alpha-value>)' },
        kgrn: { DEFAULT: 'rgb(var(--k-grn-bg) / <alpha-value>)', dark: 'rgb(var(--k-grn-bg-d) / <alpha-value>)' },
        kblu: { DEFAULT: 'rgb(var(--k-blu-bg) / <alpha-value>)', dark: 'rgb(var(--k-blu-bg-d) / <alpha-value>)' },
        kyel: { DEFAULT: 'rgb(var(--k-yel-bg) / <alpha-value>)', dark: 'rgb(var(--k-yel-bg-d) / <alpha-value>)' },
        kvio: { DEFAULT: 'rgb(var(--k-vio-bg) / <alpha-value>)', dark: 'rgb(var(--k-vio-bg-d) / <alpha-value>)' }
      },
      boxShadow: {
        /* The Karton card's hard offset, in either palette. */
        k: '0.2rem 0.2rem 0 rgb(var(--k-shadow))'
      },
      animation: {
        'pulse-subtle': 'pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float-up': 'floatUp 1.2s ease-out forwards',
        'fade-in': 'fadeIn 0.25s ease-out forwards',
        'fade-out': 'fadeOut 0.6s ease-in forwards',
        breathe: 'breathe 2.2s ease-in-out infinite',
        'toast-in': 'toastIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'toast-out': 'toastOut 0.9s cubic-bezier(0.4, 0, 0.6, 1) forwards'
      },
      keyframes: {
        floatUp: {
          '0%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(-30px) scale(1.1)' }
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        },
        fadeOut: {
          '0%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(-6px) scale(0.95)' }
        },
        // Just enough swell to catch the eye at the edge of vision. Anything
        // bigger reads as a wobble and starts fighting the game for attention.
        breathe: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.025)' }
        },
        // Toasts arrive from the edge they live on rather than growing out of
        // nothing, so a new one reads as "something came in" at the corner of
        // the eye without pulling it off the forecourt.
        toastIn: {
          '0%': { opacity: '0', transform: 'translateX(-14px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateX(0) scale(1)' }
        },
        // Leaving takes far longer than arriving: a toast nobody asked to
        // close should dissolve slowly enough that a late glance still catches
        // it, rather than blinking out mid-sentence.
        toastOut: {
          '0%': { opacity: '1', transform: 'translateX(0) scale(1)' },
          '35%': { opacity: '0.7', transform: 'translateX(-4px) scale(0.995)' },
          '100%': { opacity: '0', transform: 'translateX(-22px) scale(0.96)' }
        }
      }
    },
  },
  plugins: [],
}
