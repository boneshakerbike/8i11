import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import {
  DRIVE_DOCUMENTS, MAX_DOCUMENT_CHARS, get_coach_memory, get_memory_document, refresh_memory_from_drive, save_memory_document,
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
