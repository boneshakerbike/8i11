import { describe, expect, it } from 'vitest';
import { SHARE_LIMIT, fit_to_limit, within_share_limit } from '@/lib/coaching/share-limit';

const sentence = (n: number) => `Sentence number ${n} says one useful thing about today.`;
const long_text = (count: number) => Array.from({ length: count }, (_, i) => sentence(i + 1)).join(' ');

describe('fit_to_limit', () => {
  it('leaves short text alone', () => {
    expect(fit_to_limit('Ride easy today.')).toBe('Ride easy today.');
  });

  it('cuts at the last full sentence that fits', () => {
    const text = long_text(40);
    const cut = fit_to_limit(text);
    expect(cut.length).toBeLessThanOrEqual(SHARE_LIMIT);
    expect(cut.endsWith('today.')).toBe(true);
    expect(text.startsWith(cut)).toBe(true);
  });

  it('cuts at a word with "..." when there is no sentence end to keep', () => {
    const text = 'word '.repeat(400);
    const cut = fit_to_limit(text);
    expect(cut.length).toBeLessThanOrEqual(SHARE_LIMIT);
    expect(cut.endsWith('word...')).toBe(true);
  });
});

describe('within_share_limit', () => {
  it('does not call the rewrite for a reply that already fits', async () => {
    let calls = 0;
    expect(await within_share_limit('Short.', async t => { calls++; return t; })).toBe('Short.');
    expect(calls).toBe(0);
  });

  it('uses the shorter rewrite when one comes back', async () => {
    const out = await within_share_limit(long_text(40), async () => 'Ride easy, 60 minutes, HR under 120.');
    expect(out).toBe('Ride easy, 60 minutes, HR under 120.');
  });

  it('still fits when the rewrite fails or is still too long', async () => {
    const failed = await within_share_limit(long_text(40), async () => { throw new Error('down'); });
    expect(failed.length).toBeLessThanOrEqual(SHARE_LIMIT);
    const too_long = await within_share_limit(long_text(60), async () => long_text(30));
    expect(too_long.length).toBeLessThanOrEqual(SHARE_LIMIT);
    expect(too_long.endsWith('today.')).toBe(true);
  });
});
