// SPDX-License-Identifier: Apache-2.0

export type DriverCheck = { ok: boolean; version?: string; message?: string };

export type NudgeResult = { ok: boolean; error?: string };

/** A local way to tap an agent. herdr and orca are the built-in drivers; others can be registered later. */
export interface NudgeDriver {
  id: string;
  check(): Promise<DriverCheck>;
  nudge(target: string, notice: string): Promise<NudgeResult>;
}

export type CommandResult = { code: number; stdout: string; stderr: string };

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;
