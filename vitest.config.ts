import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Mirrors the "@/*" path alias from tsconfig.json so modules under test can use
// it the same way application code does.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
