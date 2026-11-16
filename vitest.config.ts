import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Bound CPU-heavy whole-workflow cases on small CI runners. Assertions and individual time limits remain unchanged.
  test: { include: ['src/**/*.test.ts'], environment: 'node', maxWorkers: 2 },
});
