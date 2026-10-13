/**
 * API route: GET /api/coaching/trends/range?days=90|365
 * Every charted metric over the range, for the Trends page: daily for 90
 * days, weekly averages for a year.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { get_client, ensure_schema } from '@/lib/db';
import { mt_epoch_day } from '@/lib/coaching/day';
import { TREND_METRICS, build_trend_series, parse_range } from '@/lib/health/trends-range';

export async function GET(request: NextRequest) {
  if (!(await getToken({ req: request }))) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const range = parse_range(request.nextUrl.searchParams.get('days'));
  try {
    await ensure_schema();
    const today = mt_epoch_day();
    // Column names come from metric-config, never from the request
    const columns = TREND_METRICS.map(m => m.dbColumn).join(', ');
    const result = await get_client().execute({
      sql: `SELECT date, ${columns} FROM daily_metrics WHERE date > ? AND date <= ? ORDER BY date ASC`,
      args: [today - range, today],
    });
    return NextResponse.json({ range, series: build_trend_series(result.rows as unknown as Record<string, unknown>[], range) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load trends' }, { status: 500 });
  }
}
