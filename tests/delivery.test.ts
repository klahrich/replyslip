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

    const orca = await call(deliveryRoute, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
      method: 'PUT',
      cookie: session.cookie,
      params: { id: agent.id },
      body: { mode: 'local', driver: 'orca', target: 'tab_a:11111111-1111-4111-8111-111111111111' },
    });
    expect(orca.status).toBe(200);
    expect(orca.data.agent.delivery).toMatchObject({
      mode: 'local',
      driver: 'orca',
      target: 'tab_a:11111111-1111-4111-8111-111111111111',
      pane: 'tab_a:11111111-1111-4111-8111-111111111111',
    });

    const orcaTitle = await call(deliveryRoute, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
      method: 'PUT',
      cookie: session.cookie,
      params: { id: agent.id },
      body: { mode: 'local', driver: 'orca', target: 'Reviewer agent' },
    });
    expect(orcaTitle.status).toBe(400);
    expect(orcaTitle.data.error).toEqual({
      code: 'validation_error',
      message: 'Invalid request body.',
      details: { issues: [{ path: 'target', message: 'The Orca pane key looks like tabId:leafId.' }] },
    });

    const orcaLong = 'a:' + 'b'.repeat(199);
    const orcaTooLong = await call(deliveryRoute, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
      method: 'PUT',
      cookie: session.cookie,
      params: { id: agent.id },
      body: { mode: 'local', driver: 'orca', target: orcaLong },
    });
    expect(orcaTooLong.status).toBe(400);
    expect(orcaTooLong.data.error.details.issues).toEqual([
      { path: 'target', message: 'The Orca pane key looks like tabId:leafId.' },
    ]);

    const orcaControl = await call(deliveryRoute, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
      method: 'PUT',
      cookie: session.cookie,
      params: { id: agent.id },
      body: { mode: 'local', driver: 'orca', target: 'tab:\u0001leaf' },
    });
    expect(orcaControl.status).toBe(400);
    expect(orcaControl.data.error.details.issues[0].message).toBe('The Orca pane key looks like tabId:leafId.');

    const orcaMax = await call(deliveryRoute, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
      method: 'PUT',
      cookie: session.cookie,
      params: { id: agent.id },
      body: { mode: 'local', driver: 'orca', target: 'a:' + 'b'.repeat(198) },
    });
    expect(orcaMax.status).toBe(200);

    const herdrLine = await call(deliveryRoute, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
      method: 'PUT',
      cookie: session.cookie,
      params: { id: agent.id },
      body: { mode: 'local', driver: 'herdr', target: 'red\npane' },
    });
    expect(herdrLine.status).toBe(400);
    expect(herdrLine.data.error.details.issues).toEqual([{ path: 'target', message: 'Target must be a single line.' }]);

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
