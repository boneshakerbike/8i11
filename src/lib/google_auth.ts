/**
 * Google OAuth for the Drive knowledge feature: owner guard and access tokens.
 *
 * Only the owner (GitHub sign-in, see lib/owner.ts) may connect Drive or file
 * into it. Unlike most API routes here, the X-Guest-Pin header is never accepted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { is_owner_token } from '@/lib/owner';
import { delete_google_tokens, get_google_tokens, save_google_tokens } from '@/lib/db';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

/** null when the request is from the owner, otherwise the 403 to return. */
export async function require_owner(request: NextRequest): Promise<NextResponse | null> {
  const token = await getToken({ req: request });
  if (is_owner_token(token)) return null;
  return NextResponse.json({ error: 'Only the site owner can use Google Drive' }, { status: 403 });
}

export async function is_owner_request(request: NextRequest): Promise<boolean> {
  return is_owner_token(await getToken({ req: request }));
}

/** Drive isn't connected, or Google revoked the connection. The UI shows "Connect Drive". */
export class GoogleNotConnectedError extends Error {
  constructor(message = 'Google Drive is not connected') {
    super(message);
    this.name = 'GoogleNotConnectedError';
  }
}

export function google_redirect_uri(): string {
  const uri = process.env.GOOGLE_REDIRECT_URI;
  if (!uri) throw new Error('GOOGLE_REDIRECT_URI not configured');
  return uri;
}

/** Seconds of headroom before expiry at which we refresh early. */
const REFRESH_MARGIN = 120;

/**
 * A usable access token, refreshed ahead of expiry (or on demand when `force`,
 * after a 401). A revoked or expired grant deletes the stored tokens so the UI
 * falls back to "Connect Drive" instead of failing on every request.
 */
export async function get_google_access_token(force = false): Promise<string> {
  const tokens = await get_google_tokens();
  if (!tokens) throw new GoogleNotConnectedError();

  const now = Math.floor(Date.now() / 1000);
  if (!force && tokens.expires_at - REFRESH_MARGIN > now) return tokens.access_token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    }),
  });

  if (!res.ok) {
    const error_text = await res.text();
    if (error_text.includes('invalid_grant')) {
      await delete_google_tokens();
      throw new GoogleNotConnectedError('Google Drive access was revoked or expired. Connect Drive again.');
    }
    throw new Error(`Google token refresh failed: ${res.status} ${error_text}`);
  }

  const data = await res.json();
  // Google's refresh response doesn't include a new refresh_token; keep the old one.
  await save_google_tokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: now + (data.expires_in || 3599),
    scope: data.scope || tokens.scope,
  });
  return data.access_token;
}

/** Best-effort revoke at Google, then forget the tokens locally. */
export async function disconnect_google(): Promise<void> {
  const tokens = await get_google_tokens();
  if (tokens) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: tokens.refresh_token }),
      });
    } catch (e) {
      console.error('Google revoke failed (tokens deleted anyway):', e);
    }
  }
  await delete_google_tokens();
}
