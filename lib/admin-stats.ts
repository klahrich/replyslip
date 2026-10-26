import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { safeEqualString } from './crypto';
import { excludedWorkspaceIds } from './first-agent-alert';

const DAY_MS = 86_400_000;
const NONE_SOURCE = 'none';

export type UsageDay = {
  date: string;
  signups: number;
  workspaces: number;
  agents_registered: number;
  active_agents: number;
  tasks_created: number;
  tasks_completed: number;
  tasks_failed: number;
  messages_sent: number;
  signups_by_source: Record<string, number>;
};

export type UsageStats = {
  days: number;
  from: string;
  to: string;
  totals: Omit<UsageDay, 'date'>;
  series: UsageDay[];
  /** All-time count of users outside excluded workspaces who asked for agent sharing. Not limited to the window. */
  wants_sharing: number;
  /** Subset of `wants_sharing` whose workspace has ever registered an agent, revoked or not. All-time. */
  wants_sharing_with_agent: number;
};

export type StatsAuth = 'off' | 'unauthorized' | 'ok';

/** Unset key hides the route. A present key is compared in constant time. */
export function statsAuthDecision(authorization: string | null, envKey: string | undefined): StatsAuth {
  const expected = envKey?.trim() ?? '';
  if (!expected) return 'off';
  const header = authorization ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token || !safeEqualString(token, expected)) return 'unauthorized';
  return 'ok';
}

/** Null when `days` is not an integer from 1 to 90. Empty means the default of 14. */
export function parseStatsDays(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return 14;
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const days = Number(text);
  if (days < 1 || days > 90) return null;
  return days;
}

export function utcDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function notExcluded(column: SQL): SQL {
  const ids = excludedWorkspaceIds();
  if (ids.length === 0) return sql`true`;
  return sql`${column} not in (${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

function dayOf(column: SQL): SQL {
  return sql`to_char(${column} at time zone 'utc', 'YYYY-MM-DD')`;
}

type DayCount = { day: string; n: number | string };
type SourceCount = { day: string; source: string; n: number | string };

async function rowsOf<T extends Record<string, unknown>>(statement: SQL): Promise<T[]> {
  const rows = await getDb().execute<T>(statement);
  return [...rows] as T[];
}

function countMap(rows: DayCount[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.day, (map.get(row.day) ?? 0) + Number(row.n));
  return map;
}

function sortedSources(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...counts.entries()].filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)));
}

export async function loadUsageStats(options: { days: number; now?: Date }): Promise<UsageStats> {
  const end = startOfUtcDay(options.now ?? new Date());
  const start = new Date(end.getTime() - (options.days - 1) * DAY_MS);
  const until = new Date(end.getTime() + DAY_MS);
  const startIso = start.toISOString();
  const untilIso = until.toISOString();
  const userWorkspace = sql`(workspace_id is null or ${notExcluded(sql`workspace_id`)})`;
  const inWindow = (column: SQL) => sql`${column} >= ${startIso}::timestamptz and ${column} < ${untilIso}::timestamptz`;

  const [signupRows, workspaceRows, agentRows, activeRows, activeTotalRows, createdRows, completedRows, failedRows, messageRows, wantsSharingRows, wantsSharingAgentRows] =
    await Promise.all([
      rowsOf<SourceCount>(sql`
        select ${dayOf(sql`created_at`)} as day,
               coalesce(nullif(btrim(signup_source), ''), ${NONE_SOURCE}) as source,
               count(*)::int as n
        from users
        where ${inWindow(sql`created_at`)} and ${userWorkspace}
        group by 1, 2
      `),
      rowsOf<DayCount>(sql`
        select ${dayOf(sql`created_at`)} as day, count(*)::int as n
        from workspaces
        where ${inWindow(sql`created_at`)} and ${notExcluded(sql`id`)}
        group by 1
      `),
      rowsOf<DayCount>(sql`
        select ${dayOf(sql`created_at`)} as day, count(*)::int as n
        from agents
        where ${inWindow(sql`created_at`)} and ${notExcluded(sql`workspace_id`)}
        group by 1
      `),
      rowsOf<DayCount>(sql`
        select day, count(distinct agent_id)::int as n
        from (
          select ${dayOf(sql`created_at`)} as day, from_agent_id as agent_id, workspace_id from tasks where ${inWindow(sql`created_at`)}
          union all
          select ${dayOf(sql`created_at`)}, to_agent_id, workspace_id from tasks where ${inWindow(sql`created_at`)}
          union all
          select ${dayOf(sql`created_at`)}, from_agent_id, workspace_id from messages where ${inWindow(sql`created_at`)}
          union all
          select ${dayOf(sql`created_at`)}, to_agent_id, workspace_id from messages where ${inWindow(sql`created_at`)}
        ) activity
        where ${notExcluded(sql`workspace_id`)}
        group by day
      `),
      rowsOf<{ n: number | string }>(sql`
        select count(distinct agent_id)::int as n
        from (
          select from_agent_id as agent_id, workspace_id from tasks where ${inWindow(sql`created_at`)}
          union all
          select to_agent_id, workspace_id from tasks where ${inWindow(sql`created_at`)}
          union all
          select from_agent_id, workspace_id from messages where ${inWindow(sql`created_at`)}
          union all
          select to_agent_id, workspace_id from messages where ${inWindow(sql`created_at`)}
        ) activity
        where ${notExcluded(sql`workspace_id`)}
      `),
      rowsOf<DayCount>(sql`
        select ${dayOf(sql`created_at`)} as day, count(*)::int as n
        from tasks
        where ${inWindow(sql`created_at`)} and ${notExcluded(sql`workspace_id`)}
        group by 1
      `),
      rowsOf<DayCount>(sql`
        select ${dayOf(sql`completed_at`)} as day, count(*)::int as n
        from tasks
        where status = 'done' and ${inWindow(sql`completed_at`)} and ${notExcluded(sql`workspace_id`)}
        group by 1
      `),
      rowsOf<DayCount>(sql`
        select ${dayOf(sql`completed_at`)} as day, count(*)::int as n
        from tasks
        where status = 'failed' and ${inWindow(sql`completed_at`)} and ${notExcluded(sql`workspace_id`)}
        group by 1
      `),
      rowsOf<DayCount>(sql`
        select ${dayOf(sql`created_at`)} as day, count(*)::int as n
        from messages
        where ${inWindow(sql`created_at`)} and ${notExcluded(sql`workspace_id`)}
        group by 1
      `),
      rowsOf<{ n: number | string }>(sql`
        select count(*)::int as n
        from users
        where wants_sharing and ${userWorkspace}
      `),
      rowsOf<{ n: number | string }>(sql`
        select count(*)::int as n
        from users u
        where u.wants_sharing
          and ${notExcluded(sql`u.workspace_id`)}
          and exists (select 1 from agents a where a.workspace_id = u.workspace_id)
      `),
    ]);

  const signups = countMap(
    signupRows.map((row) => ({ day: row.day, n: row.n })),
  );
  const sourcesByDay = new Map<string, Map<string, number>>();
  for (const row of signupRows) {
    const bucket = sourcesByDay.get(row.day) ?? new Map<string, number>();
    bucket.set(row.source, (bucket.get(row.source) ?? 0) + Number(row.n));
    sourcesByDay.set(row.day, bucket);
  }
  const workspacesByDay = countMap(workspaceRows);
  const agentsByDay = countMap(agentRows);
  const activeByDay = countMap(activeRows);
  const tasksCreated = countMap(createdRows);
  const tasksCompleted = countMap(completedRows);
  const tasksFailed = countMap(failedRows);
  const messages = countMap(messageRows);

  const series: UsageDay[] = [];
  for (let i = 0; i < options.days; i += 1) {
    const date = utcDayString(new Date(start.getTime() + i * DAY_MS));
    series.push({
      date,
      signups: signups.get(date) ?? 0,
      workspaces: workspacesByDay.get(date) ?? 0,
      agents_registered: agentsByDay.get(date) ?? 0,
      active_agents: activeByDay.get(date) ?? 0,
      tasks_created: tasksCreated.get(date) ?? 0,
      tasks_completed: tasksCompleted.get(date) ?? 0,
      tasks_failed: tasksFailed.get(date) ?? 0,
      messages_sent: messages.get(date) ?? 0,
      signups_by_source: sortedSources(sourcesByDay.get(date) ?? new Map()),
    });
  }

  const signupsBySource = new Map<string, number>();
  for (const day of series) {
    for (const [source, count] of Object.entries(day.signups_by_source)) {
      signupsBySource.set(source, (signupsBySource.get(source) ?? 0) + count);
    }
  }

  const sum = (key: keyof Omit<UsageDay, 'date' | 'signups_by_source'>): number =>
    series.reduce((total, day) => total + day[key], 0);

  return {
    days: options.days,
    from: series[0]?.date ?? utcDayString(start),
    to: series[series.length - 1]?.date ?? utcDayString(end),
    totals: {
      signups: sum('signups'),
      workspaces: sum('workspaces'),
      agents_registered: sum('agents_registered'),
      active_agents: Number(activeTotalRows[0]?.n ?? 0),
      tasks_created: sum('tasks_created'),
      tasks_completed: sum('tasks_completed'),
      tasks_failed: sum('tasks_failed'),
      messages_sent: sum('messages_sent'),
      signups_by_source: sortedSources(signupsBySource),
    },
    series,
    wants_sharing: Number(wantsSharingRows[0]?.n ?? 0),
    wants_sharing_with_agent: Number(wantsSharingAgentRows[0]?.n ?? 0),
  };
}
