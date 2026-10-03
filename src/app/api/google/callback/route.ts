/**
 * API route: GET /api/google/callback
 * Handles the OAuth redirect from Google and stores the owner's Drive tokens
 */

import { NextRequest, NextResponse } from 'next/server';
import { save_google_tokens } from '@/lib/db';
import { DRIVE_SCOPE, google_redirect_uri, require_owner } from '@/lib/google_auth';

export async function GET(request: NextRequest) {
  // A guest must not be able to link their own Google account into the shared token row.
  const auth_error = await require_owner(request);
  if (auth_error) return auth_error;

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const back = (query: string) => {
    const response = NextResponse.redirect(`${request.nextUrl.origin}/creative/text-cleaner?${query}`);
    response.cookies.delete('google_state');
    return response;
  };

  if (error) {
    console.error('Google OAuth error:', error);
    return back(`drive_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) return back('drive_error=missing_params');

  // Validate CSRF state
  const stored_state = request.cookies.get('google_state')?.value;
  if (!stored_state || stored_state !== state) return back('drive_error=invalid_state');

  try {
    const token_res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: google_redirect_uri(),
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      }),
    });

    if (!token_res.ok) {
      console.error('Google token exchange failed:', token_res.status, await token_res.text());
      return back('drive_error=token_exchange_failed');
    }

    const data = await token_res.json();

    // Granular consent lets the box for Drive be unticked; without it nothing works.
    const granted = String(data.scope || '').split(' ');
    if (!granted.includes(DRIVE_SCOPE)) return back('drive_error=scope_not_granted');
    if (!data.refresh_token) return back('drive_error=no_refresh_token');

    await save_google_tokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3599),
      scope: data.scope,
    });

    return back('drive=connected');
  } catch (err) {
    console.error('Google callback error:', err);
    return back('drive_error=callback_failed');
  }
}
