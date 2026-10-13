/**
 * API route: POST /api/coros/sync
 * "Sync now": pull the last 7 days from COROS immediately (the daily job
 * does the same). The Coach page also calls it on open, so this morning's
 * weight and activities show without starting a session. Returns the latest
 * saved weight for the Weight card. Owner only (or the Admin PIN on a preview).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { OWNER_SIGN_IN_HINT, is_owner_or_preview_admin } from '@/lib/owner'
import { get_client } from '@/lib/db'
import { sync_coros } from '@/lib/coros/sync'
import { coros_origin } from '@/lib/coros/mcp-client'
import { mt_date_str, mt_epoch_day } from '@/lib/coaching/day'
import { get_last_known_manual_metrics } from '@/lib/coaching/db'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!is_owner_or_preview_admin(await getToken({ req: request }))) {
    return NextResponse.json({ error: OWNER_SIGN_IN_HINT }, { status: 403 })
  }
  const step = await sync_coros(get_client(), coros_origin(request.nextUrl.origin), mt_date_str())
  const last = await get_last_known_manual_metrics()
  const weight = last.weight_lbs != null
    ? { value: last.weight_lbs, stale: last.weight_date !== mt_epoch_day() }
    : null
  return NextResponse.json({ ...step, weight }, { status: step.ok ? 200 : 502 })
}
