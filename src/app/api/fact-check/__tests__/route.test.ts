import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getToken = vi.fn();
vi.mock('next-auth/jwt', () => ({ getToken: (...args: unknown[]) => getToken(...args) }));

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', async importOriginal => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic {
    static APIConnectionTimeoutError = actual.default.APIConnectionTimeoutError;
    beta = { messages: { create: (...args: unknown[]) => create(...args) } };
  }
  return { default: FakeAnthropic };
});

import { POST } from '@/app/api/fact-check/route';
import { MAX_CONTINUATIONS, SUBMIT_TOOL } from '@/lib/fact_check';

const TEXT = 'The Titanic sank in 1913. I loved the museum.';
const URL = 'https://example.org/titanic';

const post = (body: unknown) => POST(new NextRequest('https://8i11.vercel.app/api/fact-check', {
  method: 'POST',
  body: JSON.stringify(body),
}));

const message = (content: unknown[], stop_reason: string, searches = 0) => ({
  content,
  stop_reason,
  usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: searches, web_fetch_requests: 0 } },
});

const search = [
  { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'Titanic sinking year' } },
  {
    type: 'web_search_tool_result',
    tool_use_id: 'srv_1',
    content: [{ type: 'web_search_result', url: URL, title: 'Titanic', encrypted_content: 'x', page_age: null }],
  },
];

const submit = (findings: unknown[]) => ({ type: 'tool_use', id: 'tu_1', name: SUBMIT_TOOL, input: { findings } });

const wrong_year = {
  claim: 'The Titanic sank in 1913.',
  verdict: 'wrong',
  original: '1913',
  replacement: '1912',
  explanation: 'It sank in April 1912.',
  sources: [{ url: URL, title: 'Titanic' }],
};

describe('POST /api/fact-check', () => {
  beforeEach(() => {
    getToken.mockReset();
    create.mockReset();
    getToken.mockResolvedValue({ provider: 'github', login: 'boneshakerbike' });
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  });

  it('refuses a request with no session and no guest PIN', async () => {
    getToken.mockResolvedValue(null);
    const res = await post({ content: TEXT });
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses text over the size cap before calling the model', async () => {
    const res = await post({ content: 'x'.repeat(20001) });
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('applies only fixes backed by a search result and never retries the request', async () => {
    const invented = { ...wrong_year, claim: 'The museum is in Paris.', original: 'museum', replacement: 'gallery', sources: [{ url: 'https://made-up.example', title: 'x' }] };
    create.mockResolvedValue(message([
      { type: 'thinking', thinking: '', signature: 's' },
      ...search,
      { type: 'text', text: 'Done.', citations: null },
      submit([wrong_year, invented]),
    ], 'tool_use', 1));

    const res = await post({ content: TEXT });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.fixed).toBe('The Titanic sank in 1912. I loved the museum.');
    expect(data.findings.map((f: { status: string }) => f.status)).toEqual(['fixed', 'unverified']);
    expect(data.usage).toEqual({ input_tokens: 100, output_tokens: 20, searches: 1 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1]).toMatchObject({ maxRetries: 0 });
  });

  it('resumes a paused turn by sending its content back unchanged', async () => {
    create
      .mockResolvedValueOnce(message(search, 'pause_turn', 1))
      .mockResolvedValueOnce(message([submit([wrong_year])], 'tool_use', 2));

    const res = await post({ content: TEXT });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.fixed).toBe('The Titanic sank in 1912. I loved the museum.');
    expect(data.usage.searches).toBe(3);

    const second = create.mock.calls[1][0];
    expect(second.messages).toHaveLength(2);
    expect(second.messages[1]).toEqual({ role: 'assistant', content: search });
  });

  it(`stops after ${MAX_CONTINUATIONS} continuations and reports it didn't finish`, async () => {
    create.mockResolvedValue(message(search, 'pause_turn', 1));
    const res = await post({ content: TEXT });
    expect(res.status).toBe(502);
    expect(create).toHaveBeenCalledTimes(MAX_CONTINUATIONS + 1);
  });

  it('reports a refusal', async () => {
    create.mockResolvedValue(message([], 'refusal'));
    const res = await post({ content: TEXT });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/declined/);
  });

  it('reports a reply that never called the submit tool', async () => {
    create.mockResolvedValue(message([{ type: 'text', text: 'All good.', citations: null }], 'end_turn'));
    const res = await post({ content: TEXT });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/didn't finish/);
  });
});
