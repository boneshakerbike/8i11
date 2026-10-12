import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import type { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { pull_coros_week } from '@/lib/coros/sync';
import { get_coros_activities, get_coros_days, save_coros_activities, save_coros_days } from '@/lib/coros/data';
import * as F from './fixtures';

type Reply = { text: string; isError?: boolean };

function fake_mcp(replies: Record<string, Reply>, calls: Array<{ name: string; args: unknown }> = []): McpClient {
  return {
    callTool: async ({ name, arguments: args }: { name: string; arguments: unknown }) => {
      calls.push({ name, args });
      const r = replies[name] ?? { text: '' };
      return { content: [{ type: 'text', text: JSON.stringify(r.text) }], isError: r.isError ?? false };
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
