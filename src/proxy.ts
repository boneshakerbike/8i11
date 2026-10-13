/**
 * Proxy to protect routes (Next.js 16+)
 * Redirects unauthenticated users to login page
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { safe_callback_url } from '@/lib/safe_callback';
import { is_cron_authorized, is_cron_path } from '@/lib/cron_auth';

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Vercel cron has no session cookie, so it was redirected to /login and the
  // daily trends job never reached its route. The route checks the secret again.
  if (is_cron_path(path) && is_cron_authorized(request.headers.get('authorization'))) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request });

  // /login is public, but a visitor who is already signed in goes straight on
  // to their callbackUrl instead of seeing the form again. This uses the same
  // getToken check as the protected routes, so the two cannot disagree and loop.
  if (path === '/login') {
    if (!token) return NextResponse.next();
    const target = safe_callback_url(request.nextUrl.searchParams.get('callbackUrl'), request.nextUrl.origin);
    return NextResponse.redirect(target);
  }

  if (!token) {
    const login_url = new URL('/login', request.url);
    login_url.searchParams.set('callbackUrl', request.url);
    return NextResponse.redirect(login_url);
  }

  // The coach (/coach, /health Today, /health/trends, /api/coaching/*) is
  // admin-only (non-guest). Guests opening Health land on the Oura page.
  const is_coach = path === '/coach' || path.startsWith('/coach/') || path.startsWith('/api/coaching')
    || path === '/health' || path === '/health/trends';
  if (is_coach && token.sub === 'guest') {
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }
    return NextResponse.redirect(new URL(path.startsWith('/health') ? '/health/oura' : '/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Protect all routes except login, story, archive, games, weather, privacy, terms, api/auth, api/health, api/stories, api/prompts, api/oura, the web app manifest and its icons, and static files.
  // /login is matched separately so signed-in visitors can be sent on (see above).
  matcher: [
    '/login',
    '/((?!login|story|archive|creative/archive|games|weather|privacy|terms|api/auth|api/health|api/stories|api/prompts|api/oura|manifest.webmanifest|icons/|_next/static|_next/image|favicon.ico|icon.svg).*)',
  ],
};
