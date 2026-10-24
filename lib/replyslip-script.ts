import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function replyslipScriptPath(): string {
  return path.join(process.cwd(), 'packages/cli/replyslip.mjs');
}

export function replyslipScriptBytes(): Buffer {
  return readFileSync(replyslipScriptPath());
}

export function replyslipScriptSha256(): string {
  return createHash('sha256').update(replyslipScriptBytes()).digest('hex');
}

/** Line accepted by `sha256sum -c` and `shasum -a 256 -c`. */
export function replyslipScriptSha256Line(): string {
  return `${replyslipScriptSha256()}  replyslip.mjs\n`;
}
