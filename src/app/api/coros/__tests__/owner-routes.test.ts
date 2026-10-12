import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getToken = vi.fn();
vi.mock('next-auth/jwt', () => ({ getToken: (...args: unknown[]) => getToken(...args) }));

import { GET as authorize } from '@/app/api/coros/authorize/route';
import { POST as sync } from '@/app/api/coros/sync/route';
import { OWNER_SIGN_IN_HINT } from '@/lib/owner';

describe('COROS routes refuse a non-owner with a next step, not raw JSON', () => {
  beforeEach(() => getToken.mockReset());

  it('sends a session without the GitHub markers back to the COROS page with the hint', async () => {
    // A GitHub session from before provider/login were recorded
    getToken.mockResolvedValue({ name: 'Bill', sub: '8163079' });
    const res = await authorize(new NextRequest('https://8i11.vercel.app/api/coros/authorize'));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname).toBe('/health/coros');
    expect(location.searchParams.get('error')).toBe(OWNER_SIGN_IN_HINT);
  });

  it('answers Sync now with the same hint', async () => {
    getToken.mockResolvedValue({ provider: 'guest-pin', sub: 'guest' });
    const res = await sync(new NextRequest('https://8i11.vercel.app/api/coros/sync', { method: 'POST' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: OWNER_SIGN_IN_HINT });
  });
});
