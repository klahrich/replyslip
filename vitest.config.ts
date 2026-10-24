import path from 'node:path';
import { defineConfig } from 'vitest/config';

const TEST_DATABASE_URL = 'postgres://replyslip:replyslip@127.0.0.1:5432/replyslip_test';
// Fixture only. It decrypts data written by the test suite, not production secrets.
const TEST_ENCRYPTION_KEY = 'mhcGYy/QQSaUWHD/IIlKtlSADRzkjC+s70BxMUduK2w=';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      CRON_SECRET: 'test-cron-secret',
      REPLYSLIP_ALLOW_PRIVATE_WEBHOOKS: '1',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
