/**
 * API route: GET /api/coaching/trends
 * Vercel cron endpoint — computes 7/30-day rolling averages.
 * Protected by CRON_SECRET header check (src/lib/cron_auth.ts).
 * Runs daily at 09:00 UTC (2-3am MT) via vercel.json cron config.
 * daily_metrics is never pruned: longevity trends need years of history.
 */

import { NextRequest, NextResponse } from 'next/server';
import { compute_trends, cleanup_trend_cache, populate_daily_metrics } from '@/lib/coaching/db';
import { mt_epoch_day, epoch_day_to_date_str } from '@/lib/coaching/day';
import { is_cron_authorized } from '@/lib/cron_auth';

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sends this automatically for cron jobs)
  if (!is_cron_authorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const today = mt_epoch_day();

    // Populate daily_metrics from cached Oura + COROS for yesterday
    // (cron runs at 9am UTC = 2-3am MT, so yesterday's data is complete)
    const yesterday_epoch = today - 1;
    const yesterday_str = epoch_day_to_date_str(yesterday_epoch);
    const populated = await populate_daily_metrics(yesterday_str, yesterday_epoch);

    const trend_result = await compute_trends(today);
    const trends_cleaned = await cleanup_trend_cache(today);

    return NextResponse.json({
      ok: true,
      date: today,
      populated_yesterday: populated,
      trends: trend_result,
      cleaned: { trend_cache: trends_cleaned },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Trend computation failed' },
      { status: 500 }
    );
  }
}
