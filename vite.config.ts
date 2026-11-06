import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';

export default defineConfig({
  // Själv-signerat HTTPS + lyssna på nätverket, så iPhone kan nå dev-servern (kamera/sensorer kräver HTTPS).
  // NO_SSL=1: ren http (till exempel localhost-test på desktop; localhost räknas som säker kontext).
  plugins: process.env.NO_SSL ? [] : [basicSsl()],
  server: { host: true, port: 5173 },
  // Byggtid, visas i AR-vyns HUD och loggen så att man ser att man har senaste versionen (iOS Safari cachar hårt).
  // I dev sätts den när servern (eller konfigurationen) startar.
  define: { __BUILD_ID__: JSON.stringify(new Date().toISOString().replace(/\.\d+Z$/, 'Z')) },
  // Relativ bas: fungerar på https://<user>.github.io/<repo>/ utan hårdkodat repo-namn.
  base: './',
  // MapLibres worker hittas inte om Vite förbundlar paketet i dev
  optimizeDeps: { exclude: ['maplibre-gl'] },
  // Vitest: släpp igenom CSS-filer som importeras med ?raw (designtokens testas som text)
  // Interaktionstestet i e2e/ körs separat (npm run test:ui) och ingår inte i `npm test`.
  test: { css: { include: [/\.css(\?raw)?$/] }, exclude: ['e2e/**', 'node_modules/**', 'dist/**'] } as never,
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        sensorTest: resolve(__dirname, 'sensor-test.html'),
        ar: resolve(__dirname, 'ar.html'),
        map: resolve(__dirname, 'map.html'),
      },
    },
  },
});
