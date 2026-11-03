import { describe, expect, it } from 'vitest';
import { mcpAuthHandler } from '@/lib/mcp-server';
import { createAgent, createKey, mcpTool, parseRpc, signIn } from './helpers';

describe('MCP serverInfo', () => {
  it("initialize names the server 'valetto', and tools work as before", async () => {
    const session = await signIn();
    const agent = await createAgent(session.cookie, 'NameCheck');
    const key = await createKey(session.cookie, agent.id);
    const res = await mcpAuthHandler(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const rpc = parseRpc(await res.text());
    expect(rpc.result.serverInfo.name).toBe('valetto');
    // Tool names do not carry the server name, so clients configured under any name (e.g. "replyslip") keep working.
    const listed = await mcpTool(key, 'list_agents');
    expect(listed.isError).toBe(false);
  });
});
