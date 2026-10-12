/**
 * Log of the nightly health sync, and the one-line status the Health and
 * COROS pages show. The point: nobody should need Vercel logs to know whether
 * the job ran. A missing run is as visible as a failed one.
 */

import type { Client } from '@libsql/client';

export interface SyncStep {
  step: string;
  ok: boolean;
  detail: string;
}

export interface SyncRun {
  job: string;
  started_at: number;
  finished_at: number;
  ok: boolean;
  steps: SyncStep[];
}

/** The nightly job runs at 09:00 UTC; allow a couple of hours of slack before calling it late. */
export const STALE_AFTER_HOURS = 26;
const KEEP_RUNS = 120;

async function ensure(db: Client): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS health_sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER NOT NULL,
    ok INTEGER NOT NULL,
    steps_json TEXT NOT NULL
  )`);
}

export async function record_sync_run(db: Client, run: SyncRun): Promise<void> {
  await ensure(db);
  await db.execute({
    sql: 'INSERT INTO health_sync_runs (job, started_at, finished_at, ok, steps_json) VALUES (?, ?, ?, ?, ?)',
    args: [run.job, run.started_at, run.finished_at, run.ok ? 1 : 0, JSON.stringify(run.steps)],
  });
  await db.execute({
    sql: 'DELETE FROM health_sync_runs WHERE job = ? AND id NOT IN (SELECT id FROM health_sync_runs WHERE job = ? ORDER BY id DESC LIMIT ?)',
    args: [run.job, run.job, KEEP_RUNS],
  });
}

export async function latest_sync_run(db: Client, job: string): Promise<SyncRun | null> {
  await ensure(db);
  const r = await db.execute({ sql: 'SELECT * FROM health_sync_runs WHERE job = ? ORDER BY id DESC LIMIT 1', args: [job] });
  const row = r.rows[0];
  if (!row) return null;
  return {
    job: String(row.job),
    started_at: Number(row.started_at),
    finished_at: Number(row.finished_at),
    ok: Number(row.ok) === 1,
    steps: JSON.parse(String(row.steps_json)) as SyncStep[],
  };
}

export interface SyncHealth {
  level: 'ok' | 'problem' | 'late' | 'never';
  message: string;
}

const mt_time = (s: number) => new Date(s * 1000).toLocaleString('en-US', {
  timeZone: 'America/Denver', weekday: 'short', hour: 'numeric', minute: '2-digit',
});

/** One line for the page. Late beats failed: a job that stopped running is the bigger problem. */
export function sync_health(run: SyncRun | null, now_s: number): SyncHealth {
  if (!run) return { level: 'never', message: 'Daily sync has not run yet.' };
  const hours = Math.floor((now_s - run.finished_at) / 3600);
  if (hours >= STALE_AFTER_HOURS) {
    return { level: 'late', message: `Daily sync last ran ${hours} hours ago (${mt_time(run.finished_at)}). It should run every night around 3am.` };
  }
  const failed = run.steps.filter(s => !s.ok);
  if (failed.length > 0) {
    return { level: 'problem', message: `Daily sync ran ${mt_time(run.finished_at)} with problems: ${failed.map(s => `${s.step}: ${s.detail}`).join('; ')}` };
  }
  return { level: 'ok', message: `Daily sync ran ${mt_time(run.finished_at)}.` };
}

/** Run one step; an exception becomes a failed step instead of stopping the others. */
export async function run_step(step: string, fn: () => Promise<Omit<SyncStep, 'step'>>): Promise<SyncStep> {
  try {
    return { step, ...(await fn()) };
  } catch (err) {
    return { step, ok: false, detail: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) };
  }
}
