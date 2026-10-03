/**
 * NextAuth configuration
 * Supports GitHub OAuth, guest PIN, and admin PIN (preview only) authentication
 */

import { NextAuthOptions } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';
import CredentialsProvider from 'next-auth/providers/credentials';
import { allowed_github_users } from '@/lib/owner';

/** Timeout for OAuth calls to GitHub. See the GitHubProvider comment below. */
const OAUTH_HTTP_TIMEOUT_MS = 10_000;

/**
 * Unwraps the error NextAuth reports so the underlying cause reaches the logs.
 * NextAuth wraps OAuth failures in an OAuthCallbackError whose own message is
 * often all that gets printed; openid-client's RPError carries the useful
 * detail (HTTP status and provider response body) on nested properties.
 */
function describe_auth_error(metadata: unknown): Record<string, unknown> {
  const error = (metadata as { error?: unknown })?.error ?? metadata;
  const e = error as {
    name?: string;
    message?: string;
    stack?: string;
    response?: { status?: number; body?: unknown };
    cause?: { message?: string };
  };
  return {
    name: e?.name,
    message: e?.message,
    cause: e?.cause?.message,
    status: e?.response?.status,
    body: e?.response?.body,
    stack: e?.stack,
  };
}

export const auth_options: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
      // GitHub now returns an `iss` parameter on the OAuth callback (RFC 9207).
      // openid-client validates it against the issuer, and next-auth v4's GitHub
      // provider never set one, so the check threw
      // "issuer must be configured on the issuer" and every sign-in failed with
      // ?error=OAuthCallback. GitHub's issuer identifier is the full
      // https://github.com/login/oauth, not the bare origin; the bare origin
      // trades that TypeError for "iss mismatch".
      issuer: 'https://github.com/login/oauth',
      // openid-client defaults to a 3500ms timeout for every outgoing call.
      // The GitHub callback makes two of them back to back (token exchange,
      // then api.github.com/user), and on a cold serverless function either
      // can exceed that, aborting the whole callback with ?error=OAuthCallback
      // after the user has already authorised on GitHub.
      httpOptions: { timeout: OAUTH_HTTP_TIMEOUT_MS },
    }),
    CredentialsProvider({
      id: 'guest-pin',
      name: 'Guest PIN',
      credentials: {
        pin: { label: 'PIN', type: 'password' },
      },
      async authorize(credentials) {
        // Support multiple PINs: GUEST_PINS=pin1,pin2,pin3 or legacy GUEST_PIN=pin
        const guest_pins = process.env.GUEST_PINS?.split(',').map(p => p.trim()) || [];
        const legacy_pin = process.env.GUEST_PIN;
        if (legacy_pin) guest_pins.push(legacy_pin);

        if (guest_pins.length === 0) {
          return null;
        }

        if (credentials?.pin && guest_pins.includes(credentials.pin)) {
          return {
            id: 'guest',
            name: 'Guest',
            email: 'guest@onthisday.local',
          };
        }

        return null;
      },
    }),
    CredentialsProvider({
      id: 'admin-pin',
      name: 'Admin PIN',
      credentials: {
        pin: { label: 'Admin PIN', type: 'password' },
      },
      async authorize(credentials) {
        // Admin PIN only works in Vercel preview environments
        if (process.env.VERCEL_ENV !== 'preview') {
          return null;
        }

        const admin_pin = process.env.ADMIN_PIN;
        if (!admin_pin) {
          return null;
        }

        if (credentials?.pin && credentials.pin === admin_pin) {
          return {
            id: 'admin-preview',
            name: 'Admin (Preview)',
            email: 'admin@onthisday.local',
          };
        }

        return null;
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async signIn({ account, profile }) {
      // Allow guests with valid PIN
      if (account?.provider === 'guest-pin') {
        return true;
      }

      // Allow admin PIN in preview environments
      if (account?.provider === 'admin-pin') {
        return true;
      }

      // Restrict GitHub login to allowed users by unique login (not display name)
      // Set ALLOWED_GITHUB_USERS=user1,user2 in env, or defaults to boneshakerbike
      // (blank or comma-only falls back to the default; see lib/owner.ts)
      const allowed_users = allowed_github_users();

      if (account?.provider === 'github') {
        const login = (profile as { login?: string })?.login ?? '';
        if (!allowed_users.includes(login)) {
          console.log(`GitHub login denied for: ${login}`);
          return false;
        }
      }

      return true;
    },
    async jwt({ token, account, profile }) {
      // Record how the session signed in. Owner-only features (see lib/owner.ts)
      // require provider 'github' plus an allowed login, so guest and admin PIN
      // sessions can never reach them.
      if (account) {
        token.provider = account.provider;
        if (account.provider === 'github') {
          token.login = (profile as { login?: string })?.login ?? '';
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Add user info to session
      if (token.sub) {
        session.user = session.user ?? {};
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
  },
  logger: {
    error(code, metadata) {
      console.error(`[next-auth][error][${code}]`, JSON.stringify(describe_auth_error(metadata)));
    },
    warn(code) {
      console.warn(`[next-auth][warn][${code}]`);
    },
    debug() {},
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
};
