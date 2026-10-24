import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const outfile = path.join(root, 'packages/cli/replyslip.mjs');
const check = process.argv.includes('--check');

const result = await build({
  entryPoints: [path.join(root, 'packages/cli/src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  banner: { js: '#!/usr/bin/env node\n// SPDX-License-Identifier: Apache-2.0' },
  legalComments: 'none',
  logLevel: 'silent',
  write: false,
});

const output = result.outputFiles?.[0]?.text;
if (!output) {
  console.error('esbuild produced no output.');
  process.exit(1);
}
const body = output.endsWith('\n') ? output : `${output}\n`;

if (check) {
  const current = readFileSync(outfile, 'utf8');
  if (current !== body) {
    console.error('packages/cli/replyslip.mjs is stale. Run: node scripts/bundle-replyslip.mjs');
    process.exit(1);
  }
  process.exit(0);
}

writeFileSync(outfile, body, { mode: 0o644 });
const digest = createHash('sha256').update(body).digest('hex');
console.log(`${digest}  replyslip.mjs`);
