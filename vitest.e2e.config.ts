import { defineConfig } from 'vitest/config';

// Interaktionstest i riktig webbläsare (npm run test:ui). Körs inte av `npm test`.
export default defineConfig({
  test: {
    include: ['e2e/**/*.test.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
