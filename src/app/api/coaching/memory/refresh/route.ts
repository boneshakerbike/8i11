/**
 * API route: POST /api/coaching/memory/refresh
 * Copy the framework files from Google Drive now (the daily job does the same).
 * Owner only (or the Admin PIN on a preview).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { OWNER_SIGN_IN_HINT, is_owner_or_preview_admin } from '@/lib/owner'
import { get_client } from '@/lib/db'
import { refresh_coach_memory } from '@/lib/coaching/memory-drive'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!is_owner_or_preview_admin(await getToken({ req: request }))) {
    return NextResponse.json({ error: OWNER_SIGN_IN_HINT }, { status: 403 })
  }
  const result = await refresh_coach_memory(get_client())
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
