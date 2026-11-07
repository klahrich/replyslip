// SPDX-License-Identifier: Apache-2.0

/** OS timer cadence. The watcher itself keeps polling every 3 seconds. */
export const SUPERVISE_INTERVAL_MS = 120_000;

/**
 * Extra time past a phase deadline before a live process is treated as wedged.
 * Network backoff sets its own deadline, so this does not apply while a retry sleep is still in budget.
 */
export const WEDGE_GRACE_MS = 30_000;

/**
 * Only a gap this long between supervisor ticks is treated as a possible sleep or offline period.
 * A merely late tick (for example 150 seconds on a 120 second timer) still enforces a wedge.
 */
export const SLEEP_GAP_MS = SUPERVISE_INTERVAL_MS * 3;

export const RESTART_CAP = 5;
export const RESTART_WINDOW_MS = 60 * 60 * 1000;

/** Live lock with no matching progress must be seen this many on-time ticks before it is replaced. */
export const MISSING_PROGRESS_TICKS = 2;

/** A process whose OS start time is this far after the lock's startedAt is not the process that wrote the lock. */
export const PID_START_SKEW_MS = 30_000;

/** Bound on one herdr invocation. A hung spawn must not sit inside the poll loop forever. */
export const HERDR_COMMAND_TIMEOUT_MS = 45_000;

/**
 * One nudge, including an Orca list plus a send and a single retry.
 * The watcher refreshes this deadline at each wake, so a healthy series of nudges does not look stuck.
 */
export const NUDGE_BUDGET_MS = 90_000;

/** After a spawn, wait this long before treating a still-unlocked pid as a startup hang. */
export const STARTUP_GRACE_MS = 60_000;

export const SUPERVISE_LABEL = 'tech.valetto.replyslip-supervise';
export const SUPERVISE_TASK_NAME = 'ReplySlip Supervise';

export type ProgressPhase = 'poll' | 'nudge' | 'ack' | 'sleep';

export type HoldReason = 'auth' | 'legacy' | 'config';
