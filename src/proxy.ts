/**
 * Proxy to protect routes (Next.js 16+)
 * Redirects unauthenticated users to login page
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { safe_callback_url } from '@/lib/safe_callback';

export async function proxy(request: NextRequest) {
  const token = await getToken({ req: request });
  const path = request.nextUrl.pathname;

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

  // /coach and /api/coaching/* are admin-only (non-guest).
  const is_coach = path === '/coach' || path.startsWith('/coach/') || path.startsWith('/api/coaching');
  if (is_coach && token.sub === 'guest') {
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Protect all routes except login, story, archive, games, weather, privacy, terms, api/auth, api/health, api/stories, api/prompts, api/oura, api/coros, the web app manifest and its icons, and static files.
  // /login is matched separately so signed-in visitors can be sent on (see above).
  matcher: [
    '/login',
    '/((?!login|story|archive|creative/archive|games|weather|privacy|terms|api/auth|api/health|api/stories|api/prompts|api/oura|api/coros|manifest.webmanifest|icons/|_next/static|_next/image|favicon.ico|icon.svg).*)',
  ],
};
