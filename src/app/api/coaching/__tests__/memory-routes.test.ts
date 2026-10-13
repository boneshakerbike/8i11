import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getToken = vi.fn();
vi.mock('next-auth/jwt', () => ({ getToken: (...args: unknown[]) => getToken(...args) }));

import { GET as read_memory } from '@/app/api/coaching/memory/route';
import { POST as refresh } from '@/app/api/coaching/memory/refresh/route';
import { PUT as save_profile } from '@/app/api/coaching/memory/profile/route';
import { OWNER_SIGN_IN_HINT } from '@/lib/owner';

const BASE = 'https://8i11.vercel.app/api/coaching/memory';

describe('coach memory routes are owner only (the profile is personal)', () => {
  beforeEach(() => getToken.mockReset());

  for (const token of [null, { provider: 'guest-pin', sub: 'guest' }, { name: 'Bill', sub: '8163079' }]) {
    it(`refuses ${token ? JSON.stringify(token) : 'no session'}`, async () => {
      getToken.mockResolvedValue(token);
      const responses = [
        await read_memory(new NextRequest(BASE)),
        await refresh(new NextRequest(`${BASE}/refresh`, { method: 'POST' })),
        await save_profile(new NextRequest(`${BASE}/profile`, { method: 'PUT', body: JSON.stringify({ body: 'x' }) })),
      ];
      for (const res of responses) {
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: OWNER_SIGN_IN_HINT });
      }
    });
  }
});
