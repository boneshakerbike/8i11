/**
 * API route: GET /api/google/authorize
 * Redirects the owner to Google's consent screen for Drive access
 */

import { NextRequest, NextResponse } from 'next/server';
import { DRIVE_SCOPE, google_redirect_uri, require_owner } from '@/lib/google_auth';

export async function GET(request: NextRequest) {
  const auth_error = await require_owner(request);
  if (auth_error) return auth_error;

  const client_id = process.env.GOOGLE_CLIENT_ID;
  if (!client_id || !process.env.GOOGLE_REDIRECT_URI) {
    return NextResponse.json({ error: 'Google OAuth is not configured' }, { status: 500 });
  }

  // Generate CSRF state
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const params = new URLSearchParams({
    client_id,
    redirect_uri: google_redirect_uri(),
    response_type: 'code',
    scope: DRIVE_SCOPE,
    // offline + consent so Google always returns a refresh token
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  response.cookies.set('google_state', state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    maxAge: 600,
    path: '/',
    sameSite: 'lax',
  });

  return response;
}
