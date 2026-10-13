/**
 * API route: GET /api/coaching/memory/proposals
 * The profile edits the coach proposed that Bill has not answered yet.
 * Owner only (or the Admin PIN on a preview).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { OWNER_SIGN_IN_HINT, is_owner_or_preview_admin } from '@/lib/owner'
import { get_client } from '@/lib/db'
import { list_pending_proposals } from '@/lib/coaching/memory'

export async function GET(request: NextRequest) {
  if (!is_owner_or_preview_admin(await getToken({ req: request }))) {
    return NextResponse.json({ error: OWNER_SIGN_IN_HINT }, { status: 403 })
  }
  try {
    return NextResponse.json({ proposals: await list_pending_proposals(get_client()) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
