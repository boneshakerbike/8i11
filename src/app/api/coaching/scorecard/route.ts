/**
 * API route: GET /api/coaching/scorecard
 * This week against Bill's targets (src/lib/health/scorecard.ts), from synced
 * COROS activities, Oura sleep, HRV and resting HR, and typed weight. Owner
 * only (or the Admin PIN on a preview): it includes weight.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { OWNER_SIGN_IN_HINT, is_owner_or_preview_admin } from '@/lib/owner'
import { get_client, get_wellness_sleep_minutes, get_wellness_vitals } from '@/lib/db'
import { get_coros_activities } from '@/lib/coros/data'
import { get_weights } from '@/lib/coaching/db'
import { date_str_to_epoch_day, mt_date_str, shift_date } from '@/lib/coaching/day'
import { BASELINE_DAYS, week_start, weekly_scorecard } from '@/lib/health/scorecard'

export async function GET(request: NextRequest) {
  if (!is_owner_or_preview_admin(await getToken({ req: request }))) {
    return NextResponse.json({ error: OWNER_SIGN_IN_HINT }, { status: 403 })
  }
  try {
    const today = mt_date_str()
    const start = week_start(today)
    const [activities, sleep, vitals, weights] = await Promise.all([
      get_coros_activities(get_client(), start, today),
      get_wellness_sleep_minutes(start, today),
      // The last 7 days plus the 90 before them
      get_wellness_vitals(shift_date(today, 6 + BASELINE_DAYS), today),
      get_weights(date_str_to_epoch_day(start), date_str_to_epoch_day(today)),
    ])
    return NextResponse.json(weekly_scorecard({ today, activities, sleep, vitals, weights }))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
