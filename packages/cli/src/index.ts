// SPDX-License-Identifier: Apache-2.0

import { runReplyslip } from './cli.ts';

runReplyslip(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
