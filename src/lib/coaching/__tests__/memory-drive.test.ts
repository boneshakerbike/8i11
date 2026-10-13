import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';

const get_google_access_token = vi.fn();
vi.mock('@/lib/google_auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/google_auth')>('@/lib/google_auth');
  return { ...actual, get_google_access_token: (...args: unknown[]) => get_google_access_token(...args) };
});

import { refresh_coach_memory } from '@/lib/coaching/memory-drive';
import { GoogleNotConnectedError } from '@/lib/google_auth';

describe('refresh_coach_memory messages', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    get_google_access_token.mockReset();
  });

  it('says Drive works on the live site only when Google settings are missing (a preview)', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    const result = await refresh_coach_memory(createClient({ url: ':memory:' }));
    expect(result).toEqual({ ok: false, detail: 'Google Drive works on the live site only (8i11.vercel.app): refresh there; the coach keeps using the last copy' });
    expect(get_google_access_token).not.toHaveBeenCalled();
  });

  it('points to Connect Google Drive only when the connection is missing', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    get_google_access_token.mockRejectedValueOnce(new GoogleNotConnectedError());
    expect((await refresh_coach_memory(createClient({ url: ':memory:' }))).detail)
      .toBe('Google Drive is not connected: press Connect Google Drive on the Coach memory page; the coach keeps using the last copy');

    get_google_access_token.mockRejectedValueOnce(new Error('Google token refresh failed: 500'));
    expect((await refresh_coach_memory(createClient({ url: ':memory:' }))).detail)
      .toBe('Google Drive could not be reached (Google token refresh failed: 500); the coach keeps using the last copy');
  });
});
