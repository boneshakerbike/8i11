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
import { apply_profile_edit, type ProfileEdit } from '@/lib/coaching/session-review';

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

/**
 * Profile edits the coach proposed after a session. Bill accepts or rejects
 * each one on the Coach page or /coach/memory; nothing changes the profile
 * until he accepts.
 */
export type ProposalStatus = 'pending' | 'accepted' | 'rejected';

export interface ProfileProposal extends ProfileEdit {
  id: number;
  session_date: string;
  status: ProposalStatus;
  created_at: number;
}

const proposals_ensured = new WeakSet<Client>();

async function ensure_proposals_table(db: Client): Promise<void> {
  if (proposals_ensured.has(db)) return;
  await db.batch([
    `CREATE TABLE IF NOT EXISTS coach_profile_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_date TEXT NOT NULL,
      action TEXT NOT NULL,
      old_text TEXT NOT NULL,
      new_text TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    )`,
    'CREATE INDEX IF NOT EXISTS idx_coach_profile_proposals_status ON coach_profile_proposals(status, id)',
  ], 'write');
  proposals_ensured.add(db);
}

/**
 * Store a session's proposed edits. A session saved again (same date)
 * replaces its pending proposals; decided ones are kept.
 */
export async function save_profile_proposals(db: Client, session_date: string, edits: ProfileEdit[]): Promise<ProfileProposal[]> {
  await ensure_proposals_table(db);
  const now = Math.floor(Date.now() / 1000);
  await db.execute({ sql: `DELETE FROM coach_profile_proposals WHERE session_date = ? AND status = 'pending'`, args: [session_date] });
  for (const e of edits) {
    await db.execute({
      sql: `INSERT INTO coach_profile_proposals (session_date, action, old_text, new_text, reason, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      args: [session_date, e.action, e.old_text, e.new_text, e.reason, now],
    });
  }
  return list_pending_proposals(db);
}

export async function list_pending_proposals(db: Client): Promise<ProfileProposal[]> {
  await ensure_proposals_table(db);
  const r = await db.execute(`SELECT * FROM coach_profile_proposals WHERE status = 'pending' ORDER BY id`);
  return r.rows.map(row => ({
    id: Number(row.id),
    session_date: String(row.session_date),
    action: row.action as ProfileEdit['action'],
    old_text: String(row.old_text),
    new_text: String(row.new_text),
    reason: String(row.reason),
    status: row.status as ProposalStatus,
    created_at: Number(row.created_at),
  }));
}

export type DecideResult =
  | { ok: true; profile_saved: boolean }
  | { ok: false; error: string; status: number };

/**
 * Accept or reject one pending proposal. Accepting applies it to the current
 * profile and saves a new version. If the line it changes is no longer in the
 * profile, nothing is saved and the proposal stays pending.
 */
export async function decide_proposal(db: Client, id: number, accept: boolean): Promise<DecideResult> {
  await ensure_proposals_table(db);
  const r = await db.execute({ sql: `SELECT * FROM coach_profile_proposals WHERE id = ? AND status = 'pending'`, args: [id] });
  const row = r.rows[0];
  if (!row) return { ok: false, error: 'This suggestion was already answered or does not exist.', status: 404 };
  let profile_saved = false;
  if (accept) {
    const edit: ProfileEdit = {
      action: row.action as ProfileEdit['action'],
      old_text: String(row.old_text),
      new_text: String(row.new_text),
      reason: String(row.reason),
    };
    const current = (await get_memory_document(db, 'profile'))?.body ?? '';
    const next = apply_profile_edit(current, edit);
    if (next == null) return { ok: false, error: 'The profile line this changes is no longer there. Reject it, or edit the profile by hand.', status: 409 };
    if (next.length > MAX_PROFILE_CHARS) return { ok: false, error: `The profile would be over ${MAX_PROFILE_CHARS.toLocaleString('en-US')} characters. Shorten it first.`, status: 409 };
    profile_saved = await save_memory_document(db, 'profile', next, `coach:${row.session_date}`);
  }
  await db.execute({
    sql: `UPDATE coach_profile_proposals SET status = ?, decided_at = ? WHERE id = ?`,
    args: [accept ? 'accepted' : 'rejected', Math.floor(Date.now() / 1000), id],
  });
  return { ok: true, profile_saved };
}
