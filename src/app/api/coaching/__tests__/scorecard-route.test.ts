import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getToken = vi.fn();
vi.mock('next-auth/jwt', () => ({ getToken: (...args: unknown[]) => getToken(...args) }));

import { GET as scorecard } from '@/app/api/coaching/scorecard/route';
import { OWNER_SIGN_IN_HINT } from '@/lib/owner';

describe('GET /api/coaching/scorecard', () => {
  beforeEach(() => getToken.mockReset());

  it('refuses anyone but the owner, since it includes weight', async () => {
    for (const token of [null, { provider: 'guest-pin', sub: 'guest' }, { name: 'Bill', sub: '8163079' }]) {
      getToken.mockResolvedValue(token);
      const res = await scorecard(new NextRequest('https://8i11.vercel.app/api/coaching/scorecard'));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: OWNER_SIGN_IN_HINT });
    }
  });
});
