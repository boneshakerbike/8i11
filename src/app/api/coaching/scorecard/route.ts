/**
 * API route: GET /api/coaching/scorecard
 * This week against Bill's targets (src/lib/health/scorecard.ts), from synced
 * COROS activities, Oura sleep, HRV and resting HR (the Oura cache, with
 * coach-session history filling its gaps), and typed weight. Owner only (or
 * the Admin PIN on a preview): it includes weight.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { OWNER_SIGN_IN_HINT, is_owner_or_preview_admin } from '@/lib/owner'
import { get_client, get_wellness_sleep_minutes, get_wellness_vitals } from '@/lib/db'
import { get_coros_activities } from '@/lib/coros/data'
import { get_daily_metric_vitals, get_weights } from '@/lib/coaching/db'
import { date_str_to_epoch_day, mt_date_str, shift_date } from '@/lib/coaching/day'
import { BASELINE_DAYS, fill_gaps, week_start, weekly_scorecard } from '@/lib/health/scorecard'

export async function GET(request: NextRequest) {
  if (!is_owner_or_preview_admin(await getToken({ req: request }))) {
    return NextResponse.json({ error: OWNER_SIGN_IN_HINT }, { status: 403 })
  }
  try {
    const today = mt_date_str()
    const start = week_start(today)
    // The last 7 days plus the 90 before them
    const history_from = shift_date(today, 6 + BASELINE_DAYS)
    const [activities, cache_sleep, cache_vitals, history, weights] = await Promise.all([
      get_coros_activities(get_client(), start, today),
      get_wellness_sleep_minutes(start, today),
      get_wellness_vitals(history_from, today),
      // Coach sessions saved the same Oura numbers; they fill days the cache lacks
      get_daily_metric_vitals(date_str_to_epoch_day(history_from), date_str_to_epoch_day(today)),
      get_weights(date_str_to_epoch_day(start), date_str_to_epoch_day(today)),
    ])
    const vitals = fill_gaps(cache_vitals, history.map(h => ({ date: h.date, hrv: h.hrv, resting_hr: h.resting_hr })))
    const sleep = fill_gaps(cache_sleep, history.map(h => ({ date: h.date, total_min: h.sleep_min })))
    return NextResponse.json(weekly_scorecard({ today, activities, sleep, vitals, weights }))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
