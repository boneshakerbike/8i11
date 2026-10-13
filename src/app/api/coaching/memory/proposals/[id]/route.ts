/**
 * API route: POST /api/coaching/memory/proposals/[id]  body { accept: boolean }
 * Accept (apply to the profile as a new version) or reject one proposed edit.
 * Owner only (or the Admin PIN on a preview).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { OWNER_SIGN_IN_HINT, is_owner_or_preview_admin } from '@/lib/owner'
import { get_client } from '@/lib/db'
import { decide_proposal } from '@/lib/coaching/memory'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!is_owner_or_preview_admin(await getToken({ req: request }))) {
    return NextResponse.json({ error: OWNER_SIGN_IN_HINT }, { status: 403 })
  }
  const id = Number((await params).id)
  const { accept } = (await request.json().catch(() => ({}))) as { accept?: unknown }
  if (!Number.isInteger(id) || typeof accept !== 'boolean') {
    return NextResponse.json({ error: 'Send { accept: true } or { accept: false }' }, { status: 400 })
  }
  try {
    const result = await decide_proposal(get_client(), id, accept)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
