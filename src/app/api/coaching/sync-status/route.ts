/**
 * API route: GET /api/coaching/sync-status
 * Whether the nightly health sync ran, and whether COROS is connected.
 * Admin only (proxy blocks guests from /api/coaching).
 */

import { NextRequest, NextResponse } from 'next/server';
import { get_client } from '@/lib/db';
import { latest_sync_run, sync_health } from '@/lib/health/sync-runs';
import { coros_connection_status, coros_origin } from '@/lib/coros/mcp-client';

export async function GET(request: NextRequest) {
  const run = await latest_sync_run(get_client(), 'daily');
  const coros = await coros_connection_status(coros_origin(request.nextUrl.origin));
  return NextResponse.json({
    health: sync_health(run, Math.floor(Date.now() / 1000)),
    run,
    coros_connected: coros.connected,
  });
}
