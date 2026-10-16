import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, dynamic } from '@/app/api/claude-status/route';

describe('GET /api/claude-status', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is never prerendered or cached at build time', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('answers with the summarized status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: { indicator: 'none' },
      components: [{ id: 'api', name: 'Claude API (api.anthropic.com)', status: 'degraded_performance' }],
      incidents: [],
    }), { status: 200 })));

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ level: 'issue', label: 'Claude API: Degraded performance' });
  });

  it('still answers 200 when the status page is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ level: 'unknown', label: 'Claude API: Status unavailable' });
  });
});
