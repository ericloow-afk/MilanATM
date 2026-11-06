import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';

export default defineConfig({
  // Själv-signerat HTTPS + lyssna på nätverket, så iPhone kan nå dev-servern (kamera/sensorer kräver HTTPS).
  plugins: [basicSsl()],
  server: { host: true, port: 5173 },
  // Relativ bas: fungerar på https://<user>.github.io/<repo>/ utan hårdkodat repo-namn.
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        sensorTest: resolve(__dirname, 'sensor-test.html'),
      },
    },
  },
});
