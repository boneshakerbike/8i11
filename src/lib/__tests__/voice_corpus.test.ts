import { describe, it, expect } from 'vitest';
import {
  build_voice_block,
  exemplar_subtitles,
  exemplar_titles,
  make_seeded_rand,
  sample_voice_exemplars,
  VoiceExemplar,
} from '../voice_corpus';

const ex = (title: string, year: number, subtitle = `deck for ${title}`): VoiceExemplar =>
  ({ title, subtitle, year });

// Three posts in each of four years.
const POOL: VoiceExemplar[] = [2019, 2020, 2021, 2022].flatMap(y =>
  [1, 2, 3].map(n => ex(`Post ${y} Number ${n}`, y))
);

describe('make_seeded_rand', () => {
  it('is deterministic for a given seed', () => {
    const a = make_seeded_rand(42);
    const b = make_seeded_rand(42);
    const seq_a = [a(), a(), a(), a()];
    const seq_b = [b(), b(), b(), b()];
    expect(seq_a).toEqual(seq_b);
  });

  it('differs across seeds', () => {
    expect(make_seeded_rand(1)()).not.toBe(make_seeded_rand(2)());
  });

  it('stays in [0, 1)', () => {
    const r = make_seeded_rand(7);
    for (let i = 0; i < 200; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('sample_voice_exemplars', () => {
  it('spreads across years instead of favouring the biggest', () => {
    // 2019 has 20 posts, the others 3 each. A naive sample would be mostly 2019.
    const lopsided: VoiceExemplar[] = [
      ...Array.from({ length: 20 }, (_, i) => ex(`Heavy Year Post ${i}`, 2019)),
      ...[2020, 2021, 2022].flatMap(y => [1, 2, 3].map(n => ex(`Light ${y} Post ${n}`, y))),
    ];
    const picked = sample_voice_exemplars(lopsided, 8, make_seeded_rand(1));
    const years = new Set(picked.map(p => p.year));
    expect(years.size).toBe(4);
    expect(picked.filter(p => p.year === 2019).length).toBeLessThanOrEqual(2);
  });

  it('respects count and returns no duplicates', () => {
    const picked = sample_voice_exemplars(POOL, 5, make_seeded_rand(3));
    expect(picked).toHaveLength(5);
    expect(new Set(picked.map(p => p.title)).size).toBe(5);
  });

  it('is deterministic under a seeded rand', () => {
    const a = sample_voice_exemplars(POOL, 6, make_seeded_rand(99)).map(p => p.title);
    const b = sample_voice_exemplars(POOL, 6, make_seeded_rand(99)).map(p => p.title);
    expect(a).toEqual(b);
  });

  it('does not mutate the caller pool', () => {
    const before = POOL.length;
    sample_voice_exemplars(POOL, 6, make_seeded_rand(5));
    expect(POOL).toHaveLength(before);
  });

  it('returns the whole pool when count exceeds it', () => {
    expect(sample_voice_exemplars(POOL, 999, make_seeded_rand(2))).toHaveLength(POOL.length);
  });

  it('dedupes by normalized title', () => {
    const dupes = [ex('Same Title Here', 2019), ex('same title here!', 2020), ex('Other One', 2021)];
    expect(sample_voice_exemplars(dupes, 10, make_seeded_rand(1))).toHaveLength(2);
  });

  it('drops pairs missing either half — RSS rows have no subtitle', () => {
    const partial = [ex('Has Both Halves', 2019), { title: 'No Subtitle Here', subtitle: '', year: 2020 }];
    const picked = sample_voice_exemplars(partial, 10, make_seeded_rand(1));
    expect(picked).toHaveLength(1);
    expect(picked[0].title).toBe('Has Both Halves');
  });

  it('handles an empty pool and a zero count', () => {
    expect(sample_voice_exemplars([], 5)).toEqual([]);
    expect(sample_voice_exemplars(POOL, 0)).toEqual([]);
  });

  it('never returns an out-of-range pick when rand() returns 1', () => {
    const picked = sample_voice_exemplars(POOL, 4, () => 1);
    expect(picked.every(p => p !== undefined)).toBe(true);
    expect(picked).toHaveLength(4);
  });
});

describe('build_voice_block', () => {
  it('renders pairs and frames them as style, not content', () => {
    const block = build_voice_block([ex('A Real Title', 2020, 'a real deck')]);
    expect(block).toContain('"A Real Title" / "a real deck"');
    expect(block).toContain('Echo the voice, not the text');
  });

  it('returns an empty string for an empty list so the caller omits the section', () => {
    expect(build_voice_block([])).toBe('');
  });

  it('drops whole pairs to fit the budget, never half a subtitle', () => {
    const long = Array.from({ length: 40 }, (_, i) =>
      ex(`Title Number ${i}`, 2020, 'a subtitle long enough to matter for the budget')
    );
    const block = build_voice_block(long, 200);
    const lines = block.split('\n').filter(l => l.startsWith('- '));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(40);
    for (const line of lines) expect(line.endsWith('"')).toBe(true);
  });

  it('returns empty when the budget fits nothing', () => {
    expect(build_voice_block([ex('Some Title', 2020, 'some deck')], 5)).toBe('');
  });
});

describe('exemplar_titles / exemplar_subtitles', () => {
  it('expose exactly what was shown, for copy prevention', () => {
    const picked = [ex('One Title', 2020, 'one deck'), ex('Two Title', 2021, 'two deck')];
    expect(exemplar_titles(picked)).toEqual(['One Title', 'Two Title']);
    expect(exemplar_subtitles(picked)).toEqual(['one deck', 'two deck']);
  });
});
