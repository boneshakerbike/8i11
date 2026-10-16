import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetch_claude_status,
  parse_claude_status_response,
  summarize_claude_status,
} from '../claude_status';

const API = 'Claude API (api.anthropic.com)';

const component = (name: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ id: `id-${name}`, name, status, group: false, ...extra });

const others = [component('claude.ai', 'operational'), component('Claude Code', 'operational')];

const summary = (
  components: unknown[],
  { indicator = 'none', incidents = [] as unknown[] }: { indicator?: string; incidents?: unknown[] } = {},
) => ({
  page: { id: 'p', name: 'Claude', url: 'https://status.claude.com' },
  status: { indicator, description: 'whatever' },
  components,
  incidents,
  scheduled_maintenances: [],
});

const incident = (component_ids: string[] | undefined, status = 'investigating') => ({
  id: 'inc-1',
  name: 'Elevated errors',
  status,
  impact: 'minor',
  ...(component_ids === undefined ? {} : { components: component_ids.map(id => ({ id, name: id })) }),
});

const UNAVAILABLE_VIEW = { level: 'unknown', label: 'Claude API: Status unavailable' };

describe('summarize_claude_status: the API component', () => {
  it.each([
    ['operational', 'ok', 'Claude API: Operational'],
    ['under_maintenance', 'issue', 'Claude API: Under maintenance'],
    ['degraded_performance', 'issue', 'Claude API: Degraded performance'],
    ['partial_outage', 'issue', 'Claude API: Partial outage'],
    ['major_outage', 'issue', 'Claude API: Major outage'],
  ])('%s -> %s', (status, level, label) => {
    const result = summarize_claude_status(summary([...others, component(API, status)]));
    expect(result.level).toBe(level);
    expect(result.label).toBe(label);
  });

  it('reads an unrecognized status as unavailable, not green', () => {
    expect(summarize_claude_status(summary([component(API, 'mostly_fine')]))).toMatchObject(UNAVAILABLE_VIEW);
  });

  it('lets a known outage beat an unrecognized status', () => {
    const result = summarize_claude_status(summary([
      component(API, 'mostly_fine'),
      component('Claude API (batch)', 'major_outage'),
    ]));
    expect(result).toMatchObject({ level: 'issue', label: 'Claude API: Major outage' });
  });

  it('uses the worst of several matching components', () => {
    const result = summarize_claude_status(summary([
      component(API, 'operational'),
      component('Claude API (batch)', 'partial_outage'),
      component('Claude API (files)', 'degraded_performance'),
    ]));
    expect(result).toMatchObject({ level: 'issue', label: 'Claude API: Partial outage' });
    expect(result.matched.map(m => m.name)).toEqual([API, 'Claude API (batch)', 'Claude API (files)']);
  });

  it('matches a group component too', () => {
    const result = summarize_claude_status(summary([component('Claude API', 'partial_outage', { group: true })]));
    expect(result).toMatchObject({ level: 'issue', label: 'Claude API: Partial outage' });
  });

  it('ignores claude.ai, Claude Code, and the console', () => {
    const result = summarize_claude_status(summary([
      component(API, 'operational'),
      component('claude.ai', 'major_outage'),
      component('Claude Code', 'major_outage'),
      component('platform.claude.com', 'major_outage'),
    ]));
    expect(result).toMatchObject({ level: 'ok', label: 'Claude API: Operational' });
  });
});

describe('summarize_claude_status: open incidents', () => {
  it('turns red when an incident names the API while it still says operational', () => {
    const result = summarize_claude_status(summary(
      [...others, component(API, 'operational')],
      { incidents: [incident([`id-${API}`])] },
    ));
    expect(result).toMatchObject({ level: 'issue', label: 'Claude API: Incident reported' });
    expect(result.incidents).toEqual([
      { id: 'inc-1', name: 'Elevated errors', status: 'investigating', component_ids: [`id-${API}`] },
    ]);
  });

  it('stays green when the incident names only another service', () => {
    const result = summarize_claude_status(summary(
      [...others, component(API, 'operational')],
      { incidents: [incident(['id-claude.ai'])] },
    ));
    expect(result).toMatchObject({ level: 'ok', label: 'Claude API: Operational' });
  });

  it('turns red for an incident that names no components', () => {
    for (const ids of [[], undefined]) {
      const result = summarize_claude_status(summary([component(API, 'operational')], { incidents: [incident(ids)] }));
      expect(result).toMatchObject({ level: 'issue', label: 'Claude API: Incident reported' });
    }
  });

  it('stays red through the monitoring phase', () => {
    const result = summarize_claude_status(summary(
      [component(API, 'operational')],
      { incidents: [incident([`id-${API}`], 'monitoring')] },
    ));
    expect(result.level).toBe('issue');
  });

  it('ignores resolved incidents', () => {
    const result = summarize_claude_status(summary(
      [component(API, 'operational')],
      { incidents: [incident([`id-${API}`], 'resolved'), incident([], 'postmortem')] },
    ));
    expect(result.level).toBe('ok');
  });

  it('skips the incident check when incidents are missing', () => {
    const data: Record<string, unknown> = summary([component(API, 'operational')]);
    delete data.incidents;
    expect(summarize_claude_status(data).level).toBe('ok');
  });

  it('names the component outage rather than the incident when both apply', () => {
    const result = summarize_claude_status(summary(
      [component(API, 'partial_outage')],
      { incidents: [incident([`id-${API}`])] },
    ));
    expect(result.label).toBe('Claude API: Partial outage');
  });
});

describe('summarize_claude_status: fallback to the overall indicator', () => {
  it.each([
    ['none', 'ok', 'Claude overall: Operational'],
    ['minor', 'issue', 'Claude overall: Minor issues'],
    ['major', 'issue', 'Claude overall: Major issues'],
    ['critical', 'issue', 'Claude overall: Critical outage'],
    ['maintenance', 'issue', 'Claude overall: Under maintenance'],
  ])('indicator %s -> %s', (indicator, level, label) => {
    const result = summarize_claude_status(summary(others, { indicator }));
    expect(result).toMatchObject({ level, label, matched: [] });
  });

  it('reads an unrecognized indicator as unavailable', () => {
    for (const indicator of ['purple', 'constructor', '']) {
      expect(summarize_claude_status(summary(others, { indicator }))).toMatchObject(UNAVAILABLE_VIEW);
    }
  });

  it('reads a missing status object as unavailable', () => {
    const data: Record<string, unknown> = summary(others);
    delete data.status;
    expect(summarize_claude_status(data)).toMatchObject(UNAVAILABLE_VIEW);
  });
});

describe('summarize_claude_status: malformed input', () => {
  it.each([
    ['null', null],
    ['a string', '<html>login</html>'],
    ['an array', []],
    ['an empty object', {}],
    ['components that are not a list', { components: 'API' }],
  ])('reads %s as unavailable', (_name, input) => {
    expect(summarize_claude_status(input)).toMatchObject(UNAVAILABLE_VIEW);
  });

  it('skips junk entries in the component list', () => {
    const result = summarize_claude_status(summary([null, 'API', 7, component(API, 'operational')]));
    expect(result.level).toBe('ok');
  });
});

describe('parse_claude_status_response', () => {
  it.each([
    ['null', null],
    ['the login page', '<!DOCTYPE html><html>'],
    ['an empty object', {}],
    ['a wrong-case level', { level: 'OK', label: 'Claude API: Operational' }],
    ['an empty label', { level: 'ok', label: '  ' }],
    ['a non-string label', { level: 'ok', label: 5 }],
  ])('reads %s as unavailable', (_name, input) => {
    expect(parse_claude_status_response(input)).toEqual(UNAVAILABLE_VIEW);
  });

  it('passes a valid answer through and drops the debug fields', () => {
    expect(parse_claude_status_response({
      level: 'issue',
      label: 'Claude API: Partial outage',
      matched: [{ id: 'x', name: API, status: 'partial_outage' }],
      incidents: [],
    })).toEqual({ level: 'issue', label: 'Claude API: Partial outage' });
    expect(parse_claude_status_response({ level: 'ok', label: 'Claude API: Operational' }))
      .toEqual({ level: 'ok', label: 'Claude API: Operational' });
  });
});

describe('fetch_claude_status', () => {
  const ok_summary = summary([...others, component(API, 'operational')]);
  const json_response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  // Settles only when the request is aborted, like a hung connection.
  const until_aborted = (signal: AbortSignal | null | undefined) =>
    new Promise<never>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });

  let error_spy: ReturnType<typeof vi.spyOn>;
  let warn_spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    error_spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads the summary fresh, never from a cache', async () => {
    const fetch_mock = vi.fn<typeof fetch>(async () => json_response(ok_summary));
    vi.stubGlobal('fetch', fetch_mock);

    const result = await fetch_claude_status();

    expect(result).toMatchObject({ level: 'ok', label: 'Claude API: Operational' });
    const [url, init] = fetch_mock.mock.calls[0];
    expect(url).toBe('https://status.claude.com/api/v2/summary.json');
    expect(init?.cache).toBe('no-store');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(error_spy).not.toHaveBeenCalled();
  });

  it('is unavailable when the status page answers with an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json_response({ error: 'down' }, 503)));
    expect(await fetch_claude_status()).toMatchObject(UNAVAILABLE_VIEW);
    expect(error_spy).toHaveBeenCalled();
  });

  it('is unavailable when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await fetch_claude_status()).toMatchObject(UNAVAILABLE_VIEW);
  });

  it('is unavailable when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>maintenance</html>', { status: 200 })));
    expect(await fetch_claude_status()).toMatchObject(UNAVAILABLE_VIEW);
  });

  it('gives up on a request that hangs', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => until_aborted(init?.signal)));
    expect(await fetch_claude_status(20)).toMatchObject(UNAVAILABLE_VIEW);
  });

  it('gives up on a body that stalls after the headers arrive', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      ({ ok: true, status: 200, json: () => until_aborted(init?.signal) }) as unknown as Response));
    expect(await fetch_claude_status(20)).toMatchObject(UNAVAILABLE_VIEW);
  });

  it('logs a warning when it has to fall back to the overall indicator', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json_response(summary(others, { indicator: 'minor' }))));
    expect(await fetch_claude_status()).toMatchObject({ level: 'issue', label: 'Claude overall: Minor issues' });
    expect(warn_spy).toHaveBeenCalled();
  });
});
