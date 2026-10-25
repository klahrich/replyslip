import type { AuthInfo } from '@modelcontextprotocol/server';
import { eq } from 'drizzle-orm';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { getDb } from '@/db';
import { workspaces } from '@/db/schema';
import { agentAuthErrorDescription, replaceWwwAuthenticateDescription } from './agent-auth-error';
import { authenticateAgentKey, getAgent, watcherPresence, workspaceWatcherLastSeen, type AgentPrincipal } from './agents';
import { whoamiDelivery } from './delivery';
import { HttpError } from './errors';
import { PlanLimitError, workspacePlanUsage } from './plans';
import { TOOL_DOCS, toolInputs } from './mcp-tools';
import { askTask, completeTask, createTask, failTask, getTask, listTasks, sendMessage } from './tasks';

type ToolCtx = {
  http?: {
    authInfo?: AuthInfo;
  };
};

function principalFrom(ctx: ToolCtx): AgentPrincipal {
  const extra = ctx.http?.authInfo?.extra;
  if (
    !extra ||
    typeof extra.agentId !== 'string' ||
    typeof extra.workspaceId !== 'string' ||
    typeof extra.agentName !== 'string' ||
    typeof extra.keyId !== 'string'
  ) {
    throw new HttpError(401, 'unauthorized', 'Agent authentication is required.');
  }
  return {
    agentId: extra.agentId,
    workspaceId: extra.workspaceId,
    agentName: extra.agentName,
    keyId: extra.keyId,
  };
}

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

function fail(err: unknown) {
  if (err instanceof PlanLimitError) {
    return {
      isError: true as const,
      content: [{ type: 'text' as const, text: JSON.stringify(err.body) }],
    };
  }
  if (err instanceof HttpError) {
    return {
      isError: true as const,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: err.code,
            message: err.message,
            details: err.details ?? null,
          }),
        },
      ],
    };
  }
  console.error(err);
  return {
    isError: true as const,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: 'internal_error', message: 'Something went wrong.' }),
      },
    ],
  };
}

const docsByName = new Map(TOOL_DOCS.map((tool) => [tool.name, tool]));

export const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      'send_message',
      {
        title: docsByName.get('send_message')!.title,
        description: docsByName.get('send_message')!.description,
        inputSchema: toolInputs.send_message,
      },
      async (args, ctx) => {
        try {
          const message = await sendMessage(principalFrom(ctx as ToolCtx), {
            to: args.to,
            body: args.body,
            taskId: args.task_id,
          });
          return ok({ message });
        } catch (err) {
          return fail(err);
        }
      },
    );

    server.registerTool(
      'create_task',
      {
        title: docsByName.get('create_task')!.title,
        description: docsByName.get('create_task')!.description,
        inputSchema: toolInputs.create_task,
      },
      async (args, ctx) => {
        try {
          const task = await createTask(principalFrom(ctx as ToolCtx), {
            to: args.to,
            title: args.title,
            description: args.description,
            resultSchema: args.result_schema,
          });
          return ok({ task });
        } catch (err) {
          return fail(err);
        }
      },
    );

    server.registerTool(
      'get_task',
      {
        title: docsByName.get('get_task')!.title,
        description: docsByName.get('get_task')!.description,
        inputSchema: toolInputs.get_task,
      },
      async (args, ctx) => {
        try {
          return ok(await getTask(principalFrom(ctx as ToolCtx), args.id));
        } catch (err) {
          return fail(err);
        }
      },
    );

    server.registerTool(
      'complete_task',
      {
        title: docsByName.get('complete_task')!.title,
        description: docsByName.get('complete_task')!.description,
        inputSchema: toolInputs.complete_task,
      },
      async (args, ctx) => {
        try {
          const task = await completeTask(principalFrom(ctx as ToolCtx), args.id, args.result);
          return ok({ task });
        } catch (err) {
          return fail(err);
        }
      },
    );

    server.registerTool(
      'ask',
      {
        title: docsByName.get('ask')!.title,
        description: docsByName.get('ask')!.description,
        inputSchema: toolInputs.ask,
      },
      async (args, ctx) => {
        try {
          const task = await askTask(principalFrom(ctx as ToolCtx), args.id, args.question);
          return ok({ task });
        } catch (err) {
          return fail(err);
        }
      },
    );

    server.registerTool(
      'fail_task',
      {
        title: docsByName.get('fail_task')!.title,
        description: docsByName.get('fail_task')!.description,
        inputSchema: toolInputs.fail_task,
      },
      async (args, ctx) => {
        try {
          const task = await failTask(principalFrom(ctx as ToolCtx), args.id, args.reason);
          return ok({ task });
        } catch (err) {
          return fail(err);
        }
      },
    );

    server.registerTool(
      'whoami',
      {
        title: docsByName.get('whoami')!.title,
        description: docsByName.get('whoami')!.description,
        inputSchema: toolInputs.whoami,
      },
      async (_args, ctx) => {
        try {
          const principal = principalFrom(ctx as ToolCtx);
          const agent = await getAgent(principal.workspaceId, principal.agentId);
          const [workspace] = await getDb()
            .select({ name: workspaces.name })
            .from(workspaces)
            .where(eq(workspaces.id, principal.workspaceId))
            .limit(1);
          const seen = await workspaceWatcherLastSeen(principal.workspaceId);
          const plan = await workspacePlanUsage(principal.workspaceId);
          return ok({
            name: agent.name,
            id: agent.id,
            workspace_name: workspace?.name ?? null,
            delivery: whoamiDelivery(agent),
            ...watcherPresence(agent, seen),
            plan: plan.plan,
            usage: plan.usage,
            limits: plan.limits,
          });
        } catch (err) {
          return fail(err);
        }
      },
    );

    server.registerTool(
      'list_tasks',
      {
        title: docsByName.get('list_tasks')!.title,
        description: docsByName.get('list_tasks')!.description,
        inputSchema: toolInputs.list_tasks,
      },
      async (args, ctx) => {
        try {
          const tasks = await listTasks(principalFrom(ctx as ToolCtx), {
            status: args.status,
            role: args.role,
          });
          return ok({ tasks });
        } catch (err) {
          return fail(err);
        }
      },
    );
  },
  {
    serverInfo: { name: 'replyslip', version: '0.1.0' },
    instructions:
      'ReplySlip relays messages and schema-checked tasks between agents in one workspace. ' +
      'You are authenticated as a single agent. Call list_tasks and get_task to read work addressed to you. ' +
      'complete_task validates the result before anything is saved.',
  },
);

async function verifyAgentToken(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const principal = await authenticateAgentKey(bearerToken);
  if (!principal) return undefined;
  return {
    token: bearerToken,
    clientId: principal.agentId,
    scopes: ['agent'],
    extra: {
      agentId: principal.agentId,
      workspaceId: principal.workspaceId,
      agentName: principal.agentName,
      keyId: principal.keyId,
    },
  };
}

const authorizedMcp = withMcpAuth(mcpHandler, verifyAgentToken, { required: true });

export async function mcpAuthHandler(req: Request): Promise<Response> {
  const res = await authorizedMcp(req);
  return describeRejectedAgentAuth(res, req.headers.get('authorization'));
}

/**
 * mcp-handler reports every missing AuthInfo as "No authorization provided".
 * Keep its 401, invalid_token code, and WWW-Authenticate challenge, and replace
 * only error_description. The description is chosen from the header shape and
 * the rsw_ prefix. It never includes the token.
 */
async function describeRejectedAgentAuth(res: Response, authorization: string | null): Promise<Response> {
  if (res.status !== 401) return res;
  let body: { error?: unknown } | null = null;
  try {
    body = (await res.clone().json()) as { error?: unknown };
  } catch {
    return res;
  }
  if (!body || body.error !== 'invalid_token') return res;
  const description = agentAuthErrorDescription(authorization);
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.delete('content-type');
  const challenge = headers.get('www-authenticate');
  if (challenge) headers.set('www-authenticate', replaceWwwAuthenticateDescription(challenge, description));
  return Response.json({ error: 'invalid_token', error_description: description }, { status: 401, headers });
}
