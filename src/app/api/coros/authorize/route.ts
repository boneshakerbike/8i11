/**
 * API route: GET /api/coros/authorize
 * Starts the COROS MCP sign-in: discovery, client registration, PKCE, then a
 * redirect to COROS. Owner only (or the Admin PIN on a preview).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { OWNER_SIGN_IN_HINT, is_owner_or_preview_admin } from '@/lib/owner';
import { coros_origin, describe_coros_error, start_coros_authorization } from '@/lib/coros/mcp-client';

const PAGE = '/health/coros';

export async function GET(request: NextRequest) {
  // A browser navigation, so answer with the page and a next step, not raw JSON
  if (!is_owner_or_preview_admin(await getToken({ req: request }))) {
    return NextResponse.redirect(`${request.nextUrl.origin}${PAGE}?error=${encodeURIComponent(OWNER_SIGN_IN_HINT)}`);
  }

  // Production always connects under its fixed domain (see coros_origin), so the
  // state cookie must be set there too.
  const origin = coros_origin(request.nextUrl.origin);
  if (origin !== request.nextUrl.origin) return NextResponse.redirect(`${origin}/api/coros/authorize`);

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
