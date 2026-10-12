/**
 * API route: POST /api/coros/disconnect
 * Deletes this site's COROS tokens and client registration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { OWNER_SIGN_IN_HINT, is_owner_or_preview_admin } from '@/lib/owner';
import { coros_origin, disconnect_coros } from '@/lib/coros/mcp-client';

export async function POST(request: NextRequest) {
  if (!is_owner_or_preview_admin(await getToken({ req: request }))) {
    return NextResponse.json({ error: OWNER_SIGN_IN_HINT }, { status: 403 });
  }
  const removed = await disconnect_coros(coros_origin(request.nextUrl.origin));
  return NextResponse.json({ ok: true, removed });
}
