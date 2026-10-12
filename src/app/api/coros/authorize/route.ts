/**
 * API route: GET /api/coros/authorize
 * Starts the COROS MCP sign-in: discovery, client registration, PKCE, then a
 * redirect to COROS. Owner only (or the Admin PIN on a preview).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { is_owner_or_preview_admin } from '@/lib/owner';
import { describe_coros_error, start_coros_authorization } from '@/lib/coros/mcp-client';

const PAGE = '/health/coros/mcp';

export async function GET(request: NextRequest) {
  if (!is_owner_or_preview_admin(await getToken({ req: request }))) {
    return NextResponse.json({ error: 'Owner only' }, { status: 403 });
  }

  const origin = request.nextUrl.origin;
  const state = crypto.randomUUID().replaceAll('-', '');

  try {
    const result = await start_coros_authorization(origin, state);
    if ('authorized' in result) return NextResponse.redirect(`${origin}${PAGE}?connected=1`);

    const response = NextResponse.redirect(result.authorization_url);
    response.cookies.set('coros_state', state, {
      httpOnly: true,
      secure: request.nextUrl.protocol === 'https:',
      maxAge: 600,
      path: '/api/coros',
      sameSite: 'lax',
    });
    return response;
  } catch (err) {
    console.error('COROS authorize failed:', describe_coros_error(err));
    return NextResponse.redirect(`${origin}${PAGE}?error=${encodeURIComponent(describe_coros_error(err))}`);
  }
}
