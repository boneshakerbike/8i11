import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  apply_fixes,
  check_findings,
  CheckedFinding,
  Finding,
  MAX_FINDINGS,
  normalize_url,
  read_submission,
  seen_urls,
  SUBMIT_TOOL,
} from '@/lib/fact_check';

const blocks = (b: unknown[]) => b as Anthropic.Beta.BetaContentBlock[];

const search_result = (urls: string[]) => ({
  type: 'web_search_tool_result',
  tool_use_id: 'srv_1',
  content: urls.map(url => ({ type: 'web_search_result', url, title: url, encrypted_content: 'x', page_age: null })),
});

const finding = (over: Partial<Finding> = {}): Finding => ({
  claim: 'The Titanic sank in 1913.',
  verdict: 'wrong',
  original: '1913',
  replacement: '1912',
  explanation: 'It sank on 15 April 1912.',
  sources: [{ url: 'https://example.org/titanic', title: 'Titanic' }],
  ...over,
});

const checked = (over: Partial<CheckedFinding> = {}): CheckedFinding => ({ ...finding(over), note: null, ...over });

describe('normalize_url', () => {
  it('drops a fragment and trailing slash and trims', () => {
    expect(normalize_url('  https://example.org/a/#top ')).toBe('https://example.org/a');
  });
});

describe('seen_urls', () => {
  it('collects URLs from every search result block and skips error results', () => {
    const urls = seen_urls(blocks([
      { type: 'thinking', thinking: '', signature: 's' },
      search_result(['https://a.example/x/', 'https://b.example/y']),
      { type: 'web_search_tool_result', tool_use_id: 'srv_2', content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } },
      search_result([]),
      search_result(['https://c.example/z#frag']),
    ]));
    expect([...urls].sort()).toEqual(['https://a.example/x', 'https://b.example/y', 'https://c.example/z']);
  });
});

describe('read_submission', () => {
  it('finds the submit call after thinking, search and text blocks', () => {
    const content = blocks([
      { type: 'thinking', thinking: '', signature: 's' },
      search_result(['https://example.org/titanic']),
      { type: 'text', text: 'Checked.', citations: null },
      { type: 'tool_use', id: 't1', name: SUBMIT_TOOL, input: { findings: [finding()] } },
    ]);
    expect(read_submission(content)).toEqual([finding()]);
  });

  it('returns null when the tool was never called or the input has no findings list', () => {
    expect(read_submission(blocks([{ type: 'text', text: 'Done', citations: null }]))).toBeNull();
    expect(read_submission(blocks([{ type: 'tool_use', id: 't1', name: SUBMIT_TOOL, input: {} }]))).toBeNull();
  });

  it('drops malformed findings and keeps the rest', () => {
    const content = blocks([{
      type: 'tool_use', id: 't1', name: SUBMIT_TOOL,
      input: { findings: [finding(), { claim: 'x', verdict: 'maybe' }, null, { ...finding(), sources: 'nope' }] },
    }]);
    const result = read_submission(content);
    expect(result).toHaveLength(2);
    expect(result?.[1].sources).toEqual([]);
  });
});

describe('check_findings', () => {
  const urls = new Set(['https://example.org/titanic']);

  it('removes sources web search never returned', () => {
    const [f] = check_findings([finding({
      verdict: 'correct',
      sources: [
        { url: 'https://example.org/titanic/', title: 'Titanic' },
        { url: 'https://made-up.example/page', title: 'Invented' },
      ],
    })], urls);
    expect(f.verdict).toBe('correct');
    expect(f.sources).toEqual([{ url: 'https://example.org/titanic/', title: 'Titanic' }]);
  });

  it('drops correct or wrong to unverified when no source is left', () => {
    const fake = [{ url: 'https://made-up.example/page', title: 'Invented' }];
    const result = check_findings([finding({ sources: fake }), finding({ verdict: 'correct', sources: [] })], urls);
    expect(result.map(f => f.verdict)).toEqual(['unverified', 'unverified']);
    expect(result[0].note).toBe('No search result backed this.');
  });

  it('never keeps a source that is not a web address', () => {
    const [f] = check_findings(
      [finding({ sources: [{ url: 'javascript:alert(1)', title: 'x' }] })],
      new Set(['javascript:alert(1)']),
    );
    expect(f.sources).toEqual([]);
    expect(f.verdict).toBe('unverified');
  });

  it(`keeps at most ${MAX_FINDINGS} findings`, () => {
    expect(check_findings(Array.from({ length: 14 }, () => finding()), urls)).toHaveLength(MAX_FINDINGS);
  });
});

describe('apply_fixes', () => {
  const text = 'The Titanic sank in 1913 after hitting an iceberg. Its captain was Edward Smith.';

  it('replaces a single exact match and leaves every other character alone', () => {
    const { fixed, findings } = apply_fixes(text, [checked()]);
    expect(fixed).toBe('The Titanic sank in 1912 after hitting an iceberg. Its captain was Edward Smith.');
    expect(findings[0]).toMatchObject({ status: 'fixed', replacement: '1912', note: null });
  });

  it('reports wording that is missing or appears more than once, and changes nothing', () => {
    const { fixed, findings } = apply_fixes('In 1913, and again in 1913.', [
      checked({ original: '1913' }),
      checked({ original: 'nineteen thirteen' }),
    ]);
    expect(fixed).toBe('In 1913, and again in 1913.');
    expect(findings.map(f => f.status)).toEqual(['not_fixed', 'not_fixed']);
    expect(findings[0].note).toBe('That wording appears more than once in your text.');
    expect(findings[1].note).toBe('Couldn\'t find that exact wording in your text.');
  });

  it('skips a fix that overlaps an earlier one', () => {
    const { fixed, findings } = apply_fixes(text, [
      checked({ original: 'sank in 1913', replacement: 'sank in 1912' }),
      checked({ original: '1913 after', replacement: '1912 after' }),
    ]);
    expect(fixed).toBe(text.replace('sank in 1913', 'sank in 1912'));
    expect(findings.map(f => f.status)).toEqual(['fixed', 'not_fixed']);
    expect(findings[1].note).toBe('Overlaps another fix.');
  });

  it('applies several fixes in text order whatever order they arrive in', () => {
    const { fixed } = apply_fixes(text, [
      checked({ original: 'Edward Smith', replacement: 'Edward John Smith' }),
      checked(),
    ]);
    expect(fixed).toBe('The Titanic sank in 1912 after hitting an iceberg. Its captain was Edward John Smith.');
  });

  it('turns em dashes in a replacement into commas', () => {
    const { fixed } = apply_fixes(text, [checked({ original: 'an iceberg', replacement: 'an iceberg — at night' })]);
    expect(fixed).toContain('an iceberg, at night.');
  });

  it('labels correct and unverified claims without touching the text', () => {
    const { fixed, findings } = apply_fixes(text, [
      checked({ verdict: 'correct', original: null, replacement: null }),
      checked({ verdict: 'unverified', original: null, replacement: null }),
      checked({ original: null }),
    ]);
    expect(fixed).toBe(text);
    expect(findings.map(f => f.status)).toEqual(['correct', 'unverified', 'not_fixed']);
    expect(findings[2].note).toBe('No exact wording to replace was given.');
  });
});
