export type DriverCheck = { ok: boolean; version?: string; message?: string };

export type NudgeResult = { ok: boolean; error?: string };

/** A local way to tap an agent. herdr is the built-in driver; others can be registered later. */
export interface NudgeDriver {
  id: string;
  check(): Promise<DriverCheck>;
  nudge(target: string, notice: string): Promise<NudgeResult>;
}

export type CommandResult = { code: number; stdout: string; stderr: string };

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;
