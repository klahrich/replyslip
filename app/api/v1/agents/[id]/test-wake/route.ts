import { getAgent } from '@/lib/agents';
import { requireUser } from '@/lib/auth';
import { handle, json, requireUuid } from '@/lib/http';
import { clientIp } from '@/lib/origin';
import { consumeRateLimit } from '@/lib/rate-limit';
import { createTestWake, deliverWebhookWake } from '@/lib/wakes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT_MESSAGE = 'Too many test wakes for this agent. Try again later.';

export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const agent = await getAgent(user.workspace.id, requireUuid(id, 'agent'));
    if (agent.revokedAt) {
      return json({ error: { code: 'agent_revoked', message: 'This agent has been revoked.' } }, 409);
    }
    if (agent.deliveryMode === 'none') {
      return json(
        {
          error: {
            code: 'delivery_none',
            message: 'This agent has delivery mode none, so there is nothing to wake. Set webhook or local delivery first.',
          },
        },
        400,
      );
    }

    const limit = await consumeRateLimit({ kind: 'testWake', agentId: agent.id, ip: clientIp(req) });
    if (limit.limited) {
      return json(
        {
          error: {
            code: 'rate_limited',
            message: RATE_LIMIT_MESSAGE,
            retry_after_seconds: limit.retryAfterSeconds,
          },
        },
        429,
        { 'retry-after': String(limit.retryAfterSeconds) },
      );
    }

    const wakeId = await createTestWake(agent);
    if (agent.deliveryMode === 'webhook') {
      const attempt = await deliverWebhookWake(wakeId);
      const ok = attempt.outcome === 'delivered';
      return json({
        ok,
        wake_id: wakeId,
        ...(attempt.statusCode !== undefined ? { status_code: attempt.statusCode } : {}),
        ...(!ok ? { error: attempt.error ?? 'delivery failed' } : {}),
      });
    }

    return json({ ok: true, pending: true, wake_id: wakeId });
  });
}
