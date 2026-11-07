// SPDX-License-Identifier: Apache-2.0

import path from 'node:path';
import { SUPERVISE_INTERVAL_MS, SUPERVISE_LABEL, SUPERVISE_TASK_NAME } from './supervise-constants.ts';

export type SupportedPlatform = 'darwin' | 'linux' | 'win32';

export type PlannedCommand = {
  command: string;
  args: string[];
  /** A non-zero exit is ignored. Used for bootout of a unit that is not loaded yet. */
  optional?: boolean;
};

export type PlannedFile = {
  path: string;
  contents: string;
  mode: number;
};

export type InstallPlan = {
  platform: SupportedPlatform;
  files: PlannedFile[];
  preflight: PlannedCommand[];
  commands: PlannedCommand[];
  uninstallCommands: PlannedCommand[];
  notes: string[];
};

export type InstallPlanInput = {
  platform: NodeJS.Platform;
  home: string;
  nodePath: string;
  scriptPath: string;
  pathEnv: string;
  orcaBin?: string;
  uid?: number;
  /** Test override. Production uses the fixed label. */
  label?: string;
  taskName?: string;
  /** Linux unit file basename. Production uses replyslip-supervise. */
  unitName?: string;
  intervalMs?: number;
};

export function buildInstallPlan(input: InstallPlanInput): InstallPlan | { error: string } {
  const safe = validatePlanInputs(input);
  if ('error' in safe) return safe;
  if (input.platform === 'darwin') return darwinPlan(input);
  if (input.platform === 'linux') return linuxPlan(input);
  if (input.platform === 'win32') return windowsPlan(input);
  return {
    error: `ReplySlip supervision has no timer for this OS (${input.platform}). Supported: macOS LaunchAgent, Linux systemd --user, Windows Task Scheduler. The watcher was not started.`,
  };
}

function validatePlanInputs(input: InstallPlanInput): { ok: true } | { error: string } {
  for (const [label, value] of [
    ['Node path', input.nodePath],
    ['script path', input.scriptPath],
    ['PATH', input.pathEnv],
    ['home', input.home],
  ] as const) {
    if (!value || /[\r\n\0]/.test(value)) return { error: `${label} contains a newline or is empty. Supervision was not installed.` };
  }
  if (input.orcaBin && /[\r\n\0]/.test(input.orcaBin)) {
    return { error: 'REPLYSLIP_ORCA_BIN contains a newline. Supervision was not installed.' };
  }
  if (input.platform === 'win32') {
    for (const value of [input.nodePath, input.scriptPath, input.home, input.orcaBin ?? '']) {
      if (value.includes('"')) return { error: 'A path contains a double quote. Supervision was not installed.' };
    }
  }
  return { ok: true };
}

function intervalSec(input: InstallPlanInput): number {
  return Math.round((input.intervalMs ?? SUPERVISE_INTERVAL_MS) / 1000);
}

function darwinPlan(input: InstallPlanInput): InstallPlan | { error: string } {
  const uid = input.uid;
  if (typeof uid !== 'number' || !Number.isInteger(uid) || uid < 0) {
    return { error: 'macOS LaunchAgent install needs a numeric user id. Supervision was not installed.' };
  }
  const label = input.label ?? SUPERVISE_LABEL;
  const plistPath = path.join(input.home, 'Library', 'LaunchAgents', `${label}.plist`);
  const logPath = path.join(input.home, '.replyslip', 'supervise', 'timer.log');
  const domain = `gui/${uid}`;
  const target = `${domain}/${label}`;
  return {
    platform: 'darwin',
    files: [{ path: plistPath, mode: 0o600, contents: launchdPlist({ ...input, label, logPath }) }],
    preflight: [{ command: 'launchctl', args: ['version'] }],
    commands: [
      { command: 'launchctl', args: ['bootout', target], optional: true },
      { command: 'launchctl', args: ['bootstrap', domain, plistPath] },
      { command: 'launchctl', args: ['enable', target] },
    ],
    uninstallCommands: [
      { command: 'launchctl', args: ['bootout', target], optional: true },
      { command: 'launchctl', args: ['disable', target], optional: true },
    ],
    notes: [
      `macOS LaunchAgent ${label} ticks every ${intervalSec(input)} seconds in the logged-in GUI session (${domain}).`,
      'It does not use KeepAlive. Logging out unloads the agent. The next login loads it again. That is not a deliberate stop.',
      'launchctl must be able to bootstrap this user domain. A failure is reported and is not treated as installed.',
    ],
  };
}

function linuxPlan(input: InstallPlanInput): InstallPlan {
  const label = input.label ?? SUPERVISE_LABEL;
  const unit = input.unitName ?? 'replyslip-supervise';
  const dir = path.join(input.home, '.config', 'systemd', 'user');
  const seconds = intervalSec(input);
  return {
    platform: 'linux',
    files: [
      { path: path.join(dir, `${unit}.service`), mode: 0o600, contents: systemdService(input) },
      { path: path.join(dir, `${unit}.timer`), mode: 0o600, contents: systemdTimer(unit, seconds) },
    ],
    preflight: [{ command: 'systemctl', args: ['--user', 'show-environment'] }],
    commands: [
      { command: 'systemctl', args: ['--user', 'daemon-reload'] },
      { command: 'systemctl', args: ['--user', 'enable', '--now', `${unit}.timer`] },
    ],
    uninstallCommands: [
      { command: 'systemctl', args: ['--user', 'disable', '--now', `${unit}.timer`], optional: true },
      { command: 'systemctl', args: ['--user', 'daemon-reload'], optional: true },
    ],
    notes: [
      `Linux systemd --user timer ${label} runs about every ${seconds} seconds, with AccuracySec=15s, while this user session is up.`,
      'Linger is not enabled. After logout the timer stops. The next login starts it again. That is not a deliberate stop.',
      'If systemctl --user cannot reach a session bus, install stops and reports that error. Nothing is marked as a deliberate stop.',
    ],
  };
}

function windowsPlan(input: InstallPlanInput): InstallPlan {
  const taskName = input.taskName ?? SUPERVISE_TASK_NAME;
  const minutes = Math.max(1, Math.round(intervalSec(input) / 60));
  const cmdPath = path.join(input.home, '.replyslip', 'supervise', 'tick.cmd');
  return {
    platform: 'win32',
    files: [{ path: cmdPath, mode: 0o600, contents: windowsCmd(input) }],
    preflight: [{ command: 'schtasks', args: ['/?'] }],
    commands: [
      {
        command: 'schtasks',
        args: ['/Create', '/F', '/TN', taskName, '/SC', 'MINUTE', '/MO', String(minutes), '/RL', 'LIMITED', '/IT', '/TR', cmdPath],
      },
    ],
    uninstallCommands: [{ command: 'schtasks', args: ['/Delete', '/F', '/TN', taskName], optional: true }],
    notes: [
      `Windows Task Scheduler task "${taskName}" runs every ${minutes} minute(s) with /IT and /RL LIMITED.`,
      '/IT means the task runs only while this user is logged on. Logoff is not a deliberate stop. The next logon resumes the schedule.',
      'schtasks does not deliver POSIX signals. Stopping a watcher uses TerminateProcess after the stop file is written.',
      'The task runs tick.cmd so paths with spaces are quoted inside the cmd file, not inside /TR.',
      'If schtasks is missing or returns an error, install stops and reports that error.',
    ],
  };
}

export function launchdPlist(input: InstallPlanInput & { label: string; logPath: string }): string {
  const env: [string, string][] = [
    ['PATH', input.pathEnv],
    ['HOME', input.home],
    ['REPLYSLIP_SUPERVISED', '1'],
  ];
  if (input.orcaBin) env.push(['REPLYSLIP_ORCA_BIN', input.orcaBin]);
  const args = [input.nodePath, input.scriptPath, 'supervise', '--once'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(input.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${xml(arg)}</string>`).join('\n')}
  </array>
  <key>StartInterval</key>
  <integer>${intervalSec(input)}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
${env.map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`).join('\n')}
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(input.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(input.logPath)}</string>
</dict>
</plist>
`;
}

export function systemdService(input: InstallPlanInput): string {
  const exec = ['ExecStart=' + systemdArg(input.nodePath), systemdArg(input.scriptPath), 'supervise', '--once'].join(' ');
  const lines = [
    '[Unit]',
    'Description=ReplySlip watcher supervision',
    '',
    '[Service]',
    'Type=oneshot',
    exec,
    `Environment=PATH=${systemdEnv(input.pathEnv)}`,
    `Environment=HOME=${systemdEnv(input.home)}`,
    'Environment=REPLYSLIP_SUPERVISED=1',
  ];
  if (input.orcaBin) lines.push(`Environment=REPLYSLIP_ORCA_BIN=${systemdEnv(input.orcaBin)}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function systemdTimer(unit: string, seconds: number): string {
  return `[Unit]
Description=ReplySlip watcher supervision tick

[Timer]
OnStartupSec=15s
OnUnitActiveSec=${seconds}s
AccuracySec=15s
Persistent=true
Unit=${unit}.service

[Install]
WantedBy=timers.target
`;
}

/** In a `.cmd` file, `%PATH%` expands even inside quotes. `%%` is the literal percent. */
export function cmdPercent(value: string): string {
  return value.replace(/%/g, '%%');
}

export function windowsCmd(input: InstallPlanInput): string {
  const lines = [
    '@echo off',
    'setlocal',
    `set "PATH=${cmdPercent(input.pathEnv)}"`,
    `set "HOME=${cmdPercent(input.home)}"`,
    `set "USERPROFILE=${cmdPercent(input.home)}"`,
    'set "REPLYSLIP_SUPERVISED=1"',
  ];
  if (input.orcaBin) lines.push(`set "REPLYSLIP_ORCA_BIN=${cmdPercent(input.orcaBin)}"`);
  lines.push(`"${cmdPercent(input.nodePath)}" "${cmdPercent(input.scriptPath)}" supervise --once`);
  lines.push('');
  return lines.join('\r\n');
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function systemdArg(value: string): string {
  if (/[\s"]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}

function systemdEnv(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function uninstallFilePaths(input: InstallPlanInput): string[] {
  const plan = buildInstallPlan(input);
  if ('error' in plan) return [];
  return plan.files.map((file) => file.path);
}
