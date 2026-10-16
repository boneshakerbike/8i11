/**
 * API route: GET /api/claude-status
 * The Claude API's state from status.claude.com, for the main page's status light.
 * Session-gated by proxy.ts's default, so it isn't an open proxy to the status page.
 * Always answers 200: an unreachable status page is a valid "unknown" answer.
 */

import { NextResponse } from 'next/server';
import { fetch_claude_status } from '@/lib/claude_status';

// Never prerender: a static build would call status.claude.com during
// `next build` and freeze that answer into the deployment.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await fetch_claude_status());
}
