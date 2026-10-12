/**
 * Server-side client for the official COROS MCP server.
 *
 * Read-only by design: COROS_READ_TOOLS is the only set of tools this app will
 * call. The write tools (training plans, workouts) are not reachable from here.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { get_client } from '@/lib/db';
import { create_coros_store, type CorosStore } from '@/lib/coros/store';
import { CorosOAuthProvider } from '@/lib/coros/oauth-provider';

/**
 * The US regional server. COROS's default https://mcp.coros.com/mcp redirects by
 * account region, and COROS warns some clients fail on that redirect.
 */
export const COROS_MCP_URL = process.env.COROS_MCP_URL || 'https://mcpus.coros.com/mcp';

export const COROS_READ_TOOLS = [
  'queryDailyHealthData',
  'querySleepOverview',
  'querySleepHrv',
  'queryRestingHeartRate',
  'queryRecoveryStatus',
  'queryFitnessAssessmentOverview',
  'queryTrainingLoadAssessment',
  'querySportRecords',
  'getActivityDetail',
] as const;

export type CorosReadTool = (typeof COROS_READ_TOOLS)[number];

export function is_read_tool(name: string): name is CorosReadTool {
  return (COROS_READ_TOOLS as readonly string[]).includes(name);
}

/**
 * The site origin a COROS connection is stored under. Production uses its fixed
 * domain, so the nightly cron (which has no browser and may arrive on another
 * host name) finds the same connection the owner made. Previews use their own
 * URL, since each one registers its own callback with COROS.
 */
export function coros_origin(request_origin: string, env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return request_origin;
}

let store: CorosStore | null = null;
const get_store = (): CorosStore => (store ??= create_coros_store(get_client()));

/** Begin sign-in. Returns the COROS URL to send the browser to, or authorized if tokens already work. */
export async function start_coros_authorization(origin: string, state: string): Promise<{ authorization_url: string } | { authorized: true }> {
  const provider = new CorosOAuthProvider(origin, get_store(), state);
  const result = await auth(provider, { serverUrl: COROS_MCP_URL });
  if (result === 'AUTHORIZED') return { authorized: true };
  if (!provider.authorization_url) throw new Error('COROS did not return a sign-in URL');
  return { authorization_url: provider.authorization_url.toString() };
}

/** Finish sign-in with the code COROS sent to the callback. */
export async function finish_coros_authorization(origin: string, code: string): Promise<void> {
  const provider = new CorosOAuthProvider(origin, get_store());
  const result = await auth(provider, { serverUrl: COROS_MCP_URL, authorizationCode: code });
  if (result !== 'AUTHORIZED') throw new Error('COROS did not issue tokens');
}

export async function coros_connection_status(origin: string): Promise<{ connected: boolean; registered: boolean }> {
  const record = await get_store().get(origin);
  return { connected: !!record.tokens?.access_token, registered: !!record.client_info };
}

/** Forget this origin's tokens and client registration. */
export async function disconnect_coros(origin: string): Promise<boolean> {
  return get_store().remove(origin);
}

/** Open an MCP session as this origin's connected account, run fn, and close. */
export async function with_coros<T>(origin: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const provider = new CorosOAuthProvider(origin, get_store());
  const transport = new StreamableHTTPClientTransport(new URL(COROS_MCP_URL), { authProvider: provider });
  const client = new Client({ name: '8i11', version: '1.0.0' });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function list_coros_tools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

/** Call one allowlisted read tool. Anything else is refused before it reaches COROS. */
export async function call_coros_read_tool(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (!is_read_tool(name)) throw new Error(`Tool not allowed: ${name}`);
  return await client.callTool({ name, arguments: args }) as CallToolResult;
}

/** One-line, user-facing description of a COROS or OAuth failure. Never includes tokens. */
export function describe_coros_error(err: unknown): string {
  if (!(err instanceof Error)) return String(err).slice(0, 300);
  const name = err.name && err.name !== 'Error' ? `${err.name}: ` : '';
  return `${name}${err.message}`.slice(0, 300);
}
