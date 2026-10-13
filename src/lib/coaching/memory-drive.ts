/**
 * Refresh coach memory from Bill's Google Drive (server only). Uses the
 * app's existing Drive connection (src/lib/google_auth.ts). Never throws.
 */

import type { Client } from '@libsql/client';
import { GoogleNotConnectedError, get_google_access_token } from '@/lib/google_auth';
import { download_text, find_text_file_by_name } from '@/lib/google_drive';
import { refresh_memory_from_drive, type DriveDocumentReader } from '@/lib/coaching/memory';

const KEEPS_LAST_COPY = 'the coach keeps using the last copy';

const read_drive_document: DriveDocumentReader = async name => {
  const file = await find_text_file_by_name(name);
  return file ? { id: file.id, text: await download_text(file.id) } : null;
};

export async function refresh_coach_memory(db: Client): Promise<{ ok: boolean; detail: string }> {
  // Google sign-in settings exist for the live site only; a preview cannot renew the token
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return { ok: false, detail: `Google Drive works on the live site only (8i11.vercel.app): refresh there; ${KEEPS_LAST_COPY}` };
  }
  try {
    // One clear message instead of the same error once per file
    await get_google_access_token();
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) {
      return { ok: false, detail: `${err.message}: press Connect Google Drive on the Coach memory page; ${KEEPS_LAST_COPY}` };
    }
    const reason = err instanceof Error ? err.message.slice(0, 160) : String(err);
    return { ok: false, detail: `Google Drive could not be reached (${reason}); ${KEEPS_LAST_COPY}` };
  }
  return refresh_memory_from_drive(db, read_drive_document);
}
