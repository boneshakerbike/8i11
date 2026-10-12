/**
 * Pull the last 7 days from COROS MCP into coros_daily and coros_activities.
 *
 * Seven days each run, so a missed night heals itself the next time. Only
 * allowlisted read tools are called. Each tool's text is parsed separately; a
 * tool that returns text but no records is reported as a possible format
 * change instead of being silently skipped.
 */

import type { Client as LibsqlClient } from '@libsql/client';
import type { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { call_coros_read_tool, coros_connection_status, describe_coros_error, with_coros, type CorosReadTool } from '@/lib/coros/mcp-client';
import {
  parse_daily_health, parse_fitness, parse_recovery, parse_resting_hr, parse_sleep_hrv,
  parse_sport_records, parse_training_load, tool_text, type CorosActivity,
} from '@/lib/coros/parse';
import { save_coros_activities, save_coros_days, type CorosDay } from '@/lib/coros/data';
import { shift_date } from '@/lib/coaching/day';
import type { SyncStep } from '@/lib/health/sync-runs';

const compact = (date: string) => date.replaceAll('-', '');

export interface CorosPull {
  days: CorosDay[];
  activities: CorosActivity[];
  warnings: string[];
}

/** Call the read tools and parse them. `today` is YYYY-MM-DD in Mountain Time. */
export async function pull_coros_week(client: McpClient, today: string): Promise<CorosPull> {
  const start = compact(shift_date(today, 6));
  const end = compact(today);
  const warnings: string[] = [];
  const by_date = new Map<string, CorosDay>();
  const day = (date: string) => {
    let d = by_date.get(date);
    if (!d) by_date.set(date, (d = { date }));
    return d;
  };

  async function read<T>(tool: CorosReadTool, args: Record<string, unknown>, parse: (text: string) => T, count: (v: T) => number): Promise<T | null> {
    const result = await call_coros_read_tool(client, tool, args);
    const text = tool_text(result);
    if (result.isError) {
      warnings.push(`${tool}: ${text.slice(0, 120) || 'error'}`);
      return null;
    }
    const parsed = parse(text);
    if (text.trim() && count(parsed) === 0 && !/no data|0 records/i.test(text)) {
      warnings.push(`${tool}: text returned but nothing parsed (format change?)`);
    }
    return parsed;
  }

  const len = <T>(v: T[] | null) => v?.length ?? 0;
  const one = (v: unknown) => (v ? 1 : 0);

  for (const h of await read('queryDailyHealthData', { days: 7 }, parse_daily_health, len) ?? []) {
    Object.assign(day(h.date), h);
  }
  for (const h of await read('querySleepHrv', { startDate: start, endDate: end, days: 7 }, parse_sleep_hrv, len) ?? []) {
    Object.assign(day(h.date), { hrv_avg: h.hrv_avg, hrv_status: h.status, hrv_baseline: h.baseline });
  }
  for (const r of await read('queryRestingHeartRate', { days: 7 }, parse_resting_hr, len) ?? []) {
    day(r.date).resting_hr = r.resting_hr;
  }
  for (const l of await read('queryTrainingLoadAssessment', { days: 7 }, parse_training_load, len) ?? []) {
    Object.assign(day(l.date), { load_short: l.short_term, load_long: l.long_term, load_ratio: l.ratio, load_comment: l.comment });
  }
  // Recovery and VO2max are current values with no date: file them under today.
  const recovery = await read('queryRecoveryStatus', {}, parse_recovery, one);
  if (recovery) Object.assign(day(today), { recovery_pct: recovery.recovery_pct, recovery_level: recovery.level });
  const fitness = await read('queryFitnessAssessmentOverview', {}, parse_fitness, one);
  if (fitness) day(today).vo2max = fitness.vo2max;

  const activities = await read('querySportRecords', { startDate: start, endDate: end, limit: 50 }, parse_sport_records, len) ?? [];

  return { days: [...by_date.values()], activities, warnings };
}

/** Pull and store. Never throws: the result says what happened. */
export async function sync_coros(db: LibsqlClient, origin: string, today: string): Promise<SyncStep> {
  try {
    // Check first: connecting without tokens would make the SDK register a new
    // OAuth client with COROS on every run.
    if (!(await coros_connection_status(origin)).connected) {
      return { step: 'coros', ok: false, detail: 'COROS is not connected (open COROS, then Connect COROS)' };
    }
    const pull = await with_coros(origin, client => pull_coros_week(client, today));
    const days = await save_coros_days(db, pull.days);
    const activities = await save_coros_activities(db, pull.activities);
    const detail = [`${days} days, ${activities} activities`, ...pull.warnings].join('; ');
    return { step: 'coros', ok: pull.warnings.length === 0, detail };
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { step: 'coros', ok: false, detail: 'COROS needs reconnecting (open COROS, then Connect COROS)' };
    }
    return { step: 'coros', ok: false, detail: describe_coros_error(err) };
  }
}
