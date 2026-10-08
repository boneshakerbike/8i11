/**
 * Voice grounding: builds positive style exemplars from the author's own
 * published posts, for the title prompts in /api/clean-text and /api/generate.
 *
 * Pure functions only (no DB, no network) so they stay unit-testable, matching
 * the convention in substack_titles.ts.
 */

import { normalize_title } from '@/lib/substack_titles';

export interface VoiceExemplar {
  title: string;
  subtitle: string;
  year: number;
}

/**
 * Deterministic PRNG (mulberry32). Used by preview/comparison mode so an A/B
 * run shows both arms the same sampled grounding instead of a fresh draw.
 */
export function make_seeded_rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick an index in [0, length) from a rand() that may return exactly 1. */
function pick_index(length: number, rand: () => number): number {
  return Math.min(Math.floor(rand() * length), length - 1);
}

/**
 * Sample up to `count` exemplars, spread across years.
 *
 * Buckets by year and round-robins across them, picking randomly within each
 * bucket, so a year with many posts cannot dominate the sample. The caller is
 * expected to pass the whole archive rather than a recency-truncated slice —
 * truncating by date before sampling makes excluded years unreachable.
 *
 * Pairs missing either half are dropped: a title with no subtitle teaches
 * nothing about subtitle register, and RSS-imported rows have no subtitle.
 */
export function sample_voice_exemplars(
  pool: VoiceExemplar[],
  count: number,
  rand: () => number = Math.random
): VoiceExemplar[] {
  if (count <= 0) return [];

  const seen = new Set<string>();
  const buckets = new Map<number, VoiceExemplar[]>();

  for (const ex of pool) {
    if (!ex.title?.trim() || !ex.subtitle?.trim()) continue;
    const norm = normalize_title(ex.title);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    if (!buckets.has(ex.year)) buckets.set(ex.year, []);
    buckets.get(ex.year)!.push(ex);
  }

  const years = [...buckets.keys()].sort((a, b) => a - b);
  const picked: VoiceExemplar[] = [];

  while (picked.length < count) {
    let took = 0;
    for (const year of years) {
      if (picked.length >= count) break;
      const bucket = buckets.get(year)!;
      if (bucket.length === 0) continue;
      picked.push(bucket.splice(pick_index(bucket.length, rand), 1)[0]);
      took++;
    }
    if (took === 0) break;
  }

  return picked;
}

/**
 * Render exemplars as a prompt block, or '' when there is nothing to show.
 *
 * Whole pairs are dropped to fit `max_chars` — never half a subtitle, which
 * would teach the model to write truncated ones. An empty result means the
 * caller must omit the section entirely rather than emit a bare header.
 */
export function build_voice_block(exemplars: VoiceExemplar[], max_chars: number = 2600): string {
  const lines: string[] = [];
  let used = 0;

  for (const ex of exemplars) {
    const line = `- "${ex.title}" / "${ex.subtitle}"`;
    if (used + line.length + 1 > max_chars) break;
    lines.push(line);
    used += line.length + 1;
  }

  if (lines.length === 0) return '';

  return [
    "**The author's own published posts.** Real title and subtitle pairs from this newsletter, shown for register, rhythm, and sense of humor:",
    '',
    ...lines,
    '',
    'Echo the voice, not the text. Do not reuse their words, their subjects, or their sentence shapes.',
  ].join('\n');
}

/** Every title shown to the model in a voice block, for copy prevention. */
export function exemplar_titles(exemplars: VoiceExemplar[]): string[] {
  return exemplars.map(e => e.title).filter(Boolean);
}

/** Every subtitle shown to the model in a voice block, for copy prevention. */
export function exemplar_subtitles(exemplars: VoiceExemplar[]): string[] {
  return exemplars.map(e => e.subtitle).filter(Boolean);
}
