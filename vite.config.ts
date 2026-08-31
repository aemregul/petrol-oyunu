import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: false,
    host: true
  },
  test: {
    /**
     * Most of this suite drives the simulation for thousands of ticks, and a
     * dozen files of that run at once. Several sat just under Vitest's 5s
     * default and failed on machine contention rather than on anything in the
     * code — which is indistinguishable from a real break at a glance, and
     * exactly the noise that makes a green suite worth nothing. The slowest
     * honest test takes a couple of seconds alone; anything near this ceiling
     * is genuinely stuck.
     */
    testTimeout: 30_000
  }
});
