/**
 * COROS data synced through MCP: one row per day plus one row per activity.
 *
 * Writes merge, never replace: a value missing from one sync keeps what an
 * earlier sync stored (same rule as daily_metrics). History is never pruned.
 */

import type { Client } from '@libsql/client';
import type { CorosActivity, CorosActivityDetail, CorosStrengthLaps } from '@/lib/coros/parse';
import { STRENGTH_SPORT_TYPE } from '@/lib/coros/classify';

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
  // Added after the table first shipped. ALTER fails harmlessly once a column exists.
  for (const column of [
    'detail_fetched_at INTEGER', // when getActivityDetail was last read
    'detail_version INTEGER',    // DETAIL_VERSION of the parser that read it
    'aerobic_te REAL',
    'anaerobic_te REAL',
    'training_focus TEXT',
    'exercises TEXT',            // JSON array of exercise names (strength sessions)
    'working_sets INTEGER',
    'loaded_sets INTEGER',
  ]) {
    try {
      await db.execute(`ALTER TABLE coros_activities ADD COLUMN ${column}`);
    } catch {
      // Column already exists
    }
  }
  ensured.add(db);
}

/**
 * Outdoor sports whose detail can carry elevation: run, trail, track, hike,
 * climb, outdoor/e/gravel/mountain bikes, walk. Custom sports (9800-9807,
 * e.g. Bill's "Missoula E MTB" logged as 9806) get a generic detail with no
 * elevation line (checked 2026-10-12), so they are not asked.
 */
export const DETAIL_SPORT_TYPES = [100, 102, 103, 104, 105, 200, 202, 203, 204, 205, 900] as const;

/**
 * Bump when the detail parser starts reading something new: activities read
 * by an older version are asked once more. 1 = elevation, 2 = + training
 * effect and focus. Strength sessions were first read at 2 (exercises from
 * queryActivityLapData); a bump re-asks them too, a few calls once.
 */
export const DETAIL_VERSION = 2;

/**
 * Activities not yet read by the current detail parser, newest first, strength
 * sessions included. The whole queue, so the sync can say how many wait for
 * the next run; it stays short because each activity is asked once.
 */
export async function activities_needing_detail(db: Client): Promise<Array<{ label_id: string; sport_type: number; sets: number | null }>> {
  await ensure_coros_tables(db);
  const r = await db.execute({
    sql: `SELECT label_id, sport_type, sets FROM coros_activities
          WHERE COALESCE(detail_version, CASE WHEN detail_fetched_at IS NULL THEN 0 ELSE 1 END) < ?
            AND sport_type IN (${[...DETAIL_SPORT_TYPES, STRENGTH_SPORT_TYPE].join(', ')})
          ORDER BY start_ts DESC`,
    args: [DETAIL_VERSION],
  });
  return r.rows.map(row => ({
    label_id: String(row.label_id),
    sport_type: Number(row.sport_type),
    sets: row.sets == null ? null : Number(row.sets),
  }));
}

/** Store what the detail had and mark it read by this parser version, found or not, so it is asked once. */
export async function save_activity_detail(db: Client, label_id: string, detail: CorosActivityDetail | null): Promise<void> {
  await ensure_coros_tables(db);
  await db.execute({
    sql: `UPDATE coros_activities SET
            ascent_m = COALESCE(?, ascent_m), descent_m = COALESCE(?, descent_m),
            aerobic_te = COALESCE(?, aerobic_te), anaerobic_te = COALESCE(?, anaerobic_te),
            training_focus = COALESCE(?, training_focus),
            detail_fetched_at = ?, detail_version = ?, updated_at = ?
          WHERE label_id = ?`,
    args: [
      detail?.ascent_m ?? null, detail?.descent_m ?? null,
      detail?.aerobic_te ?? null, detail?.anaerobic_te ?? null, detail?.training_focus ?? null,
      now_s(), DETAIL_VERSION, now_s(), label_id,
    ],
  });
}

/** Store a strength session's exercises and mark it read, found or not, so it is asked once. */
export async function save_strength_laps(db: Client, label_id: string, laps: CorosStrengthLaps | null): Promise<void> {
  await ensure_coros_tables(db);
  await db.execute({
    sql: `UPDATE coros_activities SET
            exercises = COALESCE(?, exercises), working_sets = COALESCE(?, working_sets),
            loaded_sets = COALESCE(?, loaded_sets),
            detail_fetched_at = ?, detail_version = ?, updated_at = ?
          WHERE label_id = ?`,
    args: [
      laps ? JSON.stringify(laps.exercises) : null, laps?.working_sets ?? null, laps?.loaded_sets ?? null,
      now_s(), DETAIL_VERSION, now_s(), label_id,
    ],
  });
}

/**
 * Save the COROS profile weight as today's weight (daily_metrics.weight_lbs,
 * which the scorecard, brief and Weight card read). COROS keeps only the
 * current value with no date, so it is saved only when it differs from the
 * latest saved weight: on a morning Bill didn't update it (a trip), the old
 * number must not count as a new reading. The first sync of a new week (Monday,
 * Mountain Time) saves it even when unchanged, so the weekly scorecard always
 * has his current weight. Returns true when saved.
 */
export async function save_coros_weight(db: Client, today: string, lbs: number): Promise<boolean> {
  const epoch_day = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86400000);
  const week_start_day = epoch_day - (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const latest = await db.execute({
    sql: 'SELECT date, weight_lbs FROM daily_metrics WHERE weight_lbs IS NOT NULL AND date <= ? ORDER BY date DESC LIMIT 1',
    args: [epoch_day],
  });
  const previous = latest.rows[0];
  if (previous && Number(previous.date) >= week_start_day && Math.abs(Number(previous.weight_lbs) - lbs) < 0.05) return false;
  await db.execute({
    sql: `INSERT INTO daily_metrics (date, weight_lbs, created_at, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(date) DO UPDATE SET weight_lbs = excluded.weight_lbs, updated_at = excluded.updated_at`,
    args: [epoch_day, lbs, now_s(), now_s()],
  });
  return true;
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

export type StoredCorosActivity = CorosActivity & CorosActivityDetail & {
  exercises: string[] | null;
  working_sets: number | null;
  loaded_sets: number | null;
};

function exercise_list(value: unknown): string[] | null {
  if (typeof value !== 'string') return null;
  try {
    const list = JSON.parse(value);
    return Array.isArray(list) ? list.map(String) : null;
  } catch {
    return null;
  }
}

export async function get_coros_activities(db: Client, start: string, end: string): Promise<StoredCorosActivity[]> {
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
    aerobic_te: row.aerobic_te as number | null,
    anaerobic_te: row.anaerobic_te as number | null,
    training_focus: row.training_focus as string | null,
    exercises: exercise_list(row.exercises),
    working_sets: row.working_sets as number | null,
    loaded_sets: row.loaded_sets as number | null,
  }));
}
