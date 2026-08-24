/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
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
        'fade-in': 'fadeIn 0.25s ease-out forwards'
      },
      keyframes: {
        floatUp: {
          '0%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(-30px) scale(1.1)' }
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        }
      }
    },
  },
  plugins: [],
}
