/**
 * Where to send a user who is already signed in and lands on /login.
 *
 * The proxy redirects signed-in visitors away from the login page to their
 * callbackUrl. That redirect bypasses next-auth's own redirect callback, so the
 * URL is checked here: only same-origin targets are allowed (no open redirect),
 * and a target back on /login is dropped so the redirect cannot loop.
 */

export function safe_callback_url(callback_url: string | null, origin: string): string {
  const fallback = new URL('/', origin).toString();
  if (!callback_url) return fallback;

  let target: URL;
  try {
    target = new URL(callback_url, origin);
  } catch {
    return fallback;
  }

  if (target.origin !== new URL(origin).origin) return fallback;
  if (target.pathname === '/login' || target.pathname.startsWith('/login/')) return fallback;
  return target.toString();
}
