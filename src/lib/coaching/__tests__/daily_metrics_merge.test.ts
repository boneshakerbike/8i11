import { describe, expect, it, beforeEach } from 'vitest';
import { createClient, type Client, type InValue } from '@libsql/client';
import { DAILY_METRICS_MERGE_SQL } from '@/lib/coaching/db';

// Only the columns this test reads matter; the merge SQL names every column,
// so the table must have them all.
const SCHEMA = `CREATE TABLE daily_metrics (
  date INTEGER PRIMARY KEY,
  sleep_duration_min INTEGER, sleep_efficiency_pct REAL, deep_sleep_min INTEGER, rem_sleep_min INTEGER,
  hrv_rmssd REAL, resting_hr INTEGER, readiness_score INTEGER, cardiovascular_age INTEGER, spo2_average REAL,
  vo2_max REAL, training_load_acute INTEGER, training_load_chronic INTEGER, recovery_pct INTEGER,
  zone2_min_weekly INTEGER, vo2max_intervals_weekly INTEGER,
  weight_lbs REAL, back_pain_scale INTEGER, back_mobility_notes TEXT, bowel_status TEXT, bowel_scale INTEGER, injury_notes TEXT,
  created_at INTEGER, updated_at INTEGER
)`;

const COLUMN_COUNT = 21;

function row_args(date: number, values: Record<number, InValue>, created: number, updated: number): InValue[] {
  const data = Array.from({ length: COLUMN_COUNT }, (_, i): InValue => (i in values ? values[i] : null));
  return [date, ...data, created, updated];
}

// Positions in DAILY_METRIC_COLUMNS
const HRV = 4;
const WEIGHT = 15;
const BACK = 16;
const NOTES = 20;

describe('DAILY_METRICS_MERGE_SQL', () => {
  let db: Client;

  beforeEach(async () => {
    db = createClient({ url: ':memory:' });
    await db.execute(SCHEMA);
  });

  it('keeps saved session inputs when the nightly cron runs without them', async () => {
    // Session save: live HRV plus manual inputs
    await db.execute({ sql: DAILY_METRICS_MERGE_SQL, args: row_args(20000, { [HRV]: 62, [WEIGHT]: 191, [BACK]: 1, [NOTES]: 'feel good' }, 100, 100) });
    // Cron next morning: no manual inputs, no Oura cache
    await db.execute({ sql: DAILY_METRICS_MERGE_SQL, args: row_args(20000, {}, 200, 200) });

    const r = await db.execute('SELECT hrv_rmssd, weight_lbs, back_pain_scale, injury_notes, created_at, updated_at FROM daily_metrics WHERE date = 20000');
    expect(r.rows[0]).toMatchObject({ hrv_rmssd: 62, weight_lbs: 191, back_pain_scale: 1, injury_notes: 'feel good', created_at: 100, updated_at: 200 });
  });

  it('lets a later non-null value replace an earlier one', async () => {
    await db.execute({ sql: DAILY_METRICS_MERGE_SQL, args: row_args(20001, { [HRV]: 55 }, 100, 100) });
    await db.execute({ sql: DAILY_METRICS_MERGE_SQL, args: row_args(20001, { [HRV]: 58 }, 200, 200) });

    const r = await db.execute('SELECT hrv_rmssd FROM daily_metrics WHERE date = 20001');
    expect(r.rows[0].hrv_rmssd).toBe(58);
  });

  it('inserts a new day', async () => {
    await db.execute({ sql: DAILY_METRICS_MERGE_SQL, args: row_args(20002, { [WEIGHT]: 190 }, 100, 100) });
    const r = await db.execute('SELECT weight_lbs FROM daily_metrics WHERE date = 20002');
    expect(r.rows[0].weight_lbs).toBe(190);
  });
});
