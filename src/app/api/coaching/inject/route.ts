/**
 * API route: POST /api/coaching/inject
 * Called by the Today page (/health) when a session starts. Refreshes COROS first (the
 * same pull as Sync now), so a ride synced this morning counts, then builds the
 * daily brief the coach reads (src/lib/health/daily-brief.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { build_data_injection, ManualInputs } from '@/lib/coaching/data-injection';
import { get_client } from '@/lib/db';
import { sync_coros } from '@/lib/coros/sync';
import { coros_origin } from '@/lib/coros/mcp-client';

export const maxDuration = 60;

/** Longest the session start waits for COROS before using what is already stored. */
const COROS_REFRESH_MS = 20_000;

/** Null when COROS refreshed cleanly, else what went wrong. Never throws. */
async function refresh_coros(origin: string, today: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>(resolve => { timer = setTimeout(() => resolve('took too long'), COROS_REFRESH_MS); });
  const refresh = sync_coros(get_client(), coros_origin(origin), today).then(step => (step.ok ? null : step.detail));
  try {
    return await Promise.race([refresh, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { date_str, epoch_day, manual, oura_live } = body as {
      date_str: string;
      epoch_day: number;
      manual: ManualInputs;
      oura_live?: Record<string, unknown>;
    };

    if (!date_str || !epoch_day) {
      return NextResponse.json({ error: 'date_str and epoch_day are required' }, { status: 400 });
    }

    const coros_problem = await refresh_coros(request.nextUrl.origin, date_str);
    const { injection, metrics } = await build_data_injection(
      date_str, epoch_day, manual || {}, oura_live, coros_problem
    );

    return NextResponse.json({ injection, metrics });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Injection build failed' },
      { status: 500 }
    );
  }
}
