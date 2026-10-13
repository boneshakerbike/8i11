import { describe, expect, it } from 'vitest';
import { MAX_PROFILE_EDITS, apply_profile_edit, review_memory_lines, validate_review } from '@/lib/coaching/session-review';

// Made-up profile
const PROFILE = 'Rides an e-MTB.\nLifts at home with dumbbells.\nLeft knee is sore after long climbs.';

const raw = (extra: Record<string, unknown> = {}) => ({
  summary: 'Easy spin today, heavy lift tomorrow.',
  facts_learned: ['Bought a new saddle'],
  decisions: ['Heavy lift Wednesday'],
  developer_notes: [],
  profile_edits: [],
  ...extra,
});

describe('validate_review', () => {
  it('keeps a well-formed review', () => {
    expect(validate_review(raw(), PROFILE)).toMatchObject({
      summary: 'Easy spin today, heavy lift tomorrow.',
      facts_learned: ['Bought a new saddle'],
      decisions: ['Heavy lift Wednesday'],
      profile_edits: [],
    });
  });

  it('returns null for a wrong shape, so nothing is stored', () => {
    expect(validate_review(null, PROFILE)).toBeNull();
    expect(validate_review(raw({ summary: '' }), PROFILE)).toBeNull();
    expect(validate_review(raw({ decisions: 'Heavy lift' }), PROFILE)).toBeNull();
    expect(validate_review(raw({ profile_edits: [{ action: 'rewrite', old_text: '', new_text: 'x', reason: 'y' }] }), PROFILE)).toBeNull();
  });

  it('drops edits that do not fit the profile and keeps the rest', () => {
    const review = validate_review(raw({
      profile_edits: [
        { action: 'add', old_text: 'ignored', new_text: 'Has a new saddle.', reason: 'He said so.' },
        { action: 'change', old_text: 'Rides a gravel bike.', new_text: 'x', reason: 'not in the profile' },
        { action: 'add', old_text: '', new_text: 'Rides an e-MTB.', reason: 'already there' },
        { action: 'remove', old_text: 'Left knee is sore after long climbs.', new_text: 'ignored', reason: 'Knee is fine now.' },
        { action: 'add', old_text: '', new_text: 'Has a new saddle.', reason: 'duplicate' },
      ],
    }), PROFILE);
    expect(review?.profile_edits).toEqual([
      { action: 'add', old_text: '', new_text: 'Has a new saddle.', reason: 'He said so.' },
      { action: 'remove', old_text: 'Left knee is sore after long climbs.', new_text: '', reason: 'Knee is fine now.' },
    ]);
  });

  it(`keeps at most ${MAX_PROFILE_EDITS} edits`, () => {
    const edits = Array.from({ length: 8 }, (_, i) => ({ action: 'add', old_text: '', new_text: `Fact ${i}.`, reason: 'r' }));
    expect(validate_review(raw({ profile_edits: edits }), PROFILE)?.profile_edits).toHaveLength(MAX_PROFILE_EDITS);
  });

  it('keeps the summary under the Oura chat limit', () => {
    const review = validate_review(raw({ summary: 'Long sentence here. '.repeat(80) }), PROFILE);
    expect(review!.summary.length).toBeLessThanOrEqual(995);
  });
});

describe('apply_profile_edit', () => {
  it('adds, changes and removes one line', () => {
    expect(apply_profile_edit(PROFILE, { action: 'add', old_text: '', new_text: 'Has a new saddle.', reason: '' }))
      .toBe(`${PROFILE}\nHas a new saddle.`);
    expect(apply_profile_edit(PROFILE, { action: 'change', old_text: 'Rides an e-MTB.', new_text: 'Rides an e-MTB and a gravel bike.', reason: '' }))
      .toBe('Rides an e-MTB and a gravel bike.\nLifts at home with dumbbells.\nLeft knee is sore after long climbs.');
    expect(apply_profile_edit(PROFILE, { action: 'remove', old_text: 'Lifts at home with dumbbells.', new_text: '', reason: '' }))
      .toBe('Rides an e-MTB.\nLeft knee is sore after long climbs.');
  });

  it('is null when the line was edited away since', () => {
    expect(apply_profile_edit(PROFILE, { action: 'remove', old_text: 'Rides a gravel bike.', new_text: '', reason: '' })).toBeNull();
  });
});

describe('review_memory_lines', () => {
  it('lists decisions and facts, and nothing when empty', () => {
    expect(review_memory_lines({ decisions: ['Lift Wednesday'], facts_learned: [] })).toBe('Decided: Lift Wednesday');
    expect(review_memory_lines({ decisions: [], facts_learned: [] })).toBe('');
    expect(review_memory_lines(null)).toBe('');
  });
});
