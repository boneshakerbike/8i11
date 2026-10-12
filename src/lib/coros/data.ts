/**
 * COROS data synced through MCP: one row per day plus one row per activity.
 *
 * Writes merge, never replace: a value missing from one sync keeps what an
 * earlier sync stored (same rule as daily_metrics). History is never pruned.
 */

import type { Client } from '@libsql/client';
import type { CorosActivity, CorosActivityDetail } from '@/lib/coros/parse';

/** One day of COROS data, assembled from several tools. Every field but date may be missing. */
export interface CorosDay {
  date: string;
  steps?: number | null;
  exercise_min?: number | null;
  stress_avg?: number | null;
  sleep_total_min?: number | null;
  sleep_deep_min?: number | null;
  sleep_light_min?: number | null;
  sleep_rem_min?: number | null;
  sleep_awake_min?: number | null;
  sleep_hr_avg?: number | null;
  hrv_avg?: number | null;
  hrv_status?: string | null;
  hrv_baseline?: number | null;
  resting_hr?: number | null;
  load_short?: number | null;
  load_long?: number | null;
  load_ratio?: number | null;
  load_comment?: string | null;
  recovery_pct?: number | null;
  recovery_level?: string | null;
  vo2max?: number | null;
}

export const COROS_DAY_COLUMNS = [
  'steps', 'exercise_min', 'stress_avg',
  'sleep_total_min', 'sleep_deep_min', 'sleep_light_min', 'sleep_rem_min', 'sleep_awake_min', 'sleep_hr_avg',
  'hrv_avg', 'hrv_status', 'hrv_baseline', 'resting_hr',
  'load_short', 'load_long', 'load_ratio', 'load_comment',
  'recovery_pct', 'recovery_level', 'vo2max',
] as const satisfies readonly (keyof CorosDay)[];

const ACTIVITY_COLUMNS = [
  'sport_type', 'sport_name', 'date', 'start_ts', 'end_ts', 'duration_s', 'distance_m',
  'sets', 'avg_hr', 'calories', 'avg_speed_kmh', 'location',
] as const satisfies readonly (keyof CorosActivity)[];

const now_s = () => Math.floor(Date.now() / 1000);

const merge_set = (cols: readonly string[], table: string) =>
  cols.map(c => `${c} = COALESCE(excluded.${c}, ${table}.${c})`).join(', ');

const ensured = new WeakSet<Client>();

export async function ensure_coros_tables(db: Client): Promise<void> {
  if (ensured.has(db)) return;
  await db.batch([
    `CREATE TABLE IF NOT EXISTS coros_daily (
      date TEXT PRIMARY KEY,
      steps INTEGER, exercise_min INTEGER, stress_avg INTEGER,
      sleep_total_min INTEGER, sleep_deep_min INTEGER, sleep_light_min INTEGER,
      sleep_rem_min INTEGER, sleep_awake_min INTEGER, sleep_hr_avg INTEGER,
      hrv_avg INTEGER, hrv_status TEXT, hrv_baseline INTEGER, resting_hr INTEGER,
      load_short REAL, load_long REAL, load_ratio REAL, load_comment TEXT,
      recovery_pct INTEGER, recovery_level TEXT, vo2max REAL,
      updated_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS coros_activities (
      label_id TEXT PRIMARY KEY,
      sport_type INTEGER, sport_name TEXT, date TEXT,
      start_ts INTEGER, end_ts INTEGER, duration_s INTEGER, distance_m INTEGER,
      sets INTEGER, avg_hr INTEGER, calories INTEGER, avg_speed_kmh REAL, location TEXT,
      ascent_m REAL, descent_m REAL,
      updated_at INTEGER
    )`,
    'CREATE INDEX IF NOT EXISTS idx_coros_activities_date ON coros_activities(date)',
  ], 'write');
  // Added after the table first shipped: when getActivityDetail was last called.
  try {
    await db.execute('ALTER TABLE coros_activities ADD COLUMN detail_fetched_at INTEGER');
  } catch {
    // Column already exists
  }
  ensured.add(db);
}

/**
 * Outdoor sports whose detail carries elevation: run, trail, track, hike,
 * climb, outdoor/e/gravel/mountain bikes, walk, and the custom outdoor type
 * one e-MTB ride was logged as.
 */
export const DETAIL_SPORT_TYPES = [100, 102, 103, 104, 105, 200, 202, 203, 204, 205, 900, 9806] as const;

/** Activities never asked for detail yet, newest first. */
export async function activities_needing_detail(db: Client, limit: number): Promise<Array<{ label_id: string; sport_type: number }>> {
  await ensure_coros_tables(db);
  const r = await db.execute({
    sql: `SELECT label_id, sport_type FROM coros_activities
          WHERE detail_fetched_at IS NULL AND sport_type IN (${DETAIL_SPORT_TYPES.join(', ')})
          ORDER BY start_ts DESC LIMIT ?`,
    args: [limit],
  });
  return r.rows.map(row => ({ label_id: String(row.label_id), sport_type: Number(row.sport_type) }));
}

/** Store elevation (when found) and mark the activity as fetched either way, so it is asked once. */
export async function save_activity_detail(db: Client, label_id: string, detail: CorosActivityDetail | null): Promise<void> {
  await ensure_coros_tables(db);
  await db.execute({
    sql: `UPDATE coros_activities SET
            ascent_m = COALESCE(?, ascent_m), descent_m = COALESCE(?, descent_m),
            detail_fetched_at = ?, updated_at = ?
          WHERE label_id = ?`,
    args: [detail?.ascent_m ?? null, detail?.descent_m ?? null, now_s(), now_s(), label_id],
  });
}

export async function save_coros_days(db: Client, days: CorosDay[]): Promise<number> {
  if (days.length === 0) return 0;
  await ensure_coros_tables(db);
  const sql = `INSERT INTO coros_daily (date, ${COROS_DAY_COLUMNS.join(', ')}, updated_at)
    VALUES (?, ${COROS_DAY_COLUMNS.map(() => '?').join(', ')}, ?)
    ON CONFLICT(date) DO UPDATE SET ${merge_set(COROS_DAY_COLUMNS, 'coros_daily')}, updated_at = excluded.updated_at`;
  await db.batch(days.map(d => ({
    sql,
    args: [d.date, ...COROS_DAY_COLUMNS.map(c => d[c] ?? null), now_s()],
  })), 'write');
  return days.length;
}

export async function save_coros_activities(db: Client, activities: CorosActivity[]): Promise<number> {
  if (activities.length === 0) return 0;
  await ensure_coros_tables(db);
  const sql = `INSERT INTO coros_activities (label_id, ${ACTIVITY_COLUMNS.join(', ')}, updated_at)
    VALUES (?, ${ACTIVITY_COLUMNS.map(() => '?').join(', ')}, ?)
    ON CONFLICT(label_id) DO UPDATE SET ${merge_set(ACTIVITY_COLUMNS, 'coros_activities')}, updated_at = excluded.updated_at`;
  await db.batch(activities.map(a => ({
    sql,
    args: [a.label_id, ...ACTIVITY_COLUMNS.map(c => a[c] ?? null), now_s()],
  })), 'write');
  return activities.length;
}

export async function get_coros_days(db: Client, start: string, end: string): Promise<CorosDay[]> {
  await ensure_coros_tables(db);
  const r = await db.execute({ sql: 'SELECT * FROM coros_daily WHERE date >= ? AND date <= ? ORDER BY date DESC', args: [start, end] });
  return r.rows.map(row => {
    const day: CorosDay = { date: String(row.date) };
    for (const c of COROS_DAY_COLUMNS) (day as unknown as Record<string, unknown>)[c] = row[c] ?? null;
    return day;
  });
}

export async function get_coros_activities(db: Client, start: string, end: string): Promise<(CorosActivity & { ascent_m: number | null; descent_m: number | null })[]> {
  await ensure_coros_tables(db);
  const r = await db.execute({ sql: 'SELECT * FROM coros_activities WHERE date >= ? AND date <= ? ORDER BY start_ts DESC', args: [start, end] });
  return r.rows.map(row => ({
    label_id: String(row.label_id),
    sport_type: Number(row.sport_type),
    sport_name: String(row.sport_name ?? ''),
    date: String(row.date),
    start_ts: row.start_ts as number | null,
    end_ts: row.end_ts as number | null,
    duration_s: row.duration_s as number | null,
    distance_m: row.distance_m as number | null,
    sets: row.sets as number | null,
    avg_hr: row.avg_hr as number | null,
    calories: row.calories as number | null,
    avg_speed_kmh: row.avg_speed_kmh as number | null,
    location: row.location as string | null,
    ascent_m: row.ascent_m as number | null,
    descent_m: row.descent_m as number | null,
  }));
}
