/**
 * Vercel cron requests carry no session cookie, only
 * `Authorization: Bearer $CRON_SECRET`. The proxy lets a cron path through on
 * that header alone, and the route checks it again.
 */

/** Paths Vercel cron calls (vercel.json). Exact matches only. */
export const CRON_PATHS = ['/api/coaching/trends'] as const;

/** True when the request carries the cron secret. Fails closed if CRON_SECRET is unset. */
export function is_cron_authorized(authorization: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  return authorization === `Bearer ${secret}`;
}

export function is_cron_path(path: string): boolean {
  return (CRON_PATHS as readonly string[]).includes(path);
}
