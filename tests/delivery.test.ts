import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { agents } from '@/db/schema';
import { GET as getAgentRoute } from '@/app/api/v1/agents/[id]/route';
import { PUT as deliveryRoute } from '@/app/api/v1/agents/[id]/delivery/route';
import { call, createAgent, signIn } from './helpers';

function migrationUpdate(): string {
  const file = readFileSync('drizzle/0001_local_nudge.sql', 'utf8');
  const statement = file
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .find((part) => /^update\s+"agents"/i.test(part));
  if (!statement) throw new Error('0001_local_nudge.sql has no agents update');
  return statement.replace(/;\s*$/, '');
}

describe('local delivery', () => {
  it('normalizes legacy herdr input and accepts any driver id', async () => {
    const session = await signIn();
    const agent = await createAgent(session.cookie, 'DriverBot');
    const legacy = await call(deliveryRoute, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
      method: 'PUT',
      cookie: session.cookie,
      params: { id: agent.id },
      body: { mode: 'herdr', pane: 'red-pane' },
    });
    expect(legacy.status).toBe(200);
    expect(legacy.data.agent.delivery).toMatchObject({
      mode: 'local',
      driver: 'herdr',
      target: 'red-pane',
      pane: 'red-pane',
    });

    const local = await call(deliveryRoute, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
      method: 'PUT',
      cookie: session.cookie,
      params: { id: agent.id },
      body: { mode: 'local', driver: 'tmux', target: 'dev:0.0' },
    });
    expect(local.status).toBe(200);
    expect(local.data.agent.delivery).toMatchObject({ mode: 'local', driver: 'tmux', target: 'dev:0.0' });

    const bad = await call(deliveryRoute, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
      method: 'PUT',
      cookie: session.cookie,
      params: { id: agent.id },
      body: { mode: 'local', driver: 'Herdr', target: 'red' },
    });
    expect(bad.status).toBe(400);
  });

  it('reads a legacy herdr row as local and the migration rewrites it', async () => {
    const session = await signIn();
    const agent = await createAgent(session.cookie, 'LegacyRow');
    await getDb().execute(sql`
      update agents
      set delivery_mode = 'herdr', herdr_pane = 'legacy-pane', local_driver = null, local_target = null
      where id = ${agent.id}
    `);

    const read = await call(getAgentRoute, `http://localhost/api/v1/agents/${agent.id}`, {
      method: 'GET',
      cookie: session.cookie,
      params: { id: agent.id },
    });
    expect(read.status).toBe(200);
    expect(read.data.agent.delivery).toMatchObject({
      mode: 'local',
      driver: 'herdr',
      target: 'legacy-pane',
      pane: 'legacy-pane',
    });

    await getDb().execute(sql.raw(migrationUpdate()));
    const [row] = await getDb()
      .select({
        deliveryMode: agents.deliveryMode,
        localDriver: agents.localDriver,
        localTarget: agents.localTarget,
        herdrPane: agents.herdrPane,
      })
      .from(agents)
      .where(eq(agents.id, agent.id));
    expect(row).toEqual({
      deliveryMode: 'local',
      localDriver: 'herdr',
      localTarget: 'legacy-pane',
      herdrPane: 'legacy-pane',
    });
  });
});
