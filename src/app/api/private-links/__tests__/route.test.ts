import { beforeEach, describe, expect, it, vi } from 'vitest';

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }));
vi.mock('@/lib/auth', () => ({ auth_options: {} }));

import { GET, dynamic } from '@/app/api/private-links/route';
import { PRIVATE_LINKS } from '@/lib/private_links';

describe('GET /api/private-links', () => {
  beforeEach(() => getServerSession.mockReset());

  it('is never prerendered or cached at build time', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  for (const session of [null, { user: { id: 'guest', name: 'Guest' } }]) {
    it(`refuses ${session ? 'a guest' : 'no session'} without sending any address`, async () => {
      getServerSession.mockResolvedValue(session);
      const res = await GET();
      expect(res.status).toBe(403);
      const text = await res.text();
      expect(text).not.toContain('barely-os');
      expect(text).not.toContain('100.93.219.51');
    });
  }

  it('gives an admin the links, uncached', async () => {
    getServerSession.mockResolvedValue({ user: { id: '8163079', name: 'Bill' } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ links: PRIVATE_LINKS });
  });
});

describe('PRIVATE_LINKS', () => {
  it('has Barely OS with its backup address and hint', () => {
    const barely = PRIVATE_LINKS.find(l => l.label === 'Barely OS');
    expect(barely).toMatchObject({
      href: 'http://barely-os:8080',
      backup_href: 'http://100.93.219.51:8080',
    });
    expect(barely?.help).toHaveLength(3);
  });
});
