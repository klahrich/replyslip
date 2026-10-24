import { watch } from './watch.ts';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function has(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  if (command !== 'watch') {
    console.error('Usage: replyslip watch --url <origin> --key <watcher-key> [--interval ms] [--once]');
    process.exit(1);
  }
  const url = flag('--url') ?? process.env.REPLYSLIP_URL;
  const key = flag('--key') ?? process.env.REPLYSLIP_WATCHER_KEY;
  const intervalMs = Number(flag('--interval') ?? process.env.REPLYSLIP_POLL_INTERVAL_MS ?? '3000');
  if (!url || !key) {
    console.error('Set --url and --key, or REPLYSLIP_URL and REPLYSLIP_WATCHER_KEY.');
    process.exit(1);
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 500) {
    console.error('--interval must be at least 500 milliseconds.');
    process.exit(1);
  }
  await watch({ url, key, intervalMs, once: has('--once') });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
