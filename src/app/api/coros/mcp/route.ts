/**
 * API route: /api/coros/mcp (Phase 0 probe, docs/health-roadmap.md)
 *
 * GET  -> connection status for this site.
 * POST { action: 'sample' } -> list tools, then call every allowlisted read
 *      tool with best-guess arguments for the last 7 days. Returns raw results.
 * POST { action: 'call', tool, arguments } -> call one allowlisted read tool.
 *
 * Read-only. Owner only (or the Admin PIN on a preview).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { is_owner_or_preview_admin } from '@/lib/owner';
import {
  COROS_MCP_URL, COROS_READ_TOOLS, call_coros_read_tool, coros_connection_status,
  describe_coros_error, is_read_tool, list_coros_tools, with_coros,
} from '@/lib/coros/mcp-client';
import { build_sample_args } from '@/lib/coros/sample-args';
import { mt_date_str } from '@/lib/coaching/day';

export const maxDuration = 60;

// Keep one oversized result (a long activity stream) from swamping the page.
const MAX_RESULT_CHARS = 50_000;

function capped(result: unknown): unknown {
  const text = JSON.stringify(result);
  if (text.length <= MAX_RESULT_CHARS) return result;
  return { truncated: true, chars: text.length, preview: text.slice(0, MAX_RESULT_CHARS) };
}

async function deny(request: NextRequest): Promise<NextResponse | null> {
  if (is_owner_or_preview_admin(await getToken({ req: request }))) return null;
  return NextResponse.json({ error: 'Owner only' }, { status: 403 });
}

export async function GET(request: NextRequest) {
  const denied = await deny(request);
  if (denied) return denied;
  const origin = request.nextUrl.origin;
  return NextResponse.json({
    ...(await coros_connection_status(origin)),
    origin,
    server_url: COROS_MCP_URL,
    read_tools: COROS_READ_TOOLS,
  });
}

export async function POST(request: NextRequest) {
  const denied = await deny(request);
  if (denied) return denied;

  const origin = request.nextUrl.origin;
  const body = await request.json().catch(() => ({})) as { action?: string; tool?: string; arguments?: unknown };

  try {
    if (body.action === 'call') {
      const tool = body.tool ?? '';
      if (!is_read_tool(tool)) return NextResponse.json({ error: `Tool not allowed: ${tool}` }, { status: 400 });
      const args = body.arguments && typeof body.arguments === 'object' ? body.arguments as Record<string, unknown> : {};
      const result = await with_coros(origin, client => call_coros_read_tool(client, tool, args));
      return NextResponse.json({ tool, arguments: args, result: capped(result) });
    }

    if (body.action === 'sample') {
      const today = mt_date_str();
      const report = await with_coros(origin, async client => {
        const tools = await list_coros_tools(client);
        const results = [];
        for (const name of COROS_READ_TOOLS) {
          const def = tools.find(t => t.name === name);
          if (!def) {
            results.push({ tool: name, ok: false, error: 'Not offered by the COROS server' });
            continue;
          }
          const args = build_sample_args(def.inputSchema, today);
          const started = Date.now();
          try {
            const result = await call_coros_read_tool(client, name, args);
            results.push({ tool: name, arguments: args, ok: !result.isError, ms: Date.now() - started, result: capped(result) });
          } catch (err) {
            results.push({ tool: name, arguments: args, ok: false, ms: Date.now() - started, error: describe_coros_error(err) });
          }
        }
        return {
          today,
          server_url: COROS_MCP_URL,
          tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
          results,
        };
      });
      return NextResponse.json(report);
    }

    return NextResponse.json({ error: "action must be 'sample' or 'call'" }, { status: 400 });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'COROS is not connected, or the sign-in expired. Connect again.' }, { status: 401 });
    }
    console.error('COROS MCP probe failed:', describe_coros_error(err));
    return NextResponse.json({ error: describe_coros_error(err) }, { status: 502 });
  }
}
