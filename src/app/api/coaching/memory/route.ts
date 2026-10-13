/**
 * API route: GET /api/coaching/memory
 * What the coach reads before every session: the framework and biomarker
 * targets copied from Drive, and the profile. Owner only (or the Admin PIN on
 * a preview): it is personal.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { OWNER_SIGN_IN_HINT, is_owner_or_preview_admin } from '@/lib/owner'
import { get_client, get_google_tokens } from '@/lib/db'
import { DRIVE_DOCUMENTS, MAX_PROFILE_CHARS, get_coach_memory } from '@/lib/coaching/memory'
import { drive_view_url } from '@/lib/google_drive'

export async function GET(request: NextRequest) {
  if (!is_owner_or_preview_admin(await getToken({ req: request }))) {
    return NextResponse.json({ error: OWNER_SIGN_IN_HINT }, { status: 403 })
  }
  try {
    const [memory, google_tokens] = await Promise.all([get_coach_memory(get_client()), get_google_tokens()])
    const documents = DRIVE_DOCUMENTS.map(d => {
      const doc = memory[d.kind]
      const drive_id = doc?.source?.startsWith('drive:') ? doc.source.slice('drive:'.length) : null
      return {
        kind: d.kind,
        label: d.label,
        name: d.name,
        loaded: doc != null,
        chars: doc?.body.length ?? 0,
        updated_at: doc?.created_at ?? null,
        versions: doc?.versions ?? 0,
        drive_url: drive_id ? drive_view_url(drive_id) : null,
        body: doc?.body ?? null,
      }
    })
    const profile = memory.profile
    return NextResponse.json({
      drive_connected: google_tokens != null,
      documents,
      profile: {
        body: profile?.body ?? '',
        is_default: profile == null,
        versions: profile?.versions ?? 0,
        updated_at: profile?.created_at ?? null,
        max_chars: MAX_PROFILE_CHARS,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
