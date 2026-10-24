import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Integration test helpers parse loosely typed JSON responses.
    files: ['tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  globalIgnores(['.next/**', 'node_modules/**', 'next-env.d.ts', 'drizzle/**', 'packages/cli/replyslip.mjs']),
]);
