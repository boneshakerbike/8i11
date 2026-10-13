/**
 * API route: PUT /api/coaching/memory/profile
 * Save Bill's profile as a new version (old versions are kept).
 * Owner only (or the Admin PIN on a preview).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { OWNER_SIGN_IN_HINT, is_owner_or_preview_admin } from '@/lib/owner'
import { get_client } from '@/lib/db'
import { MAX_PROFILE_CHARS, save_memory_document } from '@/lib/coaching/memory'

export async function PUT(request: NextRequest) {
  if (!is_owner_or_preview_admin(await getToken({ req: request }))) {
    return NextResponse.json({ error: OWNER_SIGN_IN_HINT }, { status: 403 })
  }
  const { body } = (await request.json().catch(() => ({}))) as { body?: unknown }
  const text = typeof body === 'string' ? body.replace(/\r\n/g, '\n').trim() : ''
  if (!text) return NextResponse.json({ error: 'The profile is empty' }, { status: 400 })
  if (text.length > MAX_PROFILE_CHARS) {
    return NextResponse.json({ error: `The profile is ${text.length} characters; the limit is ${MAX_PROFILE_CHARS}` }, { status: 400 })
  }
  try {
    const changed = await save_memory_document(get_client(), 'profile', text, 'app')
    return NextResponse.json({ ok: true, changed })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
