/**
 * Thin Google Drive v3 REST client (plain fetch, no googleapis dependency),
 * plus an in-memory index of the owner's markdown files and their root-relative
 * paths, built once per request.
 */

import { get_google_access_token } from '@/lib/google_auth';
import {
  context_file_name,
  drive_fulltext_value,
  drive_query_literal,
  DriveFileMeta,
  ROOT_CONTEXT_FILE,
} from '@/lib/drive_knowledge';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class DriveApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'DriveApiError';
  }
}

/** fetch with the owner's access token; on a 401 refresh once and retry. */
async function drive_fetch(url: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await get_google_access_token(attempt > 0);
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && attempt === 0) continue;
    if (!res.ok) throw new DriveApiError(res.status, `Drive ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }
  throw new DriveApiError(401, 'Drive rejected the access token');
}

async function drive_json<T>(url: string, init?: RequestInit): Promise<T> {
  return (await drive_fetch(url, init)).json() as Promise<T>;
}

interface RawFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  ownedByMe?: boolean;
  trashed?: boolean;
  shared?: boolean;
  headRevisionId?: string;
}

const FILE_FIELDS = 'id,name,mimeType,parents,ownedByMe,trashed,shared,headRevisionId';

async function list_all(q: string, fields: string): Promise<RawFile[]> {
  const out: RawFile[] = [];
  let page_token: string | undefined;
  do {
    const params = new URLSearchParams({
      q,
      fields: `nextPageToken,files(${fields})`,
      pageSize: '1000',
      spaces: 'drive',
    });
    if (page_token) params.set('pageToken', page_token);
    const data = await drive_json<{ files: RawFile[]; nextPageToken?: string }>(`${API}/files?${params}`);
    out.push(...data.files);
    page_token = data.nextPageToken;
  } while (page_token);
  return out;
}

// ── Index ───────────────────────────────────────────────────

export interface DriveIndex {
  root_id: string;
  /** Every markdown file reachable from My Drive root, by id. */
  files: Map<string, DriveFileMeta>;
  /** Folder id -> its ALL-CAPS context file id. */
  context_file_by_folder: Map<string, string>;
  /** Folder id -> root-relative folder path ("" for root). */
  folder_paths: Map<string, string>;
  /** Folder id -> names of markdown files in it. */
  names_in_folder: Map<string, Set<string>>;
  /** Folder id -> its parent folder id. */
  folder_parent: Map<string, string>;
}

function to_meta(raw: RawFile, path: string): DriveFileMeta {
  return {
    id: raw.id,
    name: raw.name,
    mime_type: raw.mimeType,
    parent_id: raw.parents?.[0] ?? null,
    owned_by_me: raw.ownedByMe === true,
    trashed: raw.trashed === true,
    shared: raw.shared === true,
    path,
  };
}

/**
 * List every folder and every markdown file once and resolve paths in memory.
 * Files whose parent chain doesn't reach My Drive root (shared-with-me) are left
 * out, as are shortcuts (they aren't text files, so the queries skip them).
 */
export async function build_drive_index(): Promise<DriveIndex> {
  const [root, folders, texts] = await Promise.all([
    drive_json<{ id: string }>(`${API}/files/root?fields=id`),
    list_all(`mimeType = '${FOLDER_MIME}' and trashed = false`, 'id,name,parents'),
    list_all(
      `trashed = false and (mimeType contains 'text/' or mimeType = 'application/octet-stream')`,
      'id,name,mimeType,parents,ownedByMe,shared'
    ),
  ]);

  const folder_by_id = new Map(folders.map(f => [f.id, f]));
  const folder_paths = new Map<string, string>([[root.id, '']]);

  const path_of = (id: string, depth = 0): string | null => {
    const known = folder_paths.get(id);
    if (known !== undefined) return known;
    const folder = folder_by_id.get(id);
    if (!folder || depth > 40) return null;
    const parent = folder.parents?.[0];
    const parent_path = parent ? path_of(parent, depth + 1) : null;
    if (parent_path === null) return null;
    const path = `${parent_path}/${folder.name}`;
    folder_paths.set(id, path);
    return path;
  };

  const files = new Map<string, DriveFileMeta>();
  const context_file_by_folder = new Map<string, string>();
  const names_in_folder = new Map<string, Set<string>>();

  for (const raw of texts) {
    if (!raw.name.toLowerCase().endsWith('.md')) continue;
    const parent = raw.parents?.[0];
    if (!parent) continue;
    const folder_path = path_of(parent);
    if (folder_path === null) continue;

    files.set(raw.id, to_meta(raw, `${folder_path}/${raw.name}`));
    if (!names_in_folder.has(parent)) names_in_folder.set(parent, new Set());
    names_in_folder.get(parent)!.add(raw.name);

    const expected = parent === root.id ? ROOT_CONTEXT_FILE : context_file_name(folder_by_id.get(parent)?.name ?? '');
    if (raw.name === expected && raw.ownedByMe) context_file_by_folder.set(parent, raw.id);
  }

  const folder_parent = new Map<string, string>();
  for (const f of folders) if (f.parents?.[0]) folder_parent.set(f.id, f.parents[0]);

  return { root_id: root.id, files, context_file_by_folder, folder_paths, names_in_folder, folder_parent };
}

// ── Reading and writing ─────────────────────────────────────

export interface DriveText {
  meta: DriveFileMeta;
  head_revision_id: string | null;
  content: string;
}

/** Current metadata (incl. headRevisionId) and the raw text, BOM and line endings intact. */
export async function read_text(id: string, path: string): Promise<DriveText> {
  const [raw, body] = await Promise.all([
    drive_json<RawFile>(`${API}/files/${encodeURIComponent(id)}?fields=${FILE_FIELDS}`),
    drive_fetch(`${API}/files/${encodeURIComponent(id)}?alt=media`).then(r => r.arrayBuffer()),
  ]);
  return {
    meta: to_meta(raw, path),
    head_revision_id: raw.headRevisionId ?? null,
    content: new TextDecoder('utf-8', { ignoreBOM: true }).decode(body),
  };
}

/** Replace a file's content as a new revision of the same file id, kept forever. */
export async function update_text(id: string, content: string): Promise<void> {
  const params = new URLSearchParams({ uploadType: 'media', keepRevisionForever: 'true', fields: 'id' });
  await drive_fetch(`${UPLOAD}/files/${encodeURIComponent(id)}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'text/markdown; charset=UTF-8' },
    body: content,
  });
}

export async function create_text(folder_id: string, name: string, content: string): Promise<string> {
  const boundary = `drive-knowledge-${crypto.randomUUID()}`;
  const metadata = { name, parents: [folder_id], mimeType: 'text/markdown' };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${content}\r\n` +
    `--${boundary}--`;
  const created = await drive_json<{ id: string }>(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return created.id;
}

/** Raw text only, for scanning many small files without the metadata round trip. */
export async function download_text(id: string): Promise<string> {
  const body = await drive_fetch(`${API}/files/${encodeURIComponent(id)}?alt=media`).then(r => r.arrayBuffer());
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(body);
}

/** Live check that a name is still free in a folder, right before creating it. */
export async function name_exists_in_folder(folder_id: string, name: string): Promise<boolean> {
  const q = `${drive_query_literal(folder_id)} in parents and name = ${drive_query_literal(name)} and trashed = false`;
  const data = await drive_json<{ files: RawFile[] }>(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)' })}`);
  return data.files.length > 0;
}

/** Drive full-text search for a term, limited to text files. Secondary to the in-memory index. */
export async function full_text_search(term: string, limit = 15): Promise<string[]> {
  const q = `fullText contains ${drive_fulltext_value(term)} and trashed = false and mimeType contains 'text/'`;
  const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: String(limit), spaces: 'drive' });
  const data = await drive_json<{ files: RawFile[] }>(`${API}/files?${params}`);
  return data.files.map(f => f.id);
}

export function drive_view_url(id: string): string {
  return `https://drive.google.com/file/d/${id}/view`;
}
