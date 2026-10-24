import { mcpAuthHandler } from '@/lib/mcp-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = mcpAuthHandler;
export const POST = mcpAuthHandler;
export const DELETE = mcpAuthHandler;
