/**
 * API route: GET /api/coaching/scorecard
 * This week against Bill's targets (src/lib/health/scorecard.ts), from synced
 * COROS activities, Oura sleep, HRV and resting HR (the Oura cache, with
 * coach-session history filling its gaps), and weight from COROS. Owner only (or
 * the Admin PIN on a preview): it includes weight.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { OWNER_SIGN_IN_HINT, is_owner_or_preview_admin } from '@/lib/owner'
import { mt_date_str } from '@/lib/coaching/day'
import { load_scorecard } from '@/lib/health/scorecard-data'

export async function GET(request: NextRequest) {
  if (!is_owner_or_preview_admin(await getToken({ req: request }))) {
    return NextResponse.json({ error: OWNER_SIGN_IN_HINT }, { status: 403 })
  }
  try {
    return NextResponse.json(await load_scorecard(mt_date_str()))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
