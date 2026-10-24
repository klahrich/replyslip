import { spawn } from 'node:child_process';
import { WAKE_NOTICE } from '../../../lib/wake-notice.ts';

const PANE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export type DueWake = {
  id: string;
  pane: string;
  reason?: string;
  task_id?: string | null;
  agent_name?: string;
};

export function herdrArgs(pane: string): string[] {
  if (!PANE_NAME.test(pane)) {
    throw new Error(`Refusing pane name: ${pane}`);
  }
  return ['agent', 'prompt', pane, WAKE_NOTICE];
}

async function defaultSpawn(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

export async function watch(options: {
  url: string;
  key: string;
  intervalMs: number;
  once?: boolean;
  fetchImpl?: typeof fetch;
  spawnImpl?: (command: string, args: string[]) => Promise<number>;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const spawnImpl = options.spawnImpl ?? defaultSpawn;
  const base = options.url.replace(/\/$/, '');

  do {
    const response = await fetchImpl(`${base}/api/v1/watcher/poll`, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.key}` },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Watcher poll failed (${response.status}): ${text.slice(0, 200)}`);
    }
    const payload = (await response.json()) as { wakes?: DueWake[] };
    const acked: string[] = [];
    for (const wake of payload.wakes ?? []) {
      let args: string[];
      try {
        args = herdrArgs(wake.pane);
      } catch (err) {
        console.error(`[replyslip] skip wake ${wake.id}: ${(err as Error).message}`);
        continue;
      }
      const code = await spawnImpl('herdr', args);
      if (code === 0) acked.push(wake.id);
      else console.error(`[replyslip] herdr exited ${code} for wake ${wake.id}`);
    }
    if (acked.length > 0) {
      const ack = await fetchImpl(`${base}/api/v1/watcher/ack`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ wake_ids: acked }),
      });
      if (!ack.ok) {
        const text = await ack.text();
        throw new Error(`Watcher ack failed (${ack.status}): ${text.slice(0, 200)}`);
      }
    }
    if (options.once) return;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  } while (!options.once);
}
