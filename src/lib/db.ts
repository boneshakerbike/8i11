/**
 * Database utilities for On This Day
 * Uses Turso (libSQL) in production, better-sqlite3 for local development
 */

import fs from 'fs';
import path from 'path';
import { createClient, Client } from '@libsql/client';
import { StoryAudit } from '@/lib/story_audit';
import { normalize_title, TitlePair } from '@/lib/substack_titles';
import type { VoiceExemplar } from '@/lib/voice_corpus';

// Detect if we're using Turso (production) or SQLite (local)
const is_turso = !!process.env.TURSO_DATABASE_URL;

let client: Client | null = null;

function get_client(): Client {
  if (!client) {
    if (is_turso) {
      // Production: Turso
      client = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
    } else {
      // Local development: SQLite file
      const db_path = path.join(process.cwd(), 'data', 'posts.db');

      // Ensure data directory exists
      const dir = path.dirname(db_path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      client = createClient({
        url: `file:${db_path}`,
      });
    }
  }
  return client;
}

async function init_schema(): Promise<void> {
  const db = get_client();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      post_date TEXT NOT NULL,
      local_date TEXT NOT NULL,
      audience TEXT,
      type TEXT,
      content_html TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_posts_local_date ON posts(local_date)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_posts_month_day ON posts(
      substr(local_date, 6, 2),
      substr(local_date, 9, 2)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS archive_info (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      filename TEXT,
      uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      date_key TEXT NOT NULL,
      date_display TEXT NOT NULL,
      content TEXT NOT NULL,
      blurb TEXT,
      post_count INTEGER NOT NULL,
      image_url TEXT,
      edited_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS mr_bear_rookies (
      season INTEGER NOT NULL,
      driver_id TEXT NOT NULL,
      PRIMARY KEY (season, driver_id)
    )
  `);

  await db.execute(`
    INSERT OR IGNORE INTO mr_bear_rookies (season, driver_id) VALUES
      (2025, 'antonelli'),
      (2025, 'bearman'),
      (2025, 'doohan'),
      (2025, 'hadjar'),
      (2025, 'bortoleto')
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_stories_date_key ON stories(date_key)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS story_audits (
      story_id TEXT PRIMARY KEY,
      source_count INTEGER NOT NULL,
      issue_count INTEGER NOT NULL,
      audit_json TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS coros_data (
      date TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      source TEXT DEFAULT 'chrome_extension',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS text_notes (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Every title/subtitle the Substack generator has offered, so it never
  // repeats itself across generations.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS substack_titles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subtitle TEXT,
      title_norm TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_substack_titles_norm ON substack_titles(title_norm)
  `);

  // Coaching tables
  await db.execute(`
    CREATE TABLE IF NOT EXISTS daily_metrics (
      date INTEGER PRIMARY KEY,
      sleep_duration_min INTEGER,
      sleep_efficiency_pct REAL,
      deep_sleep_min INTEGER,
      rem_sleep_min INTEGER,
      hrv_rmssd REAL,
      resting_hr INTEGER,
      readiness_score INTEGER,
      cardiovascular_age INTEGER,
      vo2_max REAL,
      training_load_acute INTEGER,
      training_load_chronic INTEGER,
      recovery_pct INTEGER,
      zone2_min_weekly INTEGER,
      vo2max_intervals_weekly INTEGER,
      weight_lbs REAL,
      back_pain_scale INTEGER,
      back_mobility_notes TEXT,
      bowel_status TEXT,
      injury_notes TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS trend_cache (
      date INTEGER,
      metric_name TEXT,
      value_7day_avg REAL,
      value_30day_avg REAL,
      value_7day_direction TEXT,
      value_30day_direction TEXT,
      value_7day_change_pct REAL,
      value_30day_change_pct REAL,
      computed_at INTEGER,
      PRIMARY KEY (date, metric_name)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS coaching_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date INTEGER UNIQUE,
      advice_full TEXT,
      advice_summary TEXT,
      conversation_turns INTEGER,
      token_count INTEGER,
      framework_version TEXT,
      created_at INTEGER
    )
  `);

  // Migration: add spo2_average column to daily_metrics
  try {
    await db.execute(`ALTER TABLE daily_metrics ADD COLUMN spo2_average REAL`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: add bowel_scale column to daily_metrics (Loose=1 Normal=2 Hard=3 None=0)
  try {
    await db.execute(`ALTER TABLE daily_metrics ADD COLUMN bowel_scale INTEGER`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: backfill cardiovascular_age from HRV + RHR where missing
  // Uses Umetani regression: cv_age = 0.65 * (107 - 12.5 * ln(HRV)) + 0.35 * (1.4 * RHR - 40)
  await db.execute(`
    UPDATE daily_metrics
    SET cardiovascular_age = ROUND(0.65 * (107 - 12.5 * LN(hrv_rmssd)) + 0.35 * (1.4 * resting_hr - 40)),
        updated_at = unixepoch()
    WHERE cardiovascular_age IS NULL
      AND hrv_rmssd IS NOT NULL
      AND resting_hr IS NOT NULL
  `);

  // Migration: add image_url column if missing
  try {
    await db.execute(`ALTER TABLE stories ADD COLUMN image_url TEXT`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: add blurb column if missing
  try {
    await db.execute(`ALTER TABLE stories ADD COLUMN blurb TEXT`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: add edited_at column if missing
  try {
    await db.execute(`ALTER TABLE stories ADD COLUMN edited_at TEXT`);
  } catch {
    // Column already exists, ignore error
  }
}

// Initialize schema on module load
let schema_initialized = false;
export { get_client };
export async function ensure_schema(): Promise<void> {
  if (!schema_initialized) {
    await init_schema();
    schema_initialized = true;
  }
}

export async function get_mr_bear_rookies(season: number): Promise<string[]> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT driver_id FROM mr_bear_rookies WHERE season = ? ORDER BY driver_id ASC',
    args: [season]
  });

  return result.rows.map(row => row.driver_id as string);
}

export async function set_mr_bear_rookies(season: number, driver_ids: string[]): Promise<void> {
  await ensure_schema();
  const db = get_client();

  const normalized = Array.from(new Set(
    driver_ids.map(id => id.trim()).filter(Boolean)
  ));

  await db.execute({
    sql: 'DELETE FROM mr_bear_rookies WHERE season = ?',
    args: [season]
  });

  for (const driver_id of normalized) {
    await db.execute({
      sql: 'INSERT INTO mr_bear_rookies (season, driver_id) VALUES (?, ?)',
      args: [season, driver_id]
    });
  }
}

/**
 * Convert UTC date string to Mountain Time date (YYYY-MM-DD)
 */
function utc_to_mountain(utc_date: string): string {
  const date = new Date(utc_date);
  return date.toLocaleDateString('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

export interface Post {
  id: number;
  post_id: string;
  title: string;
  subtitle: string | null;
  post_date: string;
  local_date: string;
  audience: string | null;
  type: string | null;
  content_html: string | null;
}

export interface PostWithMeta extends Post {
  year: number;
  formatted_date: string;
  years_ago: number;
  blurb: string | null;
}

/**
 * Get posts matching a specific month and day across all years
 */
export async function get_posts_on_date(month: number, day: number): Promise<PostWithMeta[]> {
  await ensure_schema();
  const db = get_client();

  const month_str = month.toString().padStart(2, '0');
  const day_str = day.toString().padStart(2, '0');

  const result = await db.execute({
    sql: `
      SELECT * FROM posts
      WHERE substr(local_date, 6, 2) = ?
        AND substr(local_date, 9, 2) = ?
      ORDER BY local_date ASC
    `,
    args: [month_str, day_str]
  });

  const current_year = new Date().getFullYear();

  return result.rows.map(row => {
    const post = row as unknown as Post;
    const year = parseInt(post.local_date.substring(0, 4), 10);
    const date = new Date(post.local_date + 'T12:00:00');
    return {
      ...post,
      year,
      formatted_date: date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      }),
      years_ago: current_year - year,
      blurb: post.subtitle || extract_blurb(post.content_html)
    };
  });
}

/**
 * Extract first paragraph from HTML content as blurb
 */
function extract_blurb(html: string | null, max_len: number = 200): string | null {
  if (!html) return null;

  // Try each <p> tag until we find one with actual text content
  // (first <p> may contain only images or empty markup)
  const p_regex = /<p[^>]*>(.*?)<\/p>/gis;
  let match;

  while ((match = p_regex.exec(html)) !== null) {
    let text = match[1].replace(/<[^>]*>/g, '');
    text = text.replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"')
               .replace(/&#39;/g, "'")
               .replace(/&nbsp;/g, ' ');
    text = text.trim();

    if (!text) continue;

    if (text.length > max_len) {
      text = text.substring(0, max_len).replace(/\s+\S*$/, '') + '...';
    }

    return text;
  }

  return null;
}

/**
 * Clear all posts from the database
 */
export async function clear_posts(): Promise<void> {
  await ensure_schema();
  const db = get_client();
  await db.execute('DELETE FROM posts');
}

/**
 * Clear all posts and insert new ones from CSV data
 */
export async function import_posts(posts: Array<{
  post_id: string;
  title: string;
  subtitle?: string;
  post_date: string;
  audience?: string;
  type?: string;
}>, html_files: Map<string, string>): Promise<{ processed: number; inserted: number }> {
  await clear_posts();
  return append_posts(posts, html_files);
}

/**
 * Append posts without clearing existing data
 */
export async function append_posts(posts: Array<{
  post_id: string;
  title: string;
  subtitle?: string;
  post_date: string;
  audience?: string;
  type?: string;
}>, html_files: Map<string, string>): Promise<{ processed: number; inserted: number }> {
  await ensure_schema();
  const db = get_client();

  let processed = 0;
  let inserted = 0;

  for (const post of posts) {
    if (!post.post_date || !post.title) continue;

    const local_date = utc_to_mountain(post.post_date);
    const html = html_files.get(post.post_id) || null;

    const result = await db.execute({
      sql: `
        INSERT OR IGNORE INTO posts (post_id, title, subtitle, post_date, local_date, audience, type, content_html)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        post.post_id,
        post.title,
        post.subtitle || null,
        post.post_date,
        local_date,
        post.audience || null,
        post.type || null,
        html
      ]
    });
    processed++;
    if (result.rowsAffected && result.rowsAffected > 0) {
      inserted++;
    }
  }

  return { processed, inserted };
}

/**
 * Update archive info
 */
export async function set_archive_info(filename: string): Promise<void> {
  await ensure_schema();
  const db = get_client();

  await db.execute({
    sql: `
      INSERT OR REPLACE INTO archive_info (id, filename, uploaded_at)
      VALUES (1, ?, CURRENT_TIMESTAMP)
    `,
    args: [filename]
  });
}

/**
 * Get archive info
 */
export async function get_archive_info(): Promise<{ filename: string; uploaded_at: string } | null> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute('SELECT filename, uploaded_at FROM archive_info WHERE id = 1');

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    filename: row.filename as string,
    uploaded_at: row.uploaded_at as string
  };
}

/**
 * Get total post count
 */
export async function get_post_count(): Promise<number> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute('SELECT COUNT(*) as count FROM posts');
  return Number(result.rows[0].count);
}

/**
 * Update HTML content for an existing post
 */
export async function update_post_html(post_id: string, html: string, only_if_empty: boolean = false): Promise<boolean> {
  await ensure_schema();
  const db = get_client();

  const sql = only_if_empty
    ? "UPDATE posts SET content_html = ? WHERE post_id = ? AND (content_html IS NULL OR content_html = '')"
    : 'UPDATE posts SET content_html = ? WHERE post_id = ?';

  const result = await db.execute({
    sql,
    args: [html, post_id]
  });

  return (result.rowsAffected ?? 0) > 0;
}

/**
 * Generate Substack URL from post_id
 */
export function get_post_url(post_id: string): string {
  const parts = post_id.split('.', 2);
  const slug = parts[1] || post_id;
  return `https://8i11.substack.com/p/${encodeURIComponent(slug)}`;
}

/**
 * Get all post IDs in the database
 */
export async function get_all_post_ids(): Promise<string[]> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute('SELECT post_id FROM posts');
  return result.rows.map(row => row.post_id as string);
}

/**
 * Add a single post from RSS feed data
 */
export async function add_post_from_rss(post: {
  post_id: string;
  title: string;
  url: string;
  post_date: string;
  content_html: string;
}): Promise<void> {
  await ensure_schema();
  const db = get_client();

  const local_date = utc_to_mountain(post.post_date);

  await db.execute({
    sql: `
      INSERT OR IGNORE INTO posts (post_id, title, subtitle, post_date, local_date, audience, type, content_html)
      VALUES (?, ?, NULL, ?, ?, 'everyone', 'newsletter', ?)
    `,
    args: [
      post.post_id,
      post.title,
      post.post_date,
      local_date,
      post.content_html
    ]
  });
}

// ============================================================================
// Stories
// ============================================================================

export interface Story {
  id: string;
  date_key: string;
  date_display: string;
  content: string;
  blurb: string | null;
  post_count: number;
  image_url: string | null;
  edited_at: string | null;
  created_at: string;
}

export interface StoredStoryAudit {
  story_id: string;
  source_count: number;
  issue_count: number;
  audit: StoryAudit;
  updated_at: string;
}

/**
 * Generate a short unique ID for stories
 */
function generate_story_id(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Save a generated story (replaces any existing story for this date)
 */
export async function save_story(
  date_key: string,
  date_display: string,
  content: string,
  blurb: string | null,
  post_count: number,
  image_url: string | null = null
): Promise<string> {
  await ensure_schema();
  const db = get_client();

  // Check if a story already exists for this date
  const existing = await db.execute({
    sql: 'SELECT id FROM stories WHERE date_key = ?',
    args: [date_key]
  });

  if (existing.rows.length > 0) {
    // Update existing story (keep the same ID for stable URLs)
    const id = existing.rows[0].id as string;
    await db.execute({
      sql: `
        UPDATE stories
        SET date_display = ?, content = ?, blurb = ?, post_count = ?, image_url = ?, edited_at = NULL, created_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [date_display, content, blurb, post_count, image_url, id]
    });
    return id;
  } else {
    // Create new story
    const id = generate_story_id();
    await db.execute({
      sql: `
        INSERT INTO stories (id, date_key, date_display, content, blurb, post_count, image_url, edited_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      `,
      args: [id, date_key, date_display, content, blurb, post_count, image_url]
    });
    return id;
  }
}

/**
 * Get a story by ID
 */
export async function get_story(id: string): Promise<Story | null> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT * FROM stories WHERE id = ?',
    args: [id]
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id as string,
    date_key: row.date_key as string,
    date_display: row.date_display as string,
    content: row.content as string,
    blurb: (row.blurb as string) || null,
    post_count: row.post_count as number,
    image_url: (row.image_url as string) || null,
    edited_at: (row.edited_at as string) || null,
    created_at: row.created_at as string
  };
}

export async function update_story(
  id: string,
  content: string,
  blurb?: string | null,
  image_url?: string | null
): Promise<Story | null> {
  await ensure_schema();
  const db = get_client();

  const existing = await get_story(id);
  if (!existing) {
    return null;
  }

  await db.execute({
    sql: `
      UPDATE stories
      SET content = ?, blurb = ?, image_url = ?, edited_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    args: [
      content,
      blurb === undefined ? existing.blurb : blurb,
      image_url === undefined ? existing.image_url : image_url,
      id,
    ]
  });

  return get_story(id);
}

export async function save_story_audit(story_id: string, audit: StoryAudit): Promise<void> {
  await ensure_schema();
  const db = get_client();

  await db.execute({
    sql: `
      INSERT INTO story_audits (story_id, source_count, issue_count, audit_json, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(story_id) DO UPDATE SET
        source_count = excluded.source_count,
        issue_count = excluded.issue_count,
        audit_json = excluded.audit_json,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [
      story_id,
      audit.summary.source_count,
      audit.summary.issue_count,
      JSON.stringify(audit)
    ]
  });
}

export async function get_story_audit(story_id: string): Promise<StoredStoryAudit | null> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT * FROM story_audits WHERE story_id = ?',
    args: [story_id]
  });

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    story_id: row.story_id as string,
    source_count: row.source_count as number,
    issue_count: row.issue_count as number,
    audit: JSON.parse(row.audit_json as string) as StoryAudit,
    updated_at: row.updated_at as string
  };
}

/**
 * Clean up duplicate posts where slug matches but post_id format differs
 * Keeps posts with numeric prefix (from CSV), removes slug-only (from RSS)
 * Returns number of duplicates removed
 */
export async function cleanup_duplicate_posts(): Promise<number> {
  await ensure_schema();
  const db = get_client();

  // Get all post_ids
  const all_posts = await db.execute('SELECT id, post_id FROM posts');

  // Group by slug (part after dot, or whole id if no dot)
  const by_slug: Map<string, Array<{ id: number; post_id: string; has_prefix: boolean }>> = new Map();

  for (const row of all_posts.rows) {
    const post_id = row.post_id as string;
    const parts = post_id.split('.', 2);
    const slug = parts.length > 1 ? parts[1] : parts[0];
    const has_prefix = parts.length > 1 && /^\d+$/.test(parts[0]);

    if (!by_slug.has(slug)) {
      by_slug.set(slug, []);
    }
    by_slug.get(slug)!.push({
      id: row.id as number,
      post_id,
      has_prefix
    });
  }

  // Find duplicates and delete the ones without prefix
  let removed = 0;
  for (const [, posts] of by_slug) {
    if (posts.length > 1) {
      // Keep the one with prefix, delete others
      const to_delete = posts.filter(p => !p.has_prefix);
      for (const post of to_delete) {
        await db.execute({
          sql: 'DELETE FROM posts WHERE id = ?',
          args: [post.id]
        });
        removed++;
      }
    }
  }

  return removed;
}

/**
 * Clean up duplicate stories, keeping only the most recent for each date
 * Returns number of duplicates removed
 */
export async function cleanup_duplicate_stories(): Promise<number> {
  await ensure_schema();
  const db = get_client();

  // Find all date_keys with multiple stories
  const duplicates = await db.execute(`
    SELECT date_key, COUNT(*) as count
    FROM stories
    GROUP BY date_key
    HAVING count > 1
  `);

  let removed = 0;

  for (const row of duplicates.rows) {
    const date_key = row.date_key as string;

    // Get all stories for this date, ordered by created_at DESC
    const stories = await db.execute({
      sql: 'SELECT id FROM stories WHERE date_key = ? ORDER BY created_at DESC',
      args: [date_key]
    });

    // Delete all but the first (most recent) one
    for (let i = 1; i < stories.rows.length; i++) {
      await db.execute({
        sql: 'DELETE FROM story_audits WHERE story_id = ?',
        args: [stories.rows[i].id as string]
      });
      await db.execute({
        sql: 'DELETE FROM stories WHERE id = ?',
        args: [stories.rows[i].id as string]
      });
      removed++;
    }
  }

  return removed;
}

/**
 * Get the most recent story for a date
 */
export async function get_story_by_date(date_key: string): Promise<Story | null> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT * FROM stories WHERE date_key = ? ORDER BY created_at DESC LIMIT 1',
    args: [date_key]
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id as string,
    date_key: row.date_key as string,
    date_display: row.date_display as string,
    content: row.content as string,
    blurb: (row.blurb as string) || null,
    post_count: row.post_count as number,
    image_url: (row.image_url as string) || null,
    edited_at: (row.edited_at as string) || null,
    created_at: row.created_at as string
  };
}

/**
 * Get all stories, ordered by date_key
 */
export async function get_all_stories(): Promise<Story[]> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute(
    'SELECT * FROM stories ORDER BY date_key ASC'
  );

  return result.rows.map(row => ({
    id: row.id as string,
    date_key: row.date_key as string,
    date_display: row.date_display as string,
    content: row.content as string,
    blurb: (row.blurb as string) || null,
    post_count: row.post_count as number,
    image_url: (row.image_url as string) || null,
    edited_at: (row.edited_at as string) || null,
    created_at: row.created_at as string
  }));
}

/**
 * Delete a story by ID
 */
export async function delete_story(id: string): Promise<boolean> {
  await ensure_schema();
  const db = get_client();

  await db.execute({
    sql: 'DELETE FROM story_audits WHERE story_id = ?',
    args: [id]
  });

  const result = await db.execute({
    sql: 'DELETE FROM stories WHERE id = ?',
    args: [id]
  });

  return result.rowsAffected > 0;
}

/**
 * Get adjacent stories for navigation (prev/next by date_key)
 */
export async function get_adjacent_stories(date_key: string): Promise<{
  prev: { id: string; date_display: string } | null;
  next: { id: string; date_display: string } | null;
}> {
  await ensure_schema();
  const db = get_client();

  // Get previous story (smaller date_key)
  const prev_result = await db.execute({
    sql: 'SELECT id, date_display FROM stories WHERE date_key < ? ORDER BY date_key DESC LIMIT 1',
    args: [date_key]
  });

  // Get next story (larger date_key)
  const next_result = await db.execute({
    sql: 'SELECT id, date_display FROM stories WHERE date_key > ? ORDER BY date_key ASC LIMIT 1',
    args: [date_key]
  });

  return {
    prev: prev_result.rows.length > 0
      ? { id: prev_result.rows[0].id as string, date_display: prev_result.rows[0].date_display as string }
      : null,
    next: next_result.rows.length > 0
      ? { id: next_result.rows[0].id as string, date_display: next_result.rows[0].date_display as string }
      : null
  };
}

// ============================================================================
// COROS Data
// ============================================================================

export async function save_coros_data(date: string, data_json: string): Promise<void> {
  await ensure_schema();
  const db = get_client();

  await db.execute({
    sql: `INSERT OR REPLACE INTO coros_data (date, data_json, updated_at) VALUES (?, ?, datetime('now'))`,
    args: [date, data_json]
  });
}

export async function get_coros_data(date: string): Promise<{ date: string; data: unknown; source: string; created_at: string; updated_at: string } | null> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT * FROM coros_data WHERE date = ?',
    args: [date]
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    date: row.date as string,
    data: JSON.parse(row.data_json as string),
    source: row.source as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string
  };
}

export async function get_coros_range(start: string, end: string): Promise<Array<{ date: string; data: unknown; source: string; created_at: string; updated_at: string }>> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT * FROM coros_data WHERE date >= ? AND date <= ? ORDER BY date DESC',
    args: [start, end]
  });

  return result.rows.map(row => ({
    date: row.date as string,
    data: JSON.parse(row.data_json as string),
    source: row.source as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string
  }));
}

// ============================================================================
// Suggestions (RETIRED — data preserved in database, code removed)
// ============================================================================

// ============================================================================
// Prompts (Prompt Library)
// ============================================================================

export interface Prompt {
  id: string;
  name: string;
  current_content: string;
  notes: string;
  tags: string[];
  version_count: number;
  created_at: string;
  updated_at: string;
}

export interface PromptVersion {
  id: string;
  prompt_id: string;
  version_number: number;
  content: string;
  note: string | null;
  created_at: string;
}

/**
 * Initialize prompts tables
 */
async function init_prompts_schema(): Promise<void> {
  const db = get_client();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      current_content TEXT NOT NULL,
      version_count INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id TEXT PRIMARY KEY,
      prompt_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id
    ON prompt_versions(prompt_id, version_number DESC)
  `);

  // Migration: add notes column to prompts
  try {
    await db.execute(`ALTER TABLE prompts ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists
  }

  // Migration: add tags column to prompts
  try {
    await db.execute(`ALTER TABLE prompts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`);
  } catch {
    // Column already exists
  }
}

let prompts_schema_initialized = false;
async function ensure_prompts_schema(): Promise<void> {
  if (!prompts_schema_initialized) {
    await init_prompts_schema();
    prompts_schema_initialized = true;
  }
}

/**
 * Generate a short unique ID
 */
function generate_id(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Create a new prompt (no version until first save)
 */
export async function create_prompt(name: string, content: string): Promise<string> {
  await ensure_prompts_schema();
  const db = get_client();

  const prompt_id = generate_id();

  await db.execute({
    sql: `INSERT INTO prompts (id, name, current_content, version_count) VALUES (?, ?, ?, 0)`,
    args: [prompt_id, name, content]
  });

  return prompt_id;
}

/**
 * Get all prompts (metadata only, no version history)
 */
export async function get_all_prompts(): Promise<Prompt[]> {
  await ensure_prompts_schema();
  const db = get_client();

  const result = await db.execute('SELECT * FROM prompts ORDER BY updated_at DESC');

  return result.rows.map(row => ({
    id: row.id as string,
    name: row.name as string,
    current_content: row.current_content as string,
    notes: (row.notes as string) || '',
    tags: JSON.parse((row.tags as string) || '[]') as string[],
    version_count: row.version_count as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string
  }));
}

/**
 * Get a single prompt by ID
 */
export async function get_prompt(id: string): Promise<Prompt | null> {
  await ensure_prompts_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT * FROM prompts WHERE id = ?',
    args: [id]
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id as string,
    name: row.name as string,
    current_content: row.current_content as string,
    notes: (row.notes as string) || '',
    tags: JSON.parse((row.tags as string) || '[]') as string[],
    version_count: row.version_count as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string
  };
}

/**
 * Update prompt notes
 */
export async function update_prompt_notes(id: string, notes: string): Promise<boolean> {
  await ensure_prompts_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'UPDATE prompts SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    args: [notes, id]
  });
  return result.rowsAffected > 0;
}

/**
 * Update prompt tags
 */
export async function update_prompt_tags(id: string, tags: string[]): Promise<boolean> {
  await ensure_prompts_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'UPDATE prompts SET tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    args: [JSON.stringify(tags), id]
  });
  return result.rowsAffected > 0;
}

/**
 * Get all unique tags across all prompts (for autocomplete)
 */
export async function get_all_prompt_tags(): Promise<string[]> {
  await ensure_prompts_schema();
  const db = get_client();

  const result = await db.execute('SELECT tags FROM prompts');
  const tag_set = new Set<string>();

  for (const row of result.rows) {
    const tags: string[] = JSON.parse((row.tags as string) || '[]');
    for (const tag of tags) {
      tag_set.add(tag);
    }
  }

  return Array.from(tag_set).sort();
}

/**
 * Save a new version of a prompt
 * Snapshots the old content as v0 on first save so no version is ever lost
 */
export async function save_prompt_version(
  prompt_id: string,
  content: string,
  note?: string
): Promise<number> {
  await ensure_prompts_schema();
  const db = get_client();

  // Get current content and version count
  const prompt = await db.execute({
    sql: 'SELECT current_content, version_count FROM prompts WHERE id = ?',
    args: [prompt_id]
  });

  if (prompt.rows.length === 0) {
    throw new Error('Prompt not found');
  }

  const old_content = prompt.rows[0].current_content as string;
  const old_version_count = prompt.rows[0].version_count as number;

  // If this is the first save, snapshot the original content as v0
  if (old_version_count === 0) {
    await db.execute({
      sql: `INSERT INTO prompt_versions (id, prompt_id, version_number, content, note) VALUES (?, ?, ?, ?, ?)`,
      args: [generate_id(), prompt_id, 0, old_content, null]
    });
  }

  const new_version = old_version_count + 1;

  // Insert new version
  await db.execute({
    sql: `INSERT INTO prompt_versions (id, prompt_id, version_number, content, note) VALUES (?, ?, ?, ?, ?)`,
    args: [generate_id(), prompt_id, new_version, content, note || null]
  });

  // Update prompt
  await db.execute({
    sql: `UPDATE prompts SET current_content = ?, version_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    args: [content, new_version, prompt_id]
  });

  return new_version;
}

/**
 * Get all versions of a prompt
 */
export async function get_prompt_versions(prompt_id: string): Promise<PromptVersion[]> {
  await ensure_prompts_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number DESC',
    args: [prompt_id]
  });

  return result.rows.map(row => ({
    id: row.id as string,
    prompt_id: row.prompt_id as string,
    version_number: row.version_number as number,
    content: row.content as string,
    note: (row.note as string) || null,
    created_at: row.created_at as string
  }));
}

/**
 * Rename a prompt
 */
export async function rename_prompt(id: string, name: string): Promise<boolean> {
  await ensure_prompts_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'UPDATE prompts SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    args: [name, id]
  });

  return result.rowsAffected > 0;
}

/**
 * Delete a prompt and all its versions
 */
export async function delete_prompt(id: string): Promise<boolean> {
  await ensure_prompts_schema();
  const db = get_client();

  await db.execute({
    sql: 'DELETE FROM prompt_versions WHERE prompt_id = ?',
    args: [id]
  });

  const result = await db.execute({
    sql: 'DELETE FROM prompts WHERE id = ?',
    args: [id]
  });

  return result.rowsAffected > 0;
}

/**
 * Trim old versions, keeping only the most recent N
 * Returns number of versions deleted
 */
export async function trim_prompt_versions(prompt_id: string, keep_count: number): Promise<number> {
  await ensure_prompts_schema();
  const db = get_client();

  // Get versions to delete (all except the latest keep_count)
  const to_delete = await db.execute({
    sql: `SELECT id FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number DESC LIMIT -1 OFFSET ?`,
    args: [prompt_id, keep_count]
  });

  if (to_delete.rows.length === 0) return 0;

  for (const row of to_delete.rows) {
    await db.execute({
      sql: 'DELETE FROM prompt_versions WHERE id = ?',
      args: [row.id as string]
    });
  }

  // Update version_count on the prompt
  const remaining = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM prompt_versions WHERE prompt_id = ?',
    args: [prompt_id]
  });

  await db.execute({
    sql: 'UPDATE prompts SET version_count = ? WHERE id = ?',
    args: [remaining.rows[0].count as number, prompt_id]
  });

  return to_delete.rows.length;
}

// ── Oura Ring Tokens ────────────────────────────────────────

export interface OuraTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}

async function init_oura_schema(): Promise<void> {
  const db = get_client();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS oura_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      scope TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

let oura_schema_initialized = false;
async function ensure_oura_schema(): Promise<void> {
  if (!oura_schema_initialized) {
    await init_oura_schema();
    oura_schema_initialized = true;
  }
}

export async function save_oura_tokens(tokens: OuraTokens): Promise<void> {
  await ensure_oura_schema();
  const db = get_client();

  await db.execute({
    sql: `INSERT INTO oura_tokens (id, access_token, refresh_token, expires_at, scope, updated_at)
          VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            expires_at = excluded.expires_at,
            scope = excluded.scope,
            updated_at = CURRENT_TIMESTAMP`,
    args: [tokens.access_token, tokens.refresh_token, tokens.expires_at, tokens.scope]
  });
}

export async function get_oura_tokens(): Promise<OuraTokens | null> {
  await ensure_oura_schema();
  const db = get_client();

  const result = await db.execute('SELECT access_token, refresh_token, expires_at, scope FROM oura_tokens WHERE id = 1');

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    access_token: row.access_token as string,
    refresh_token: row.refresh_token as string,
    expires_at: row.expires_at as number,
    scope: row.scope as string,
  };
}

export async function delete_oura_tokens(): Promise<boolean> {
  await ensure_oura_schema();
  const db = get_client();

  const result = await db.execute('DELETE FROM oura_tokens WHERE id = 1');
  // Clear personal_info cache so reconnect fetches fresh data
  try { await db.execute('DELETE FROM oura_personal_info WHERE id = 1'); } catch { /* table may not exist */ }
  return result.rowsAffected > 0;
}

export async function refresh_oura_access_token(): Promise<OuraTokens> {
  const tokens = await get_oura_tokens();
  if (!tokens) throw new Error('No Oura tokens found');

  const res = await fetch('https://api.ouraring.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: process.env.OURA_CLIENT_ID || '',
      client_secret: process.env.OURA_CLIENT_SECRET || '',
    }),
  });

  if (!res.ok) {
    const error_text = await res.text();
    throw new Error(`Oura token refresh failed: ${res.status} ${error_text}`);
  }

  const data = await res.json();
  const new_tokens: OuraTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 86400),
    scope: tokens.scope,
  };

  await save_oura_tokens(new_tokens);
  return new_tokens;
}

// ── Google Drive Tokens ─────────────────────────────────────
// One connected Google account (Bill's), same singleton shape as oura_tokens.
// Refreshing lives in lib/google_auth.ts because it needs the owner/error types.

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}

let google_schema_initialized = false;
async function ensure_google_schema(): Promise<void> {
  if (google_schema_initialized) return;
  const db = get_client();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS google_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      scope TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Plans proposed by /api/drive-knowledge/plan, applied by id so the browser
  // never sends the edits it wants written.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS drive_plans (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      applied_at INTEGER
    )
  `);
  google_schema_initialized = true;
}

export async function save_google_tokens(tokens: GoogleTokens): Promise<void> {
  await ensure_google_schema();
  const db = get_client();

  await db.execute({
    sql: `INSERT INTO google_tokens (id, access_token, refresh_token, expires_at, scope, updated_at)
          VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            expires_at = excluded.expires_at,
            scope = excluded.scope,
            updated_at = CURRENT_TIMESTAMP`,
    args: [tokens.access_token, tokens.refresh_token, tokens.expires_at, tokens.scope]
  });
}

export async function get_google_tokens(): Promise<GoogleTokens | null> {
  await ensure_google_schema();
  const db = get_client();

  const result = await db.execute('SELECT access_token, refresh_token, expires_at, scope FROM google_tokens WHERE id = 1');
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    access_token: row.access_token as string,
    refresh_token: row.refresh_token as string,
    expires_at: row.expires_at as number,
    scope: row.scope as string,
  };
}

export async function delete_google_tokens(): Promise<boolean> {
  await ensure_google_schema();
  const db = get_client();

  const result = await db.execute('DELETE FROM google_tokens WHERE id = 1');
  return result.rowsAffected > 0;
}

// ── Drive Filing Plans ──────────────────────────────────────

const DRIVE_PLAN_TTL_SECONDS = 30 * 60;

export async function save_drive_plan(id: string, payload: unknown): Promise<void> {
  await ensure_google_schema();
  const db = get_client();
  const now = Math.floor(Date.now() / 1000);

  // Old plans are only useful for a short while; prune as we go.
  await db.execute({ sql: 'DELETE FROM drive_plans WHERE created_at < ?', args: [now - 24 * 60 * 60] });
  await db.execute({
    sql: 'INSERT INTO drive_plans (id, payload, created_at) VALUES (?, ?, ?)',
    args: [id, JSON.stringify(payload), now]
  });
}

/**
 * Atomically claim an unexpired, unapplied plan and return its payload, or null.
 * Claiming before writing means a double-click or retry can't apply it twice.
 */
export async function claim_drive_plan(id: string): Promise<unknown | null> {
  await ensure_google_schema();
  const db = get_client();
  const now = Math.floor(Date.now() / 1000);

  const claimed = await db.execute({
    sql: 'UPDATE drive_plans SET applied_at = ? WHERE id = ? AND applied_at IS NULL AND created_at >= ?',
    args: [now, id, now - DRIVE_PLAN_TTL_SECONDS]
  });
  if (claimed.rowsAffected !== 1) return null;

  const result = await db.execute({ sql: 'SELECT payload FROM drive_plans WHERE id = ?', args: [id] });
  return result.rows.length ? JSON.parse(result.rows[0].payload as string) : null;
}

// ── Wellness Cache ──────────────────────────────────────────

export interface WellnessSnapshot {
  date: string;
  sleep_score: number | null;
  readiness_score: number | null;
  activity_score: number | null;
  stress_high: number | null;
  recovery_high: number | null;
  hrv_average: number | null;
  resting_hr: number | null;
  spo2_average: number | null;
  steps: number | null;
  active_calories: number | null;
  daily_sleep: unknown | null;
  daily_readiness: unknown | null;
  daily_activity: unknown | null;
  daily_stress: unknown | null;
  daily_resilience: unknown | null;
  daily_cardiovascular_age: unknown | null;
  daily_spo2: unknown | null;
  sleep_detail: unknown | null;
  heartrate: unknown | null;
  vo2_max: unknown | null;
  workouts: unknown | null;
  sessions: unknown | null;
  sleep_time: unknown | null;
  fetched_at: string;
}

export interface OuraPersonalInfo {
  age: number | null;
  weight: number | null;
  height: number | null;
  biological_sex: string | null;
  email: string | null;
  fetched_at: string;
}

export interface WellnessScores {
  date: string;
  sleep_score: number | null;
  readiness_score: number | null;
  activity_score: number | null;
  stress_high: number | null;
  recovery_high: number | null;
  hrv_average: number | null;
  resting_hr: number | null;
  spo2_average: number | null;
  steps: number | null;
  active_calories: number | null;
}

async function init_wellness_schema(): Promise<void> {
  const db = get_client();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS wellness_cache (
      date TEXT PRIMARY KEY,
      sleep_score INTEGER,
      readiness_score INTEGER,
      activity_score INTEGER,
      stress_high INTEGER,
      recovery_high INTEGER,
      hrv_average REAL,
      resting_hr INTEGER,
      spo2_average REAL,
      steps INTEGER,
      active_calories INTEGER,
      daily_sleep_json TEXT,
      daily_readiness_json TEXT,
      daily_activity_json TEXT,
      daily_stress_json TEXT,
      daily_resilience_json TEXT,
      daily_cardiovascular_age_json TEXT,
      daily_spo2_json TEXT,
      sleep_json TEXT,
      heartrate_json TEXT,
      vo2_max_json TEXT,
      workout_json TEXT,
      session_json TEXT,
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

let wellness_schema_initialized = false;
async function ensure_wellness_schema(): Promise<void> {
  if (!wellness_schema_initialized) {
    await init_wellness_schema();
    // Migration: add sleep_time_json column
    const db = get_client();
    try {
      await db.execute(`ALTER TABLE wellness_cache ADD COLUMN sleep_time_json TEXT`);
    } catch {
      // Column already exists
    }
    wellness_schema_initialized = true;
  }
}

export async function get_wellness_cache(date: string): Promise<WellnessSnapshot | null> {
  await ensure_wellness_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT * FROM wellness_cache WHERE date = ?',
    args: [date]
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    date: row.date as string,
    sleep_score: row.sleep_score as number | null,
    readiness_score: row.readiness_score as number | null,
    activity_score: row.activity_score as number | null,
    stress_high: row.stress_high as number | null,
    recovery_high: row.recovery_high as number | null,
    hrv_average: row.hrv_average as number | null,
    resting_hr: row.resting_hr as number | null,
    spo2_average: row.spo2_average as number | null,
    steps: row.steps as number | null,
    active_calories: row.active_calories as number | null,
    daily_sleep: row.daily_sleep_json ? JSON.parse(row.daily_sleep_json as string) : null,
    daily_readiness: row.daily_readiness_json ? JSON.parse(row.daily_readiness_json as string) : null,
    daily_activity: row.daily_activity_json ? JSON.parse(row.daily_activity_json as string) : null,
    daily_stress: row.daily_stress_json ? JSON.parse(row.daily_stress_json as string) : null,
    daily_resilience: row.daily_resilience_json ? JSON.parse(row.daily_resilience_json as string) : null,
    daily_cardiovascular_age: row.daily_cardiovascular_age_json ? JSON.parse(row.daily_cardiovascular_age_json as string) : null,
    daily_spo2: row.daily_spo2_json ? JSON.parse(row.daily_spo2_json as string) : null,
    sleep_detail: row.sleep_json ? JSON.parse(row.sleep_json as string) : null,
    heartrate: row.heartrate_json ? JSON.parse(row.heartrate_json as string) : null,
    vo2_max: row.vo2_max_json ? JSON.parse(row.vo2_max_json as string) : null,
    workouts: row.workout_json ? JSON.parse(row.workout_json as string) : null,
    sessions: row.session_json ? JSON.parse(row.session_json as string) : null,
    sleep_time: row.sleep_time_json ? JSON.parse(row.sleep_time_json as string) : null,
    fetched_at: row.fetched_at as string,
  };
}

export async function save_wellness_cache(snapshot: WellnessSnapshot): Promise<void> {
  await ensure_wellness_schema();
  const db = get_client();

  await db.execute({
    sql: `INSERT OR REPLACE INTO wellness_cache (
      date, sleep_score, readiness_score, activity_score,
      stress_high, recovery_high, hrv_average, resting_hr,
      spo2_average, steps, active_calories,
      daily_sleep_json, daily_readiness_json, daily_activity_json,
      daily_stress_json, daily_resilience_json, daily_cardiovascular_age_json,
      daily_spo2_json, sleep_json, heartrate_json,
      vo2_max_json, workout_json, session_json, sleep_time_json,
      fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    args: [
      snapshot.date,
      snapshot.sleep_score,
      snapshot.readiness_score,
      snapshot.activity_score,
      snapshot.stress_high,
      snapshot.recovery_high,
      snapshot.hrv_average,
      snapshot.resting_hr,
      snapshot.spo2_average,
      snapshot.steps,
      snapshot.active_calories,
      snapshot.daily_sleep ? JSON.stringify(snapshot.daily_sleep) : null,
      snapshot.daily_readiness ? JSON.stringify(snapshot.daily_readiness) : null,
      snapshot.daily_activity ? JSON.stringify(snapshot.daily_activity) : null,
      snapshot.daily_stress ? JSON.stringify(snapshot.daily_stress) : null,
      snapshot.daily_resilience ? JSON.stringify(snapshot.daily_resilience) : null,
      snapshot.daily_cardiovascular_age ? JSON.stringify(snapshot.daily_cardiovascular_age) : null,
      snapshot.daily_spo2 ? JSON.stringify(snapshot.daily_spo2) : null,
      snapshot.sleep_detail ? JSON.stringify(snapshot.sleep_detail) : null,
      snapshot.heartrate ? JSON.stringify(snapshot.heartrate) : null,
      snapshot.vo2_max ? JSON.stringify(snapshot.vo2_max) : null,
      snapshot.workouts ? JSON.stringify(snapshot.workouts) : null,
      snapshot.sessions ? JSON.stringify(snapshot.sessions) : null,
      snapshot.sleep_time ? JSON.stringify(snapshot.sleep_time) : null,
    ]
  });
}

export async function get_wellness_range(
  start_date: string,
  end_date: string
): Promise<WellnessSnapshot[]> {
  await ensure_wellness_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT * FROM wellness_cache WHERE date >= ? AND date <= ? ORDER BY date ASC',
    args: [start_date, end_date]
  });

  return result.rows.map(row => ({
    date: row.date as string,
    sleep_score: row.sleep_score as number | null,
    readiness_score: row.readiness_score as number | null,
    activity_score: row.activity_score as number | null,
    stress_high: row.stress_high as number | null,
    recovery_high: row.recovery_high as number | null,
    hrv_average: row.hrv_average as number | null,
    resting_hr: row.resting_hr as number | null,
    spo2_average: row.spo2_average as number | null,
    steps: row.steps as number | null,
    active_calories: row.active_calories as number | null,
    daily_sleep: row.daily_sleep_json ? JSON.parse(row.daily_sleep_json as string) : null,
    daily_readiness: row.daily_readiness_json ? JSON.parse(row.daily_readiness_json as string) : null,
    daily_activity: row.daily_activity_json ? JSON.parse(row.daily_activity_json as string) : null,
    daily_stress: row.daily_stress_json ? JSON.parse(row.daily_stress_json as string) : null,
    daily_resilience: row.daily_resilience_json ? JSON.parse(row.daily_resilience_json as string) : null,
    daily_cardiovascular_age: row.daily_cardiovascular_age_json ? JSON.parse(row.daily_cardiovascular_age_json as string) : null,
    daily_spo2: row.daily_spo2_json ? JSON.parse(row.daily_spo2_json as string) : null,
    sleep_detail: row.sleep_json ? JSON.parse(row.sleep_json as string) : null,
    heartrate: row.heartrate_json ? JSON.parse(row.heartrate_json as string) : null,
    vo2_max: row.vo2_max_json ? JSON.parse(row.vo2_max_json as string) : null,
    workouts: row.workout_json ? JSON.parse(row.workout_json as string) : null,
    sessions: row.session_json ? JSON.parse(row.session_json as string) : null,
    sleep_time: row.sleep_time_json ? JSON.parse(row.sleep_time_json as string) : null,
    fetched_at: row.fetched_at as string,
  }));
}

export async function get_wellness_scores(
  start_date: string,
  end_date: string
): Promise<WellnessScores[]> {
  await ensure_wellness_schema();
  const db = get_client();

  const result = await db.execute({
    sql: `SELECT date, sleep_score, readiness_score, activity_score,
      stress_high, recovery_high, hrv_average, resting_hr,
      spo2_average, steps, active_calories
    FROM wellness_cache WHERE date >= ? AND date <= ? ORDER BY date ASC`,
    args: [start_date, end_date]
  });

  return result.rows.map(row => ({
    date: row.date as string,
    sleep_score: row.sleep_score as number | null,
    readiness_score: row.readiness_score as number | null,
    activity_score: row.activity_score as number | null,
    stress_high: row.stress_high as number | null,
    recovery_high: row.recovery_high as number | null,
    hrv_average: row.hrv_average as number | null,
    resting_hr: row.resting_hr as number | null,
    spo2_average: row.spo2_average as number | null,
    steps: row.steps as number | null,
    active_calories: row.active_calories as number | null,
  }));
}

// ── Oura Personal Info ──────────────────────────────────────

async function init_personal_info_schema(): Promise<void> {
  const db = get_client();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS oura_personal_info (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      age INTEGER,
      weight REAL,
      height REAL,
      biological_sex TEXT,
      email TEXT,
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

let personal_info_schema_initialized = false;
async function ensure_personal_info_schema(): Promise<void> {
  if (!personal_info_schema_initialized) {
    await init_personal_info_schema();
    personal_info_schema_initialized = true;
  }
}

export async function save_personal_info(info: OuraPersonalInfo): Promise<void> {
  await ensure_personal_info_schema();
  const db = get_client();
  await db.execute({
    sql: `INSERT INTO oura_personal_info (id, age, weight, height, biological_sex, email, fetched_at)
          VALUES (1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            age = excluded.age, weight = excluded.weight, height = excluded.height,
            biological_sex = excluded.biological_sex, email = excluded.email,
            fetched_at = CURRENT_TIMESTAMP`,
    args: [info.age, info.weight, info.height, info.biological_sex, info.email]
  });
}

export async function get_personal_info(): Promise<OuraPersonalInfo | null> {
  await ensure_personal_info_schema();
  const db = get_client();
  const result = await db.execute('SELECT * FROM oura_personal_info WHERE id = 1');
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    age: row.age as number | null,
    weight: row.weight as number | null,
    height: row.height as number | null,
    biological_sex: (row.biological_sex as string) || null,
    email: (row.email as string) || null,
    fetched_at: row.fetched_at as string,
  };
}

export async function is_wellness_cached(date: string): Promise<boolean> {
  await ensure_wellness_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT 1 FROM wellness_cache WHERE date = ?',
    args: [date]
  });

  return result.rows.length > 0;
}

// ============================================================================
// Text Notes (Say What? saved notes)
// ============================================================================

export interface TextNote {
  id: string;
  content: string;
  created_at: string;
}

export async function save_text_note(content: string): Promise<string> {
  await ensure_schema();
  const db = get_client();

  const id = generate_story_id();
  await db.execute({
    sql: 'INSERT INTO text_notes (id, content) VALUES (?, ?)',
    args: [id, content]
  });
  return id;
}

export async function get_text_notes(): Promise<TextNote[]> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute('SELECT * FROM text_notes ORDER BY created_at DESC');
  return result.rows.map(row => ({
    id: row.id as string,
    content: row.content as string,
    created_at: row.created_at as string
  }));
}

export async function delete_text_note(id: string): Promise<boolean> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'DELETE FROM text_notes WHERE id = ?',
    args: [id]
  });
  return result.rowsAffected > 0;
}

// ============================================================================
// Substack title history (Say What? → Substack Post)
// ============================================================================

/**
 * Titles already published to Substack, newest first. The `posts` table is the
 * Substack archive import, so these are the real used-title history.
 */
export async function get_published_titles(limit: number = 200): Promise<TitlePair[]> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT title, subtitle FROM posts ORDER BY local_date DESC LIMIT ?',
    args: [limit]
  });

  return result.rows.map(row => ({
    title: (row.title as string) || '',
    subtitle: (row.subtitle as string) || ''
  })).filter(p => p.title);
}

/**
 * Title + subtitle pairs from published posts, for voice grounding.
 *
 * Deliberately NOT limited by recency: sample_voice_exemplars spreads across
 * years, and truncating by date here would make the excluded years unreachable
 * no matter what the sampler does. Three narrow columns across the archive is
 * cheap.
 *
 * The subtitle filter is load-bearing — add_post_from_rss inserts subtitle as
 * NULL with INSERT OR IGNORE, so RSS-seen posts never gain one on the
 * incremental path. A full re-import restores them.
 */
export async function get_voice_pool(): Promise<VoiceExemplar[]> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute(`
    SELECT title, subtitle, local_date FROM posts
    WHERE subtitle IS NOT NULL AND trim(subtitle) <> ''
  `);

  return result.rows
    .map(row => ({
      title: ((row.title as string) || '').trim(),
      subtitle: ((row.subtitle as string) || '').trim(),
      year: parseInt(((row.local_date as string) || '').substring(0, 4), 10),
    }))
    .filter(e => e.title && e.subtitle && Number.isFinite(e.year));
}

/** Titles the generator has previously offered, newest first. */
export async function get_generated_titles(limit: number = 200): Promise<TitlePair[]> {
  await ensure_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT title, subtitle FROM substack_titles ORDER BY id DESC LIMIT ?',
    args: [limit]
  });

  return result.rows.map(row => ({
    title: (row.title as string) || '',
    subtitle: (row.subtitle as string) || ''
  })).filter(p => p.title);
}

/** Record offered titles. Duplicates are ignored via the unique norm index. */
export async function record_generated_titles(pairs: TitlePair[]): Promise<void> {
  if (pairs.length === 0) return;
  await ensure_schema();
  const db = get_client();

  for (const pair of pairs) {
    const norm = normalize_title(pair.title);
    if (!norm) continue;
    try {
      await db.execute({
        sql: 'INSERT OR IGNORE INTO substack_titles (title, subtitle, title_norm) VALUES (?, ?, ?)',
        args: [pair.title, pair.subtitle || null, norm]
      });
    } catch (e) {
      // Title history is best-effort — never fail a generation over it
      console.error('record_generated_titles failed:', e instanceof Error ? e.message : String(e));
    }
  }
}

// ============================================================================
// Worklog (RETIRED — data preserved in database, code removed)
// ============================================================================
