/**
 * Who counts as the site owner.
 *
 * GitHub sign-in is already restricted to ALLOWED_GITHUB_USERS in auth.ts, so a
 * GitHub session is the owner. Guest PIN and admin-preview PIN sessions are not:
 * owner-only features (writing to Google Drive) check this allow-list rather than
 * blocking known guest ids, so a sign-in method added later fails closed.
 */

export function allowed_github_users(): string[] {
  // A blank or comma-only ALLOWED_GITHUB_USERS must fall back to the default
  // rather than producing [''] and denying every login.
  const configured = process.env.ALLOWED_GITHUB_USERS?.split(',')
    .map(u => u.trim())
    .filter(Boolean) ?? [];
  return configured.length > 0 ? configured : ['boneshakerbike'];
}

/** True only for a session that signed in with GitHub as an allowed login. */
export function is_owner_token(token: Record<string, unknown> | null | undefined): boolean {
  if (!token) return false;
  if (token.provider !== 'github') return false;
  if (typeof token.login !== 'string' || !token.login) return false;
  return allowed_github_users().includes(token.login);
}

/**
 * The owner, or the Admin PIN session on a Vercel preview deployment.
 *
 * GitHub sign-in cannot return to a preview URL, so owner-only features are
 * tested there with the Admin PIN (auth.ts accepts it only on previews). This
 * checks VERCEL_ENV again so a stray admin-pin token never counts in production.
 * Use it only where testing on a preview is the point; is_owner_token stays the
 * default.
 */
export function is_owner_or_preview_admin(
  token: Record<string, unknown> | null | undefined,
  vercel_env = process.env.VERCEL_ENV,
): boolean {
  if (is_owner_token(token)) return true;
  return vercel_env === 'preview' && token?.provider === 'admin-pin';
}
