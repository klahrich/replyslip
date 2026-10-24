import { WAKE_NOTICE } from '../../../lib/wake-notice.ts';
import { defaultRegistry, type DriverRegistry } from './drivers/registry.ts';
import type { CommandRunner, DriverCheck } from './drivers/types.ts';

export type DueWake = {
  id: string;
  driver?: string;
  target?: string;
  pane?: string;
  reason?: string;
  task_id?: string | null;
  agent_name?: string;
};

export type WakeNudge = { driver: string; target: string };

/** Prefer driver/target. `pane` alone is the deprecated herdr alias. */
export function resolveWake(wake: DueWake): WakeNudge | null {
  const driver = wake.driver?.trim() || (wake.pane ? 'herdr' : '');
  const target = wake.target?.trim() || wake.pane?.trim() || '';
  if (!driver || !target) return null;
  return { driver, target };
}

export async function checkDrivers(
  registry: DriverRegistry,
  log: (message: string) => void = console.error,
): Promise<Map<string, DriverCheck>> {
  const checks = new Map<string, DriverCheck>();
  for (const driver of registry.list()) {
    const result = await driver.check();
    checks.set(driver.id, result);
    log(
      result.ok
        ? `[replyslip] driver ${driver.id}: ok${result.version ? ` (${result.version})` : ''}`
        : `[replyslip] driver ${driver.id}: ${result.message ?? 'check failed'}`,
    );
  }
  return checks;
}

export async function nudgeWakes(options: {
  wakes: DueWake[];
  registry: DriverRegistry;
  checks: Map<string, DriverCheck>;
  warned: Set<string>;
  log?: (message: string) => void;
}): Promise<string[]> {
  const log = options.log ?? console.error;
  const acked: string[] = [];
  for (const wake of options.wakes) {
    const resolved = resolveWake(wake);
    if (!resolved) {
      warnOnce(options.warned, wake.id, 'missing', log, `[replyslip] wake ${wake.id}: missing driver and target; not acked`);
      continue;
    }
    const key = `${wake.id}:${resolved.driver}`;
    const driver = options.registry.get(resolved.driver);
    if (!driver) {
      warnOnce(
        options.warned,
        key,
        'unknown',
        log,
        `[replyslip] wake ${wake.id} driver ${resolved.driver}: unknown driver; not acked`,
      );
      continue;
    }
    const check = options.checks.get(driver.id);
    if (!check?.ok) {
      warnOnce(
        options.warned,
        key,
        'check',
        log,
        `[replyslip] wake ${wake.id} driver ${driver.id}: ${check?.message ?? 'driver check failed'}; not acked`,
      );
      continue;
    }
    const result = await driver.nudge(resolved.target, WAKE_NOTICE);
    if (result.ok) {
      acked.push(wake.id);
      continue;
    }
    warnOnce(
      options.warned,
      key,
      'nudge',
      log,
      `[replyslip] wake ${wake.id} driver ${driver.id}: ${result.error ?? 'nudge failed'}; not acked`,
    );
  }
  return acked;
}

function warnOnce(warned: Set<string>, key: string, kind: string, log: (message: string) => void, message: string): void {
  const slot = `${key}:${kind}`;
  if (warned.has(slot)) return;
  warned.add(slot);
  log(message);
}

export async function watch(options: {
  url: string;
  key: string;
  intervalMs: number;
  once?: boolean;
  fetchImpl?: typeof fetch;
  registry?: DriverRegistry;
  runCommand?: CommandRunner;
  log?: (message: string) => void;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? console.error;
  const registry = options.registry ?? defaultRegistry(options.runCommand);
  const base = options.url.replace(/\/$/, '');
  const checks = await checkDrivers(registry, log);
  const warned = new Set<string>();

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
    const acked = await nudgeWakes({
      wakes: payload.wakes ?? [],
      registry,
      checks,
      warned,
      log,
    });
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
