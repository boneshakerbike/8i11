/**
 * Refresh coach memory from Bill's Google Drive (server only). Uses the
 * app's existing Drive connection (src/lib/google_auth.ts). Never throws.
 */

import type { Client } from '@libsql/client';
import { GoogleNotConnectedError, get_google_access_token } from '@/lib/google_auth';
import { download_text, find_text_file_by_name } from '@/lib/google_drive';
import { refresh_memory_from_drive, type DriveDocumentReader } from '@/lib/coaching/memory';

const read_drive_document: DriveDocumentReader = async name => {
  const file = await find_text_file_by_name(name);
  return file ? { id: file.id, text: await download_text(file.id) } : null;
};

export async function refresh_coach_memory(db: Client): Promise<{ ok: boolean; detail: string }> {
  try {
    // One clear message instead of the same error once per file
    await get_google_access_token();
  } catch (err) {
    const reason = err instanceof GoogleNotConnectedError ? err.message : `Google Drive: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, detail: `${reason} (Coach memory page: Connect Google Drive); the coach keeps using the last copy` };
  }
  return refresh_memory_from_drive(db, read_drive_document);
}
