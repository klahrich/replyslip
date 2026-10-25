// SPDX-License-Identifier: Apache-2.0

import { createHerdrDriver } from './herdr.ts';
import { createOrcaDriver, type OrcaExecFile } from './orca.ts';
import type { CommandRunner, NudgeDriver } from './types.ts';

export type DriverRegistry = {
  register(driver: NudgeDriver): void;
  get(id: string): NudgeDriver | undefined;
  list(): NudgeDriver[];
};

export function createRegistry(initial: NudgeDriver[] = []): DriverRegistry {
  const drivers = new Map<string, NudgeDriver>();
  const registry: DriverRegistry = {
    register(driver) {
      drivers.set(driver.id, driver);
    },
    get(id) {
      return drivers.get(id);
    },
    list() {
      return [...drivers.values()];
    },
  };
  for (const driver of initial) registry.register(driver);
  return registry;
}

function commandRunnerAsExec(run: CommandRunner): OrcaExecFile {
  return async (file, args) => {
    try {
      const result = await run(file, [...args]);
      return { ...result, timedOut: false };
    } catch (err) {
      const missing = typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'ENOENT';
      if (missing) return { code: 127, stdout: '', stderr: 'ENOENT', timedOut: false };
      throw err;
    }
  };
}

export function defaultRegistry(run?: CommandRunner): DriverRegistry {
  return createRegistry([
    createHerdrDriver(run ? { run } : undefined),
    createOrcaDriver(run ? { execFile: commandRunnerAsExec(run) } : undefined),
  ]);
}
