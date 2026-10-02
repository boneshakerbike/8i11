/**
 * Pure helpers for filing knowledge into Google Drive markdown files.
 *
 * Bill's Drive convention (see /MY-DRIVE.md and /Life/LIFE.md in his Drive):
 * every folder has one ALL-CAPS context file named for the folder, which is the
 * authoritative home for that folder's knowledge. Dated point-in-time records
 * are YYYY-MM-DD-descriptor.md beside it. Files are edited in place, never copied.
 *
 * The LLM only ever proposes the text to add and which heading it goes under;
 * the actual splice into the file happens here, in code, so existing content
 * can't be dropped or reworded.
 */

export const ROOT_CONTEXT_FILE = 'MY-DRIVE.md';

/** The context file name for a folder: "Montana State University" -> MONTANA-STATE-UNIVERSITY.md */
export function context_file_name(folder_name: string): string {
  return `${folder_name.trim().replace(/\s+/g, '-').toUpperCase()}.md`;
}

export function is_context_file(file_name: string, folder_name: string): boolean {
  return file_name === context_file_name(folder_name);
}

export interface Heading {
  index: number;
  level: number;
  text: string;
  /** Zero-based line number in the file (BOM excluded). */
  line: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

function split_lines(md: string): string[] {
  return md.split(/\r?\n/);
}

/** ATX headings in document order, skipping anything inside fenced code blocks. */
export function parse_headings(md: string): Heading[] {
  const headings: Heading[] = [];
  let in_fence = false;
  split_lines(strip_bom(md)).forEach((line, i) => {
    if (FENCE_RE.test(line)) {
      in_fence = !in_fence;
      return;
    }
    if (in_fence) return;
    const m = HEADING_RE.exec(line);
    if (m) headings.push({ index: headings.length, level: m[1].length, text: m[2], line: i });
  });
  return headings;
}

/** A numbered heading outline for prompts: "3: ## Map (Where to Look)". */
export function heading_outline(md: string): string {
  const headings = parse_headings(md);
  if (headings.length === 0) return '(no headings)';
  return headings.map(h => `${h.index}: ${'#'.repeat(h.level)} ${h.text}`).join('\n');
}

function strip_bom(md: string): string {
  return md.startsWith('﻿') ? md.slice(1) : md;
}

const LIST_ITEM_RE = /^\s*([-*+]|\d+[.)])\s/;
const TABLE_ROW_RE = /^\s*\|/;

/** Lines of the same "block kind" join without a blank line so lists and tables stay intact. */
function continues_block(prev: string, next: string): boolean {
  if (TABLE_ROW_RE.test(prev) && TABLE_ROW_RE.test(next)) return true;
  if (LIST_ITEM_RE.test(prev) && LIST_ITEM_RE.test(next)) return true;
  return false;
}

/**
 * Insert text into a markdown file.
 *
 * heading_index (from parse_headings) targets that heading's own content: the
 * text goes after the last non-blank line before the next heading of any level.
 * null appends a new section at the end of the file (the text should bring its
 * own heading). Line endings and a leading BOM are preserved.
 */
export function insert_at_heading(md: string, heading_index: number | null, text: string): string {
  const has_bom = md.startsWith('﻿');
  const body = strip_bom(md);
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = split_lines(body);
  const new_lines = text.replace(/\r\n/g, '\n').trim().split('\n');

  if (heading_index === null) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    const out = lines.length > 0 ? [...lines, '', ...new_lines, ''] : [...new_lines, ''];
    return (has_bom ? '﻿' : '') + out.join(eol);
  }

  const headings = parse_headings(body);
  const target = headings[heading_index];
  if (!target) throw new Error(`Heading ${heading_index} not found`);

  const next = headings[heading_index + 1];
  let insert_at = next ? next.line : lines.length;
  while (insert_at > target.line + 1 && lines[insert_at - 1].trim() === '') insert_at--;

  const prev = lines[insert_at - 1];
  const block: string[] = insert_at > target.line + 1 && continues_block(prev, new_lines[0])
    ? [...new_lines]
    : ['', ...new_lines];
  // Keep a blank line between the inserted text and whatever follows it.
  if (insert_at < lines.length && lines[insert_at].trim() !== '') block.push('');

  lines.splice(insert_at, 0, ...block);
  return (has_bom ? '﻿' : '') + lines.join(eol);
}

/**
 * The conventions part of MY-DRIVE.md. Everything from "## Session Log" on is a
 * long history that doesn't help with filing, so it's dropped. Falls back to the
 * first 8,000 characters when the heading isn't there.
 */
export function strip_session_log(md: string): string {
  const lines = split_lines(md);
  const at = lines.findIndex(l => /^#{1,6}\s+session log\b/i.test(l));
  if (at >= 0) return lines.slice(0, at).join('\n').trim();
  return md.slice(0, 8000);
}

export function is_valid_dated_name(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(name);
}

/** Today's date as YYYY-MM-DD in Bill's time zone (Montana), not UTC. */
export function today_local(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** kebab-case descriptor for a dated file name, e.g. "Tub Faucet Drip!" -> "tub-faucet-drip". */
export function to_descriptor(text: string, max_length = 50): string {
  const slug = text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= max_length) return slug;
  const clipped = slug.slice(0, max_length);
  const last = clipped.lastIndexOf('-');
  return last > 10 ? clipped.slice(0, last) : clipped;
}

/** Quote a literal value (a name or id) for a Drive `q` string. */
export function drive_query_literal(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Quote a `fullText contains` term; multi-word terms become an exact phrase. */
export function drive_fulltext_value(term: string): string {
  const clean = term.replace(/"/g, '');
  return /\s/.test(clean) ? drive_query_literal(`"${clean}"`) : drive_query_literal(clean);
}

// ── Edits and their validation ───────────────────────────────

export type DriveEdit =
  | { kind: 'insert'; file_id: string; heading_index: number | null; text: string }
  | { kind: 'create'; folder_id: string; name: string; content: string };

export interface DriveFileMeta {
  id: string;
  name: string;
  mime_type: string;
  parent_id: string | null;
  owned_by_me: boolean;
  trashed: boolean;
  shared: boolean;
  path: string;
}

export interface ValidationContext {
  /** Every file the plan may touch, keyed by id. */
  files: Map<string, DriveFileMeta>;
  /** Folder id -> that folder's context file id. Creates are allowed only in these folders. */
  context_file_by_folder: Map<string, string>;
  /** Folder id -> names already present, so a create can't make a duplicate. */
  names_in_folder: Map<string, Set<string>>;
  /** File id -> its current markdown, for heading checks. */
  contents: Map<string, string>;
}

const MAX_EDIT_CHARS = 20000;

/** Owned, live, plain markdown: the only kind of file this feature will ever write. */
export function is_writable_markdown(meta: DriveFileMeta): boolean {
  if (!meta.owned_by_me || meta.trashed) return false;
  if (!meta.name.toLowerCase().endsWith('.md')) return false;
  return meta.mime_type.startsWith('text/') || meta.mime_type === 'application/octet-stream';
}

/** Returns why an edit is not allowed, or null when it is. */
export function validate_edit(edit: DriveEdit, ctx: ValidationContext): string | null {
  if (edit.kind === 'create') {
    if (!ctx.context_file_by_folder.has(edit.folder_id)) return 'new files may only go beside an existing context file';
    if (!is_valid_dated_name(edit.name)) return `"${edit.name}" is not a YYYY-MM-DD-descriptor.md name`;
    if (ctx.names_in_folder.get(edit.folder_id)?.has(edit.name)) return `${edit.name} already exists in that folder`;
    if (!edit.content.trim()) return 'new file is empty';
    if (edit.content.length > MAX_EDIT_CHARS) return 'new file is too long';
    return null;
  }

  const meta = ctx.files.get(edit.file_id);
  if (!meta) return 'target file was not one of the candidates';
  if (!is_writable_markdown(meta)) return `${meta.path} is not a markdown file you own`;
  if (!edit.text.trim()) return 'nothing to add';
  if (edit.text.length > MAX_EDIT_CHARS) return 'addition is too long';

  const content = ctx.contents.get(edit.file_id);
  if (content === undefined) return 'target file was not read';

  const added_headings = parse_headings(edit.text);
  if (edit.heading_index === null) {
    if (added_headings.length === 0 || parse_headings(edit.text.trim())[0].line !== 0) {
      return 'a new section must start with its own heading';
    }
    return null;
  }

  const target = parse_headings(content)[edit.heading_index];
  if (!target) return `heading ${edit.heading_index} does not exist in ${meta.path}`;
  // Headings inside inserted text must nest under the target, or they'd re-shape the file.
  if (added_headings.some(h => h.level <= target.level)) return 'added text contains a heading that would break the section structure';
  return null;
}
