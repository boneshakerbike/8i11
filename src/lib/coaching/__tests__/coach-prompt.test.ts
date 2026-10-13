import { describe, expect, it } from 'vitest';
import { build_coach_system, SESSION_MEMORY, type PastSession } from '@/lib/coaching/coach-prompt';
import { DEFAULT_PROFILE, FALLBACK_FRAMEWORK } from '@/lib/coaching/system-prompt';
import type { CoachMemory, MemoryDocument } from '@/lib/coaching/memory';

const doc = (kind: MemoryDocument['kind'], body: string): MemoryDocument => ({ kind, body, source: null, created_at: 0, versions: 1 });
const EMPTY: CoachMemory = { framework: null, crosswalk: null, profile: null };

// 2026-10-12 is epoch day 20738
const session = (date: number, summary: string | null, full = ''): PastSession => ({ date, advice_summary: summary, advice_full: full });

describe('build_coach_system', () => {
  it('adds the framework, biomarker targets and profile, and says the framework wins', () => {
    const text = build_coach_system({
      framework: doc('framework', 'Lever 3: heavy strength 3x a week.'),
      crosswalk: doc('crosswalk', 'ApoB under 60.'),
      profile: doc('profile', 'Rides an e-MTB.'),
    }, []);
    expect(text).toContain('<framework>\nLever 3: heavy strength 3x a week.\n</framework>');
    expect(text).toContain('<biomarker_targets>\nApoB under 60.\n</biomarker_targets>');
    expect(text).toContain('<profile>\nRides an e-MTB.\n</profile>');
    expect(text).toContain('Where it differs from what he wants, the framework wins');
    expect(text).toContain('Change your position only when he gives you new information');
    expect(text).not.toContain(DEFAULT_PROFILE);
  });

  it('falls back to the short lever list and a fill-in note before memory is set up', () => {
    const text = build_coach_system(EMPTY, []);
    expect(text).toContain(FALLBACK_FRAMEWORK);
    expect(text).toContain(DEFAULT_PROFILE);
    expect(text).not.toContain('<biomarker_targets>');
  });

  it('keeps personal rules out of the repo: the fallback profile only asks for one', () => {
    expect(DEFAULT_PROFILE).toContain('No profile saved yet');
    expect(DEFAULT_PROFILE).not.toMatch(/back pain|crisis|195/i);
  });

  it(`remembers the last ${SESSION_MEMORY} sessions in full, with the weekday`, () => {
    const long_summary = 'Ride easy. '.repeat(60).trim(); // 659 characters, more than the old 300 cut
    const sessions = Array.from({ length: 9 }, (_, i) => session(20738 - i, i === 0 ? long_summary : `Session ${i}.`));
    const text = build_coach_system(EMPTY, sessions);
    expect(text).toContain(`[Monday, Oct 12, 2026] ${long_summary}`);
    expect(text).toContain('Session 6.');
    expect(text).not.toContain('Session 7.');
  });

  it('uses the conversation when a session has no summary, without its data block', () => {
    const text = build_coach_system(EMPTY, [session(20738, null, '[Data for this session]\nHRV 70\n\n[Conversation]\nRest today.')]);
    expect(text).toContain('[Monday, Oct 12, 2026] Rest today.');
    expect(text).not.toContain('HRV 70');
  });

  it('is identical for every turn of a session, so it can be cached', () => {
    const memory: CoachMemory = { ...EMPTY, profile: doc('profile', 'p') };
    expect(build_coach_system(memory, [session(20738, 's')])).toBe(build_coach_system(memory, [session(20738, 's')]));
  });
});
