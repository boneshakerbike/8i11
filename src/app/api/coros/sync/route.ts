/**
 * API route: POST /api/coros/sync
 * "Sync now": pull the last 7 days from COROS immediately (the daily job
 * does the same). Owner only (or the Admin PIN on a preview).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { is_owner_or_preview_admin } from '@/lib/owner'
import { get_client } from '@/lib/db'
import { sync_coros } from '@/lib/coros/sync'
import { coros_origin } from '@/lib/coros/mcp-client'
import { mt_date_str } from '@/lib/coaching/day'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!is_owner_or_preview_admin(await getToken({ req: request }))) {
    return NextResponse.json({ error: 'Owner only' }, { status: 403 })
  }
  const step = await sync_coros(get_client(), coros_origin(request.nextUrl.origin), mt_date_str())
  return NextResponse.json(step, { status: step.ok ? 200 : 502 })
}
