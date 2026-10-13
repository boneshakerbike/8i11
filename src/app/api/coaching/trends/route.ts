/**
 * API route: GET /api/coaching/trends
 * The daily health job (Vercel cron, vercel.json, 18:00 UTC = noon MDT / 11am MST).
 * Midday, not night: neither the Oura ring nor the COROS watch uploads until
 * Bill opens its app in the morning and it syncs.
 *   1. Oura: re-fetch the last 7 days through today (force), so late uploads
 *      replace days that were cached empty or partial, and last night's sleep
 *      (filed under today) counts the same day.
 *   2. COROS: pull the last 7 days through MCP into coros_daily / coros_activities.
 *   3. Trends: build yesterday's daily_metrics row, then 7/30-day trend_cache.
 *   4. Coach memory: copy the framework files from Google Drive (a new
 *      version is saved only when a file changed).
 * Each step runs even if an earlier one fails, and the run is logged to
 * health_sync_runs so the Health page can show whether it ran.
 * Protected by CRON_SECRET (src/lib/cron_auth.ts).
 * daily_metrics is never pruned: longevity trends need years of history.
 */

import { NextRequest, NextResponse } from 'next/server';
import { compute_trends, cleanup_trend_cache, populate_daily_metrics } from '@/lib/coaching/db';
import { mt_date_str, mt_epoch_day, epoch_day_to_date_str } from '@/lib/coaching/day';
import { is_cron_authorized } from '@/lib/cron_auth';
import { get_client } from '@/lib/db';
import { sync_oura } from '@/lib/health/oura-sync';
import { sync_coros } from '@/lib/coros/sync';
import { coros_origin } from '@/lib/coros/mcp-client';
import { record_sync_run, run_step, type SyncStep } from '@/lib/health/sync-runs';
import { refresh_coach_memory } from '@/lib/coaching/memory-drive';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sends this automatically for cron jobs)
  if (!is_cron_authorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started_at = Math.floor(Date.now() / 1000);
  const db = get_client();
  const steps: SyncStep[] = [];

  steps.push(await run_step('oura', async () => {
    const r = await sync_oura({ days: 7, force: true, include_today: true });
    if (!r.connected) return { ok: false, detail: 'Oura is not connected' };
    const errors = r.errors.length > 0 ? `; errors: ${r.errors.join(', ')}` : '';
    return { ok: r.errors.length === 0, detail: `${r.synced} days synced, ${r.skipped} already cached${errors}` };
  }));

  steps.push(await sync_coros(db, coros_origin(request.nextUrl.origin), mt_date_str()));

  steps.push(await run_step('trends', async () => {
    const today = mt_epoch_day();
    // Yesterday is complete by midday: its sleep and activity have uploaded
    const yesterday_epoch = today - 1;
    await populate_daily_metrics(epoch_day_to_date_str(yesterday_epoch), yesterday_epoch);
    const trends = await compute_trends(today);
    const cleaned = await cleanup_trend_cache(today);
    return { ok: true, detail: `${trends.rows_written} trend rows, ${cleaned} old trend rows removed` };
  }));

  steps.push(await run_step('memory', () => refresh_coach_memory(db)));

  const run = { job: 'daily', started_at, finished_at: Math.floor(Date.now() / 1000), ok: steps.every(s => s.ok), steps };
  try {
    await record_sync_run(db, run);
  } catch (err) {
    console.error('Could not record sync run:', err);
  }

  return NextResponse.json(run, { status: run.ok ? 200 : 207 });
}
