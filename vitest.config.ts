import path from 'node:path';
import { defineConfig } from 'vitest/config';

const TEST_DATABASE_URL = 'postgres://replyslip:replyslip@127.0.0.1:5432/replyslip_test';
// Fixtures only. They decrypt data and sign unsubscribe links in the test suite, not production secrets.
const TEST_ENCRYPTION_KEY = 'mhcGYy/QQSaUWHD/IIlKtlSADRzkjC+s70BxMUduK2w=';
const TEST_UNSUBSCRIBE_SECRET = 'test-unsubscribe-secret';

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
      UNSUBSCRIBE_SECRET: TEST_UNSUBSCRIBE_SECRET,
      REPLYSLIP_ALLOW_PRIVATE_WEBHOOKS: '1',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
