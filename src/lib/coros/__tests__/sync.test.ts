import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import type { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { pull_coros_week } from '@/lib/coros/sync';
import { get_coros_activities, get_coros_days, save_coros_activities, save_coros_days } from '@/lib/coros/data';
import * as F from './fixtures';

// raw: sent as is, like queryActivityLapData's JSON; otherwise wrapped in a JSON string literal like the text tools
type Reply = { text: string; isError?: boolean; raw?: boolean };

function fake_mcp(replies: Record<string, Reply>, calls: Array<{ name: string; args: unknown }> = []): McpClient {
  return {
    callTool: async ({ name, arguments: args }: { name: string; arguments: unknown }) => {
      calls.push({ name, args });
      const r = replies[name] ?? { text: '' };
      return { content: [{ type: 'text', text: r.raw ? r.text : JSON.stringify(r.text) }], isError: r.isError ?? false };
    },
  } as unknown as McpClient;
}

const ALL: Record<string, Reply> = {
  queryDailyHealthData: { text: F.DAILY_HEALTH },
  querySleepHrv: { text: F.SLEEP_HRV },
  queryRestingHeartRate: { text: F.RESTING_HR },
  queryTrainingLoadAssessment: { text: F.TRAINING_LOAD },
  queryRecoveryStatus: { text: F.RECOVERY },
  queryFitnessAssessmentOverview: { text: F.FITNESS },
  querySportRecords: { text: F.SPORT_RECORDS },
};

describe('pull_coros_week', () => {
  it('merges every tool into one row per day and files current values under today', async () => {
    const pull = await pull_coros_week(fake_mcp(ALL), '2026-01-03');
    const by = Object.fromEntries(pull.days.map(d => [d.date, d]));

    expect(by['2026-01-02']).toMatchObject({ sleep_total_min: 450, hrv_avg: 58, hrv_status: 'Below normal', resting_hr: 47, load_ratio: 1.13 });
    expect(by['2026-01-03']).toMatchObject({ hrv_avg: 75, resting_hr: 44, recovery_pct: 82, vo2max: 50 });
    expect(pull.activities).toHaveLength(4);
    expect(pull.warnings).toEqual([]);
  });

  it('asks for the 7 days ending today in yyyyMMdd', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    await pull_coros_week(fake_mcp(ALL, calls), '2026-01-03');
    expect(calls.find(c => c.name === 'querySportRecords')?.args).toEqual({ startDate: '20251228', endDate: '20260103', limit: 50 });
    expect(calls.find(c => c.name === 'querySleepHrv')?.args).toEqual({ startDate: '20251228', endDate: '20260103', days: 7 });
    expect(calls.map(c => c.name)).not.toContain('createScheduledWorkout');
  });

  it('reports a tool error and a format change instead of hiding them', async () => {
    const pull = await pull_coros_week(fake_mcp({
      ...ALL,
      queryRestingHeartRate: { text: 'rate limited', isError: true },
      querySportRecords: { text: 'A brand new layout nobody has seen' },
    }), '2026-01-03');
    expect(pull.warnings).toEqual([
      'queryRestingHeartRate: rate limited',
      'querySportRecords: text returned but nothing parsed (format change?)',
    ]);
  });

  it('does not flag a genuinely empty week', async () => {
    const pull = await pull_coros_week(fake_mcp({ ...ALL, querySportRecords: { text: 'Sport Records (0 records)' } }), '2026-01-03');
    expect(pull.warnings).toEqual([]);
  });
});

describe('coros tables', () => {
  let db: Client;
  beforeEach(() => { db = createClient({ url: ':memory:' }); });

  it('merges days so a later partial sync keeps earlier values', async () => {
    await save_coros_days(db, [{ date: '2026-01-02', sleep_total_min: 450, resting_hr: 47 }]);
    await save_coros_days(db, [{ date: '2026-01-02', resting_hr: 46 }]);
    const [d] = await get_coros_days(db, '2026-01-01', '2026-01-03');
    expect(d).toMatchObject({ date: '2026-01-02', sleep_total_min: 450, resting_hr: 46 });
  });

  it('stores activities once per labelId and reads them back newest first', async () => {
    const pull = await pull_coros_week(fake_mcp(ALL), '2026-01-03');
    await save_coros_activities(db, pull.activities);
    await save_coros_activities(db, pull.activities);
    const acts = await get_coros_activities(db, '2026-01-01', '2026-01-03');
    expect(acts).toHaveLength(4);
    expect(acts[0].label_id).toBe('100000000000000001');
    expect(acts[1]).toMatchObject({ sport_type: 204, distance_m: 30500, ascent_m: null, descent_m: null });
  });
});

describe('fill_activity_details', () => {
  const NO_ELEVATION = 'Walk Activity Details\nWorkout Time: 0:16:40';

  const LAPS = (text: string): Reply => ({ text, raw: true });
  const label_of = (c: { args: unknown }) => (c.args as { labelId: string }).labelId;

  async function setup(detail_for: (label: string, tool: string) => Reply) {
    const { fill_activity_details } = await import('@/lib/coros/sync');
    const db = createClient({ url: ':memory:' });
    const pull = await pull_coros_week(fake_mcp(ALL), '2026-01-03');
    await save_coros_activities(db, pull.activities);
    const calls: Array<{ name: string; args: unknown }> = [];
    const client = {
      callTool: async ({ name, arguments: args }: { name: string; arguments: { labelId: string } }) => {
        calls.push({ name, args });
        const r = detail_for(args.labelId, name);
        return { content: [{ type: 'text', text: r.raw ? r.text : JSON.stringify(r.text) }], isError: r.isError ?? false };
      },
    } as unknown as McpClient;
    return { fill_activity_details, db, client, calls };
  }

  it('asks each outdoor activity and strength session once, skips custom sports, stores what they had', async () => {
    const { fill_activity_details, db, client, calls } = await setup((label, tool) =>
      tool === 'queryActivityLapData' ? LAPS(F.STRENGTH_LAPS_MOBILITY)
        : label === '100000000000000003' ? { text: NO_ELEVATION } : { text: F.ACTIVITY_DETAIL });

    const first = await fill_activity_details(client, db);
    // 004 custom Sport(9806) is never asked; the 402 strength session gets the lap tool
    expect(calls.map(c => `${c.name} ${label_of(c)}`).sort()).toEqual([
      'getActivityDetail 100000000000000002',
      'getActivityDetail 100000000000000003',
      'queryActivityLapData 100000000000000001',
    ]);
    expect(calls.find(c => c.name === 'queryActivityLapData')?.args).toEqual({ labelId: '100000000000000001', sportType: 402 });
    expect(first).toEqual({ filled: 1, strength: 1, waiting: 0, warnings: [] });

    const acts = await get_coros_activities(db, '2026-01-01', '2026-01-03');
    expect(acts.find(a => a.sport_type === 204)).toMatchObject({ ascent_m: 1200, descent_m: 1250 });
    expect(acts.find(a => a.sport_type === 900)).toMatchObject({ ascent_m: null, descent_m: null });
    expect(acts.find(a => a.sport_type === 9806)).toMatchObject({ ascent_m: null, descent_m: null });

    expect(acts.find(a => a.sport_type === 204)).toMatchObject({ anaerobic_te: 1.0, training_focus: 'Base' });
    expect(acts.find(a => a.sport_type === 402)).toMatchObject({
      exercises: ['Hamstring Stretch', 'Bird Dog', 'Cat Cow'], working_sets: 4, loaded_sets: 0,
    });
    expect(acts.find(a => a.sport_type === 204)).toMatchObject({ exercises: null, working_sets: null, loaded_sets: null });

    // Second run: everything was asked once already, a walk without elevation included
    calls.length = 0;
    expect(await fill_activity_details(client, db)).toEqual({ filled: 0, strength: 0, waiting: 0, warnings: [] });
    expect(calls).toHaveLength(0);
  });

  it('asks again once for activities read by an older parser version', async () => {
    const { fill_activity_details, db, client, calls } = await setup(() => ({ text: F.ACTIVITY_DETAIL }));
    // Simulate a ride read before training effect was parsed (version 1: fetched, no version)
    await db.execute("UPDATE coros_activities SET detail_fetched_at = 1, ascent_m = 1200 WHERE label_id = '100000000000000002'");
    await db.execute("UPDATE coros_activities SET detail_fetched_at = 1, detail_version = 2 WHERE label_id IN ('100000000000000001', '100000000000000003')");

    await fill_activity_details(client, db);
    expect(calls.map(label_of)).toEqual(['100000000000000002']);
    const acts = await get_coros_activities(db, '2026-01-01', '2026-01-03');
    expect(acts.find(a => a.label_id === '100000000000000002')).toMatchObject({ training_focus: 'Base', ascent_m: 1200 });
  });

  it('warns when a built-in ride comes back without elevation, and retries a failed call next run', async () => {
    const { fill_activity_details, db, client, calls } = await setup((label, tool) => {
      if (tool === 'queryActivityLapData') return LAPS(F.STRENGTH_LAPS_MOBILITY);
      if (label === '100000000000000002') return { text: NO_ELEVATION };
      if (label === '100000000000000003') return { text: 'busy', isError: true };
      return { text: F.ACTIVITY_DETAIL };
    });

    const first = await fill_activity_details(client, db);
    expect(first.warnings).toEqual([
      'getActivityDetail 100000000000000002: ride has no elevation line (format change?)',
      'getActivityDetail: busy',
    ]);

    calls.length = 0;
    await fill_activity_details(client, db);
    expect(calls.map(label_of)).toEqual(['100000000000000003']);
  });

  it('stores a heavy session\'s loaded sets', async () => {
    const { fill_activity_details, db, client } = await setup((_label, tool) =>
      tool === 'queryActivityLapData' ? LAPS(F.STRENGTH_LAPS_HEAVY) : { text: F.ACTIVITY_DETAIL });
    await fill_activity_details(client, db);
    const acts = await get_coros_activities(db, '2026-01-01', '2026-01-03');
    expect(acts.find(a => a.sport_type === 402)).toMatchObject({
      exercises: ['Goblet Squat', 'Romanian Deadlift', 'Dead Bug'], working_sets: 8, loaded_sets: 6,
    });
  });

  it('reports unreadable lap data once as a format change, and retries a failed lap call next run', async () => {
    let lap_reply: Reply = LAPS('Strength Activity Details\nSets: 12');
    const { fill_activity_details, db, client, calls } = await setup((_label, tool) =>
      tool === 'queryActivityLapData' ? lap_reply : { text: F.ACTIVITY_DETAIL });

    const first = await fill_activity_details(client, db);
    expect(first.warnings).toEqual(['queryActivityLapData 100000000000000001: exercises not readable (format change?)']);
    const acts = await get_coros_activities(db, '2026-01-01', '2026-01-03');
    expect(acts.find(a => a.sport_type === 402)).toMatchObject({ exercises: null, working_sets: null, loaded_sets: null });

    // Marked read: not asked again, so the warning shows once
    calls.length = 0;
    expect((await fill_activity_details(client, db)).warnings).toEqual([]);
    expect(calls).toHaveLength(0);

    // A failed call is not marked read
    await db.execute("UPDATE coros_activities SET detail_version = NULL, detail_fetched_at = NULL WHERE label_id = '100000000000000001'");
    lap_reply = { text: 'busy', isError: true };
    expect((await fill_activity_details(client, db)).warnings).toEqual(['queryActivityLapData: busy']);
    lap_reply = LAPS(F.STRENGTH_LAPS_MOBILITY);
    calls.length = 0;
    await fill_activity_details(client, db);
    expect(calls.map(c => `${c.name} ${label_of(c)}`)).toEqual(['queryActivityLapData 100000000000000001']);
  });

  it('warns once when COROS lists sets but the lap data has none', async () => {
    const { fill_activity_details, db, client, calls } = await setup((_label, tool) =>
      tool === 'queryActivityLapData' ? LAPS('{"lapGroups":[]}') : { text: F.ACTIVITY_DETAIL });

    // The fixture's strength record says "Sets: 12"
    expect((await fill_activity_details(client, db)).warnings).toEqual([
      'queryActivityLapData 100000000000000001: COROS lists 12 sets but the lap data has none',
    ]);
    const acts = await get_coros_activities(db, '2026-01-01', '2026-01-03');
    expect(acts.find(a => a.sport_type === 402)).toMatchObject({ exercises: [], working_sets: 0, loaded_sets: 0 });

    calls.length = 0;
    expect((await fill_activity_details(client, db)).warnings).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('does not warn when neither the record nor the lap data has sets', async () => {
    const { fill_activity_details, db, client } = await setup((_label, tool) =>
      tool === 'queryActivityLapData' ? LAPS('{"lapGroups":[]}') : { text: F.ACTIVITY_DETAIL });
    await db.execute("UPDATE coros_activities SET sets = NULL WHERE label_id = '100000000000000001'");
    expect((await fill_activity_details(client, db)).warnings).toEqual([]);
  });

  it('leaves the rest for the next run past the cap, oldest last, and says how many', async () => {
    const { fill_activity_details, MAX_DETAIL_CALLS } = await import('@/lib/coros/sync');
    const db = createClient({ url: ':memory:' });
    // Two more strength sessions than one run may ask, newest first by start time
    const sessions = Array.from({ length: MAX_DETAIL_CALLS + 2 }, (_, i) => ({
      label_id: `2000000000000000${String(i).padStart(2, '0')}`, sport_type: 402, sport_name: 'Strength',
      date: '2026-01-03', start_ts: 1767400000 - i * 3600, end_ts: null, duration_s: 600, distance_m: null,
      sets: 4, avg_hr: null, calories: null, avg_speed_kmh: null, location: null,
    }));
    await save_coros_activities(db, sessions);
    const calls: Array<{ name: string; args: unknown }> = [];
    const client = fake_mcp({ queryActivityLapData: LAPS(F.STRENGTH_LAPS_MOBILITY) }, calls);

    const first = await fill_activity_details(client, db);
    expect(first).toMatchObject({ strength: MAX_DETAIL_CALLS, waiting: 2, warnings: [] });
    expect(calls.map(label_of)).toEqual(sessions.slice(0, MAX_DETAIL_CALLS).map(a => a.label_id));

    calls.length = 0;
    expect(await fill_activity_details(client, db)).toMatchObject({ strength: 2, waiting: 0 });
    expect(calls.map(label_of)).toEqual(sessions.slice(MAX_DETAIL_CALLS).map(a => a.label_id));
  });
});

describe('save_coros_weight', () => {
  async function db_with_metrics() {
    const { save_coros_weight } = await import('@/lib/coros/data');
    const db = createClient({ url: ':memory:' });
    await db.execute('CREATE TABLE daily_metrics (date INTEGER PRIMARY KEY, weight_lbs REAL, back_pain_scale INTEGER, created_at INTEGER, updated_at INTEGER)');
    const weight_on = async (epoch: number) => (await db.execute({ sql: 'SELECT weight_lbs FROM daily_metrics WHERE date = ?', args: [epoch] })).rows[0]?.weight_lbs ?? null;
    return { save_coros_weight, db, weight_on };
  }
  // 2026-10-12 is epoch day 20738

  it('saves a new weight as today', async () => {
    const { save_coros_weight, db, weight_on } = await db_with_metrics();
    expect(await save_coros_weight(db, '2026-10-12', 196.2)).toBe(true);
    expect(await weight_on(20738)).toBe(196.2);
  });

  it('skips an unchanged weight, so a morning without a new entry does not count', async () => {
    const { save_coros_weight, db, weight_on } = await db_with_metrics();
    await save_coros_weight(db, '2026-10-12', 196.2);
    expect(await save_coros_weight(db, '2026-10-13', 196.2)).toBe(false);
    expect(await weight_on(20739)).toBeNull();
    expect(await save_coros_weight(db, '2026-10-13', 195.4)).toBe(true);
    expect(await weight_on(20739)).toBe(195.4);
  });

  it('saves an unchanged weight once at the start of a new week, so the week has a reading', async () => {
    const { save_coros_weight, db, weight_on } = await db_with_metrics();
    await save_coros_weight(db, '2026-10-11', 196.2); // Sunday
    expect(await save_coros_weight(db, '2026-10-12', 196.2)).toBe(true); // Monday
    expect(await weight_on(20738)).toBe(196.2);
    expect(await save_coros_weight(db, '2026-10-13', 196.2)).toBe(false); // Tuesday, unchanged
  });

  it('updates today when Bill corrects the entry, and keeps the other inputs', async () => {
    const { save_coros_weight, db, weight_on } = await db_with_metrics();
    await db.execute('INSERT INTO daily_metrics (date, back_pain_scale) VALUES (20738, 3)');
    await save_coros_weight(db, '2026-10-12', 196.2);
    await save_coros_weight(db, '2026-10-12', 196.8);
    expect(await weight_on(20738)).toBe(196.8);
    expect((await db.execute('SELECT back_pain_scale FROM daily_metrics WHERE date = 20738')).rows[0].back_pain_scale).toBe(3);
  });
});
