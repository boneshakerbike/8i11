/**
 * API route: GET /api/coros/callback
 * COROS redirects here after sign-in. Checks the CSRF state, then exchanges the
 * code for tokens. Errors are shown on the test page, never swallowed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { is_owner_or_preview_admin } from '@/lib/owner';
import { describe_coros_error, finish_coros_authorization } from '@/lib/coros/mcp-client';

const PAGE = '/health/coros/mcp';

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const back = (query: string) => {
    const response = NextResponse.redirect(`${origin}${PAGE}?${query}`);
    response.cookies.set('coros_state', '', { path: '/api/coros', maxAge: 0 });
    return response;
  };
  const fail = (message: string) => back(`error=${encodeURIComponent(message)}`);

  if (!is_owner_or_preview_admin(await getToken({ req: request }))) return fail('Owner only');

  const params = request.nextUrl.searchParams;
  const error = params.get('error');
  if (error) return fail(`COROS returned ${error}${params.get('error_description') ? `: ${params.get('error_description')}` : ''}`);

  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return fail('COROS callback was missing code or state');

  const stored_state = request.cookies.get('coros_state')?.value;
  if (!stored_state || stored_state !== state) return fail('Sign-in state did not match. Start again.');

  try {
    await finish_coros_authorization(origin, code);
    return back('connected=1');
  } catch (err) {
    console.error('COROS callback failed:', describe_coros_error(err));
    return fail(describe_coros_error(err));
  }
}
