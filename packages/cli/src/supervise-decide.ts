// SPDX-License-Identifier: Apache-2.0

import {
  MISSING_PROGRESS_TICKS,
  RESTART_CAP,
  RESTART_WINDOW_MS,
  SLEEP_GAP_MS,
  STARTUP_GRACE_MS,
  SUPERVISE_INTERVAL_MS,
  WEDGE_GRACE_MS,
  type HoldReason,
} from './supervise-constants.ts';
import type { AgentSuperviseState, WatcherProgress } from './watcher-progress.ts';

export type LockIdentity = { pid: number; token: string; startedAt: string };

export type SuperviseDecision =
  | { action: 'skip'; reason: 'stopped' | 'hold' | 'restart-cap' | 'healthy' | 'defer-wedge' | 'await-progress' | 'starting'; hold?: HoldReason }
  | { action: 'start'; reason: 'dead' | 'missing' }
  | { action: 'kill-lock'; reason: 'wedge' | 'stale-progress'; pid: number; token: string; startedAt: string }
  | { action: 'kill-spawn'; reason: 'startup-hang'; pid: number; spawnedAt: string };

export type DecideInput = {
  now: number;
  stopped: boolean;
  hold: HoldReason | null;
  lockLive: boolean;
  lock: LockIdentity | null;
  progress: WatcherProgress | null;
  /** True when lastSpawnPid is still alive. Ignored when there is no spawn pid. */
  spawnAlive: boolean;
  state: AgentSuperviseState;
  intervalMs?: number;
  sleepGapMs?: number;
  wedgeGraceMs?: number;
  restartCap?: number;
  restartWindowMs?: number;
  missingTicks?: number;
  startupGraceMs?: number;
};

function recentRestarts(restarts: string[], now: number, windowMs: number): string[] {
  return restarts.filter((iso) => {
    const at = Date.parse(iso);
    return !Number.isNaN(at) && now - at < windowMs;
  });
}

function gapMs(now: number, lastCheckAt: string | null): number | null {
  if (!lastCheckAt) return null;
  const at = Date.parse(lastCheckAt);
  if (Number.isNaN(at)) return null;
  return now - at;
}

function progressMatches(progress: WatcherProgress | null, lock: LockIdentity | null): progress is WatcherProgress {
  return !!progress && !!lock && progress.pid === lock.pid && progress.token === lock.token && progress.startedAt === lock.startedAt;
}

/**
 * One supervisor tick. A fresh phase deadline is healthy, including a network backoff sleep.
 * A large gap since the previous tick defers a kill of a still-live pid. It does not defer a restart of a dead pid.
 * The caller records a restart only after it actually spawns.
 */
export function decideSupervision(input: DecideInput): { decision: SuperviseDecision; state: AgentSuperviseState } {
  const sleepGap = input.sleepGapMs ?? SLEEP_GAP_MS;
  const grace = input.wedgeGraceMs ?? WEDGE_GRACE_MS;
  const cap = input.restartCap ?? RESTART_CAP;
  const windowMs = input.restartWindowMs ?? RESTART_WINDOW_MS;
  const missingTicks = input.missingTicks ?? MISSING_PROGRESS_TICKS;
  const startupGrace = input.startupGraceMs ?? STARTUP_GRACE_MS;
  const gap = gapMs(input.now, input.state.lastCheckAt);
  const slept = gap !== null && gap > sleepGap;
  const restarts = recentRestarts(input.state.restarts, input.now, windowMs);
  const capped = restarts.length >= cap;
  const state: AgentSuperviseState = {
    ...input.state,
    restarts,
    lastCheckAt: new Date(input.now).toISOString(),
  };

  if (input.stopped) {
    return { decision: { action: 'skip', reason: 'stopped' }, state: { ...state, wedgeDeferred: false, missingProgressStreak: 0 } };
  }
  if (input.hold) {
    return { decision: { action: 'skip', reason: 'hold', hold: input.hold }, state };
  }

  if (!input.lockLive) {
    const spawnedAt = state.lastSpawnAt ? Date.parse(state.lastSpawnAt) : Number.NaN;
    const spawnAge = Number.isNaN(spawnedAt) ? null : input.now - spawnedAt;
    if (state.lastSpawnPid && input.spawnAlive && spawnAge !== null && spawnAge <= startupGrace) {
      return { decision: { action: 'skip', reason: 'starting' }, state };
    }
    if (state.lastSpawnPid && input.spawnAlive && spawnAge !== null && spawnAge > startupGrace) {
      if (slept) return { decision: { action: 'skip', reason: 'defer-wedge' }, state: { ...state, wedgeDeferred: true } };
      if (capped) return { decision: { action: 'skip', reason: 'restart-cap' }, state };
      return {
        decision: { action: 'kill-spawn', reason: 'startup-hang', pid: state.lastSpawnPid, spawnedAt: state.lastSpawnAt! },
        state,
      };
    }
    if (capped) return { decision: { action: 'skip', reason: 'restart-cap' }, state };
    return {
      decision: { action: 'start', reason: state.lastSpawnPid ? 'dead' : 'missing' },
      state: { ...state, wedgeDeferred: false, missingProgressStreak: 0 },
    };
  }

  const lock = input.lock;
  if (!lock) {
    if (capped) return { decision: { action: 'skip', reason: 'restart-cap' }, state };
    return { decision: { action: 'start', reason: 'missing' }, state };
  }

  if (!progressMatches(input.progress, lock)) {
    if (slept) {
      return { decision: { action: 'skip', reason: 'defer-wedge' }, state: { ...state, wedgeDeferred: true, missingProgressStreak: 0 } };
    }
    const streak = state.missingProgressStreak + 1;
    if (streak < missingTicks) {
      return { decision: { action: 'skip', reason: 'await-progress' }, state: { ...state, missingProgressStreak: streak, wedgeDeferred: false } };
    }
    if (capped) return { decision: { action: 'skip', reason: 'restart-cap' }, state: { ...state, missingProgressStreak: streak } };
    return {
      decision: { action: 'kill-lock', reason: 'stale-progress', pid: lock.pid, token: lock.token, startedAt: lock.startedAt },
      state: { ...state, wedgeDeferred: false, missingProgressStreak: 0 },
    };
  }

  const deadline = Date.parse(input.progress.deadlineAt);
  const overdue = !Number.isNaN(deadline) && input.now > deadline + grace;
  if (!overdue) {
    return { decision: { action: 'skip', reason: 'healthy' }, state: { ...state, wedgeDeferred: false, missingProgressStreak: 0 } };
  }
  if (slept) {
    return { decision: { action: 'skip', reason: 'defer-wedge' }, state: { ...state, wedgeDeferred: true, missingProgressStreak: 0 } };
  }
  if (capped) return { decision: { action: 'skip', reason: 'restart-cap' }, state };
  return {
    decision: { action: 'kill-lock', reason: 'wedge', pid: lock.pid, token: lock.token, startedAt: lock.startedAt },
    state: { ...state, wedgeDeferred: false, missingProgressStreak: 0 },
  };
}

export const SUPERVISE_TICK_MS = SUPERVISE_INTERVAL_MS;
