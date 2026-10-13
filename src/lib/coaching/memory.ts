/**
 * Coach memory: the documents the coach reads before every session.
 * - framework, crosswalk: Bill's Longevity Coaching Framework and Biomarker
 *   Target Crosswalk, copied from his Google Drive. They are the rules and
 *   override his wishes where they differ.
 * - profile: facts about Bill, edited on /coach/memory.
 * Stored in the database only, never in this public repo. Every change adds a
 * row and the newest row of each kind wins, so old versions are kept.
 */

import type { Client } from '@libsql/client';

export type MemoryKind = 'framework' | 'crosswalk' | 'profile';

/** The Drive files the coach follows, found by exact name. */
export const DRIVE_DOCUMENTS = [
  { kind: 'framework', name: '2026-04-02-Longevity-Coaching-Framework.md', label: 'Longevity Coaching Framework' },
  { kind: 'crosswalk', name: 'Biomarker-Target-Crosswalk.md', label: 'Biomarker Target Crosswalk' },
] as const;

/** About 15,000 tokens; a larger file is reported, and the last copy is kept. */
export const MAX_DOCUMENT_CHARS = 60_000;
export const MAX_PROFILE_CHARS = 8_000;

export interface MemoryDocument {
  kind: MemoryKind;
  body: string;
  source: string | null;
  created_at: number;
  versions: number;
}

export type CoachMemory = Record<MemoryKind, MemoryDocument | null>;

const ensured = new WeakSet<Client>();

async function ensure_memory_table(db: Client): Promise<void> {
  if (ensured.has(db)) return;
  await db.batch([
    `CREATE TABLE IF NOT EXISTS coach_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      source TEXT,
      created_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_coach_documents_kind ON coach_documents(kind, id)',
  ], 'write');
  ensured.add(db);
}

export async function get_memory_document(db: Client, kind: MemoryKind): Promise<MemoryDocument | null> {
  await ensure_memory_table(db);
  const r = await db.execute({
    sql: `SELECT body, source, created_at, (SELECT COUNT(*) FROM coach_documents WHERE kind = ?) AS versions
          FROM coach_documents WHERE kind = ? ORDER BY id DESC LIMIT 1`,
    args: [kind, kind],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    kind,
    body: String(row.body),
    source: (row.source as string | null) ?? null,
    created_at: Number(row.created_at),
    versions: Number(row.versions),
  };
}

/** Save a new version. Returns false (and writes nothing) when it matches the current one. */
export async function save_memory_document(db: Client, kind: MemoryKind, body: string, source: string | null): Promise<boolean> {
  const current = await get_memory_document(db, kind);
  if (current?.body === body) return false;
  await db.execute({
    sql: 'INSERT INTO coach_documents (kind, body, source, created_at) VALUES (?, ?, ?, ?)',
    args: [kind, body, source, Math.floor(Date.now() / 1000)],
  });
  return true;
}

export async function get_coach_memory(db: Client): Promise<CoachMemory> {
  const [framework, crosswalk, profile] = await Promise.all([
    get_memory_document(db, 'framework'),
    get_memory_document(db, 'crosswalk'),
    get_memory_document(db, 'profile'),
  ]);
  return { framework, crosswalk, profile };
}

/** Reads one Drive file by exact name; null when there is none. */
export type DriveDocumentReader = (name: string) => Promise<{ id: string; text: string } | null>;

/**
 * Copy the framework files from Drive. A file that is missing, empty or too
 * large is reported and its last copy kept. Never throws.
 */
export async function refresh_memory_from_drive(db: Client, read: DriveDocumentReader): Promise<{ ok: boolean; detail: string }> {
  const done: string[] = [];
  const problems: string[] = [];
  for (const doc of DRIVE_DOCUMENTS) {
    try {
      const found = await read(doc.name);
      const text = found?.text.trim() ?? '';
      if (!found) problems.push(`${doc.label}: ${doc.name} not found in Drive`);
      else if (!text) problems.push(`${doc.label}: the file is empty`);
      else if (text.length > MAX_DOCUMENT_CHARS) problems.push(`${doc.label}: ${text.length.toLocaleString('en-US')} characters, over the ${MAX_DOCUMENT_CHARS.toLocaleString('en-US')} limit`);
      else done.push(`${doc.label} ${(await save_memory_document(db, doc.kind, text, `drive:${found.id}`)) ? 'updated' : 'unchanged'}`);
    } catch (err) {
      problems.push(`${doc.label}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    }
  }
  if (problems.length > 0) problems.push('the coach keeps using the last copy');
  return { ok: problems.length === 0, detail: [...done, ...problems].join('; ') };
}
