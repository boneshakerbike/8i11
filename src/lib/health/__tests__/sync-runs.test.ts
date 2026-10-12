import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { latest_sync_run, record_sync_run, run_step, sync_health, type SyncRun } from '@/lib/health/sync-runs';

// 2026-10-13 09:02 UTC = 03:02 Mountain (MDT)
const FINISHED = Date.UTC(2026, 9, 13, 9, 2) / 1000;
const run = (over: Partial<SyncRun> = {}): SyncRun => ({
  job: 'daily', started_at: FINISHED - 20, finished_at: FINISHED, ok: true,
  steps: [{ step: 'oura', ok: true, detail: '1 days synced' }, { step: 'coros', ok: true, detail: '7 days, 3 activities' }],
  ...over,
});

describe('sync_health', () => {
  it('says when it has never run', () => {
    expect(sync_health(null, FINISHED).level).toBe('never');
  });

  it('shows the Mountain Time of a good run', () => {
    expect(sync_health(run(), FINISHED + 3600)).toEqual({ level: 'ok', message: 'Daily sync ran Tue 3:02 AM.' });
  });

  it('names the failed step', () => {
    const h = sync_health(run({ ok: false, steps: [{ step: 'coros', ok: false, detail: 'COROS needs reconnecting' }] }), FINISHED + 60);
    expect(h).toEqual({ level: 'problem', message: 'Daily sync ran Tue 3:02 AM with problems: coros: COROS needs reconnecting' });
  });

  it('calls a run older than 26 hours late, even if it was fine', () => {
    const h = sync_health(run(), FINISHED + 27 * 3600);
    expect(h.level).toBe('late');
    expect(h.message).toMatch(/27 hours ago/);
  });
});

describe('run log', () => {
  it('returns the newest run for a job', async () => {
    const db = createClient({ url: ':memory:' });
    expect(await latest_sync_run(db, 'daily')).toBeNull();
    await record_sync_run(db, run({ finished_at: 100 }));
    await record_sync_run(db, run({ finished_at: 200, ok: false }));
    expect(await latest_sync_run(db, 'daily')).toMatchObject({ finished_at: 200, ok: false });
  });
});

describe('run_step', () => {
  it('turns an exception into a failed step', async () => {
    const step = await run_step('oura', async () => { throw new Error('token expired'); });
    expect(step).toEqual({ step: 'oura', ok: false, detail: 'token expired' });
  });
});
