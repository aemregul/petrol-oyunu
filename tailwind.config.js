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
      fontFamily: {
        sans: ['Rubik', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        display: ['"Chakra Petch"', 'Rubik', 'system-ui', 'sans-serif']
      },
      colors: {
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
