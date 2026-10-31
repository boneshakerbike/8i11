import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import {
  DRIVE_DOCUMENTS, MAX_DOCUMENT_CHARS, decide_proposal, get_coach_memory, get_memory_document, list_pending_proposals,
  refresh_memory_from_drive, save_memory_document, save_profile_proposals,
  type DriveDocumentReader,
} from '@/lib/coaching/memory';

const FRAMEWORK = DRIVE_DOCUMENTS[0].name;
const CROSSWALK = DRIVE_DOCUMENTS[1].name;

describe('coach memory storage', () => {
  it('keeps every version and returns the newest', async () => {
    const db = createClient({ url: ':memory:' });
    expect(await get_memory_document(db, 'profile')).toBeNull();
    expect(await save_memory_document(db, 'profile', 'first', 'app')).toBe(true);
    expect(await save_memory_document(db, 'profile', 'second', 'app')).toBe(true);
    expect(await get_memory_document(db, 'profile')).toMatchObject({ body: 'second', source: 'app', versions: 2 });
  });

  it('writes nothing when the text has not changed', async () => {
    const db = createClient({ url: ':memory:' });
    await save_memory_document(db, 'framework', 'same', 'drive:1');
    expect(await save_memory_document(db, 'framework', 'same', 'drive:1')).toBe(false);
    expect((await get_memory_document(db, 'framework'))?.versions).toBe(1);
  });
});

describe('refresh_memory_from_drive', () => {
  const reader = (files: Record<string, string | null>): DriveDocumentReader =>
    async name => (files[name] == null ? null : { id: `id-${name.length}`, text: files[name]! });

  it('copies both files, then reports them unchanged on the next run', async () => {
    const db = createClient({ url: ':memory:' });
    const read = reader({ [FRAMEWORK]: '# Framework\nLever 3: lift heavy.', [CROSSWALK]: '# Targets\nApoB < 60' });
    expect(await refresh_memory_from_drive(db, read)).toEqual({
      ok: true, detail: 'Longevity Coaching Framework updated; Biomarker Target Crosswalk updated',
    });
    expect(await refresh_memory_from_drive(db, read)).toEqual({
      ok: true, detail: 'Longevity Coaching Framework unchanged; Biomarker Target Crosswalk unchanged',
    });
    const memory = await get_coach_memory(db);
    expect(memory.framework?.body).toBe('# Framework\nLever 3: lift heavy.');
    expect(memory.framework?.source).toMatch(/^drive:/);
    expect(memory.crosswalk?.body).toBe('# Targets\nApoB < 60');
  });

  it('keeps the last copy when a file is missing, empty, too long or unreadable', async () => {
    const db = createClient({ url: ':memory:' });
    await refresh_memory_from_drive(db, reader({ [FRAMEWORK]: 'v1', [CROSSWALK]: 'c1' }));

    const missing = await refresh_memory_from_drive(db, reader({ [FRAMEWORK]: null, [CROSSWALK]: '   ' }));
    expect(missing.ok).toBe(false);
    expect(missing.detail).toBe(`Longevity Coaching Framework: ${FRAMEWORK} not found in Drive; Biomarker Target Crosswalk: the file is empty; the coach keeps using the last copy`);

    const too_long = await refresh_memory_from_drive(db, reader({ [FRAMEWORK]: 'x'.repeat(MAX_DOCUMENT_CHARS + 1), [CROSSWALK]: 'c1' }));
    expect(too_long.detail).toContain('over the 60,000 limit');

    const broken = await refresh_memory_from_drive(db, async () => { throw new Error('Google Drive is not connected'); });
    expect(broken.detail).toContain('Longevity Coaching Framework: Google Drive is not connected');

    const memory = await get_coach_memory(db);
    expect(memory.framework?.body).toBe('v1');
    expect(memory.crosswalk?.body).toBe('c1');
  });
});

describe('profile proposals', () => {
  const add = (text: string) => ({ action: 'add' as const, old_text: '', new_text: text, reason: 'He said so.' });

  it('changes the profile only when accepted, as a new version from the coach', async () => {
    const db = createClient({ url: ':memory:' });
    await save_memory_document(db, 'profile', 'Rides an e-MTB.', 'app');
    const [a, b] = await save_profile_proposals(db, '2026-10-13', [add('Has a new saddle.'), add('Owns a rower.')]);
    expect(await decide_proposal(db, b.id, false)).toEqual({ ok: true, profile_saved: false, proposals: [a] });
    expect((await get_memory_document(db, 'profile'))?.body).toBe('Rides an e-MTB.');
    expect(await decide_proposal(db, a.id, true)).toEqual({ ok: true, profile_saved: true, proposals: [] });
    expect(await get_memory_document(db, 'profile')).toMatchObject({ body: 'Rides an e-MTB.\nHas a new saddle.', source: 'coach:2026-10-13', versions: 2 });
    expect(await list_pending_proposals(db)).toEqual([]);
    expect((await decide_proposal(db, a.id, true)).ok).toBe(false);
  });

  // Issue #327: a suggestion from 2026-10-28 for a line Bill had since edited
  // stayed listed, and Accept could only fail.
  it('leaves out a proposal whose line was edited away, and refuses to apply it', async () => {
    const db = createClient({ url: ':memory:' });
    await save_memory_document(db, 'profile', 'Rides an e-MTB.\nKnee is sore.', 'app');
    const [p] = await save_profile_proposals(db, '2026-10-28', [{ action: 'change', old_text: 'Knee is sore.', new_text: 'Knee is sore after long climbs.', reason: 'He said so.' }]);
    expect(await list_pending_proposals(db)).toHaveLength(1);
    await save_memory_document(db, 'profile', 'Rides an e-MTB.\nKnee is fine.', 'app');
    expect(await list_pending_proposals(db)).toEqual([]);
    expect(await decide_proposal(db, p.id, true)).toEqual({
      ok: false, status: 409, proposals: [],
      error: 'Your profile changed since the coach suggested this, so it no longer applies.',
    });
    expect((await get_memory_document(db, 'profile'))?.body).toBe('Rides an e-MTB.\nKnee is fine.');
  });

  it('drops other suggestions for a line once one of them is accepted', async () => {
    const db = createClient({ url: ':memory:' });
    await save_memory_document(db, 'profile', 'Knee is sore.', 'app');
    const [a] = await save_profile_proposals(db, '2026-10-28', [{ action: 'change', old_text: 'Knee is sore.', new_text: 'Knee is better.', reason: 'r' }]);
    await save_profile_proposals(db, '2026-10-30', [{ action: 'remove', old_text: 'Knee is sore.', new_text: '', reason: 'r' }, add('Owns a rower.')]);
    expect(await list_pending_proposals(db)).toHaveLength(3);
    const result = await decide_proposal(db, a.id, true);
    expect(result).toMatchObject({ ok: true, profile_saved: true });
    expect(result.proposals.map(p => p.new_text)).toEqual(['Owns a rower.']);
  });

  it('lists the same suggestion from several sessions once, and one answer covers them all', async () => {
    const db = createClient({ url: ':memory:' });
    await save_memory_document(db, 'profile', 'Rides an e-MTB.', 'app');
    await save_profile_proposals(db, '2026-10-28', [add('Owns a rower.')]);
    await save_profile_proposals(db, '2026-10-29', [add('Owns a rower.')]);
    const list = await list_pending_proposals(db);
    expect(list.map(p => p.session_date)).toEqual(['2026-10-29']);
    expect(await decide_proposal(db, list[0].id, false)).toMatchObject({ ok: true, proposals: [] });
    expect(await list_pending_proposals(db)).toEqual([]);
  });

  it('replaces pending proposals when the same session is saved again', async () => {
    const db = createClient({ url: ':memory:' });
    await save_profile_proposals(db, '2026-10-13', [add('First try.')]);
    const list = await save_profile_proposals(db, '2026-10-13', [add('Second try.')]);
    expect(list.map(p => p.new_text)).toEqual(['Second try.']);
  });
});
