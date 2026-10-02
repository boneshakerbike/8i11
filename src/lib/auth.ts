/**
 * NextAuth configuration
 * Supports GitHub OAuth, guest PIN, and admin PIN (preview only) authentication
 */

import { NextAuthOptions } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';
import CredentialsProvider from 'next-auth/providers/credentials';
import { allowed_github_users } from '@/lib/owner';

export const auth_options: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
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
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
};
