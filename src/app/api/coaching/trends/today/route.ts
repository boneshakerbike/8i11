/**
 * API route: POST /api/coaching/trends/today
 * Accepts today's live metrics, ensures daily_metrics is populated,
 * then returns day-over-day deltas with health interpretation.
 * Used by the coach page for trending arrows on metric cards.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { get_client, ensure_schema } from '@/lib/db';
import { METRIC_CONFIG, computeTrend, type MetricTrend } from '@/lib/coaching/metric-config';
import { mt_epoch_day } from '@/lib/coaching/day';
import { estimate_cv_age } from '@/lib/health/oura-derive';

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    await ensure_schema();
    const db = get_client();
    const today = mt_epoch_day();
    const yesterday = today - 1;
    const now = Math.floor(Date.now() / 1000);

    const body = await request.json().catch(() => ({}));
    const liveMetrics = body.metrics as Record<string, number | null> | undefined;

    // If live metrics provided, ensure today's daily_metrics row exists
    if (liveMetrics) {
      const existing = await db.execute({
        sql: `SELECT date FROM daily_metrics WHERE date = ?`,
        args: [today],
      });

      if (existing.rows.length === 0) {
        const fin = (v: number | null | undefined): number | null =>
          v != null && isFinite(v) ? v : null;

        // Estimate CV age from HRV + RHR if not provided directly
        const hrv = fin(liveMetrics.hrv_rmssd);
        const rhr = fin(liveMetrics.resting_hr);
        const cv_age = fin(liveMetrics.cardiovascular_age) ?? estimate_cv_age(hrv, rhr);

        await db.execute({
          sql: `INSERT OR IGNORE INTO daily_metrics (
            date, sleep_duration_min, sleep_efficiency_pct, deep_sleep_min, rem_sleep_min,
            hrv_rmssd, resting_hr, readiness_score, cardiovascular_age, spo2_average,
            weight_lbs, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            today,
            fin(liveMetrics.sleep_duration_min), fin(liveMetrics.sleep_efficiency_pct),
            fin(liveMetrics.deep_sleep_min), fin(liveMetrics.rem_sleep_min),
            hrv, rhr, fin(liveMetrics.readiness_score), cv_age, fin(liveMetrics.spo2_average),
            fin(liveMetrics.weight_lbs),
            now, now,
          ],
        });
      }
    }

    // Fetch today and yesterday rows
    const result = await db.execute({
      sql: `SELECT * FROM daily_metrics WHERE date IN (?, ?) ORDER BY date ASC`,
      args: [yesterday, today],
    });

    const yesterdayRow = result.rows.find(r => Number(r.date) === yesterday);
    const todayRow = result.rows.find(r => Number(r.date) === today);

    const trends: MetricTrend[] = [];

    for (const [key, def] of Object.entries(METRIC_CONFIG)) {
      const todayVal = todayRow?.[def.dbColumn] != null ? Number(todayRow[def.dbColumn]) : null;
      const yesterdayVal = yesterdayRow?.[def.dbColumn] != null ? Number(yesterdayRow[def.dbColumn]) : null;

      const trend = computeTrend(key, todayVal, yesterdayVal);
      if (trend) {
        trends.push(trend);
      }
    }

    // Fetch last 7 days for sparklines
    const sevenDaysAgo = today - 6;
    const sparklineResult = await db.execute({
      sql: `SELECT * FROM daily_metrics WHERE date >= ? AND date <= ? ORDER BY date ASC`,
      args: [sevenDaysAgo, today],
    });

    // Build a map of date -> row for the 7-day window
    const dateToRow: Record<number, typeof sparklineResult.rows[0]> = {};
    for (const row of sparklineResult.rows) {
      dateToRow[Number(row.date)] = row;
    }

    const sparklines: Record<string, (number | null)[]> = {};
    for (const [, def] of Object.entries(METRIC_CONFIG)) {
      const vals: (number | null)[] = [];
      for (let d = sevenDaysAgo; d <= today; d++) {
        const row = dateToRow[d];
        vals.push(row?.[def.dbColumn] != null ? Number(row[def.dbColumn]) : null);
      }
      sparklines[def.slug] = vals;
    }

    // Include last known weight so the card renders before session start
    const weightRow = await db.execute({
      sql: `SELECT date, weight_lbs FROM daily_metrics WHERE weight_lbs IS NOT NULL ORDER BY date DESC LIMIT 1`,
      args: [],
    });
    const lastWeight = weightRow.rows.length > 0
      ? { value: Number(weightRow.rows[0].weight_lbs), stale: Number(weightRow.rows[0].date) < today }
      : null;

    return NextResponse.json({ trends, sparklines, lastWeight });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to compute trends' },
      { status: 500 }
    );
  }
}
