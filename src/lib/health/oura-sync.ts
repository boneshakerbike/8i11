/**
 * Oura sync: fill wellness_cache for recent past days (Mountain Time), one
 * Oura API call per endpoint for the whole range. Used by POST /api/oura/sync
 * and by the daily cron. Moved here unchanged from the route.
 */

import {
  get_oura_tokens,
  refresh_oura_access_token,
  is_wellness_cached,
  save_wellness_cache,
} from '@/lib/db';
import type { OuraTokens, WellnessSnapshot } from '@/lib/db';
import { primary_sleep } from '@/lib/health/oura-derive';
import { mt_date_str, shift_date } from '@/lib/coaching/day';

async function oura_fetch(url: string, tokens: OuraTokens): Promise<Response> {
  return fetch(url, {
    headers: { 'Authorization': `Bearer ${tokens.access_token}` },
  });
}

interface EndpointDef {
  key: string;
  path: string;
  use_activity_params?: boolean;
}

const ENDPOINTS: EndpointDef[] = [
  // Inclusive end_date
  { key: 'daily_sleep', path: 'daily_sleep' },
  { key: 'daily_readiness', path: 'daily_readiness' },
  { key: 'daily_stress', path: 'daily_stress' },
  { key: 'daily_resilience', path: 'daily_resilience' },
  { key: 'daily_cardiovascular_age', path: 'daily_cardiovascular_age' },
  { key: 'vo2_max', path: 'vo2_max' },
  { key: 'daily_spo2', path: 'daily_spo2' },
  { key: 'sleep_time', path: 'sleep_time' },
  // Exclusive end_date (need +1 day)
  { key: 'daily_activity', path: 'daily_activity', use_activity_params: true },
  { key: 'sleep_detail', path: 'sleep', use_activity_params: true },
  { key: 'heartrate', path: 'heartrate', use_activity_params: true },
  { key: 'workouts', path: 'workout', use_activity_params: true },
  { key: 'sessions', path: 'session', use_activity_params: true },
];

// Endpoints that return items with a "day" field for grouping
const ARRAY_ENDPOINTS = new Set([
  'sleep_detail', 'heartrate', 'workouts', 'sessions'
]);

/**
 * The days to fetch, ending yesterday (Mountain Time): today's steps and
 * activity are still accumulating. The midday daily job includes today
 * instead, because Oura files last night's sleep, HRV and resting HR under
 * today and they are final once Bill has opened the Oura app. Today's partial
 * activity is replaced by the next day's forced re-fetch.
 */
export function oura_sync_range(today: string, days: number, include_today: boolean): { start: string; end: string } {
  const end = include_today ? today : shift_date(today, 1);
  return { start: shift_date(end, days - 1), end };
}

export type OuraSyncResult =
  | { connected: false }
  | { connected: true; synced: number; skipped: number; errors: string[]; range: { start: string; end: string } };

export async function sync_oura(options: { days?: number; force?: boolean; include_today?: boolean } = {}): Promise<OuraSyncResult> {
  let tokens = await get_oura_tokens();
  if (!tokens) return { connected: false };

  if (tokens.expires_at < Math.floor(Date.now() / 1000) + 60) {
    tokens = await refresh_oura_access_token();
  }

  const days = Math.min(Math.max(options.days || 7, 1), 30);
  const force = options.force === true;

  const { start: start_str, end: end_str } = oura_sync_range(mt_date_str(), days, options.include_today === true);

  // Check which dates need syncing
  const dates_to_sync: string[] = [];
  const skipped: string[] = [];
  for (let date_str = start_str; date_str <= end_str; date_str = shift_date(date_str, -1)) {
    if (force || !(await is_wellness_cached(date_str))) {
      dates_to_sync.push(date_str);
    } else {
      skipped.push(date_str);
    }
  }

  if (dates_to_sync.length === 0) {
    return { connected: true, synced: 0, skipped: skipped.length, errors: [], range: { start: start_str, end: end_str } };
  }

  // Fetch date range from Oura (one call per endpoint for the full range)
  const base = 'https://api.ouraring.com/v2/usercollection';
  const params = `start_date=${start_str}&end_date=${end_str}`;

  // Activity needs +1 day on end_date
  const activity_params = `start_date=${start_str}&end_date=${shift_date(end_str, -1)}`;

  const endpoint_data: Record<string, unknown[]> = {};
  const errors: string[] = [];

  const results = await Promise.allSettled(
    ENDPOINTS.map(async (ep) => {
      const q = ep.use_activity_params ? activity_params : params;
      const res = await oura_fetch(`${base}/${ep.path}?${q}`, tokens);
      if (!res.ok) {
        if ([401, 403, 404].includes(res.status)) return { key: ep.key, data: [] };
        throw new Error(`${ep.key}: ${res.status}`);
      }
      const json = await res.json();
      return { key: ep.key, data: json.data || [] };
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      endpoint_data[result.value.key] = result.value.data;
    } else {
      errors.push(String(result.reason));
    }
  }

  // Group data by date and save each day
  let synced = 0;
  for (const date_str of dates_to_sync) {
    const find_for_date = (key: string) => {
      const items = endpoint_data[key] || [];
      // Daily endpoints: match by "day" field
      // Array endpoints (heartrate): match by "day" or "timestamp" date
      if (ARRAY_ENDPOINTS.has(key)) {
        return items.filter((item: unknown) => {
          const r = item as Record<string, unknown>;
          if (r.day === date_str) return true;
          if (typeof r.timestamp === 'string') return (r.timestamp as string).startsWith(date_str);
          return false;
        });
      }
      return items.find((item: unknown) => (item as Record<string, unknown>).day === date_str) || null;
    };

    const daily_sleep = find_for_date('daily_sleep') as Record<string, unknown> | null;
    const daily_readiness = find_for_date('daily_readiness') as Record<string, unknown> | null;
    const daily_activity = find_for_date('daily_activity') as Record<string, unknown> | null;
    const daily_stress = find_for_date('daily_stress') as Record<string, unknown> | null;
    const sleep_detail = find_for_date('sleep_detail') as Record<string, unknown>[] | null;
    const daily_spo2 = find_for_date('daily_spo2') as Record<string, unknown> | null;
    // HRV and resting HR come from the night, not whichever period is first (a nap)
    const night = primary_sleep(sleep_detail);

    const snapshot: WellnessSnapshot = {
      date: date_str,
      sleep_score: (daily_sleep?.score as number) ?? null,
      readiness_score: (daily_readiness?.score as number) ?? null,
      activity_score: (daily_activity?.score as number) ?? null,
      stress_high: (daily_stress?.stress_high as number) ?? null,
      recovery_high: (daily_stress?.recovery_high as number) ?? null,
      hrv_average: (night?.average_hrv as number) ?? null,
      resting_hr: (night?.lowest_heart_rate as number) ?? null,
      spo2_average: ((daily_spo2?.spo2_percentage as Record<string, unknown>)?.average as number) ?? null,
      steps: (daily_activity?.steps as number) ?? null,
      active_calories: (daily_activity?.active_calories as number) ?? null,
      daily_sleep,
      daily_readiness,
      daily_activity,
      daily_stress,
      daily_resilience: find_for_date('daily_resilience') as Record<string, unknown> | null,
      daily_cardiovascular_age: find_for_date('daily_cardiovascular_age') as Record<string, unknown> | null,
      daily_spo2,
      sleep_detail,
      heartrate: find_for_date('heartrate') as unknown,
      vo2_max: find_for_date('vo2_max') as Record<string, unknown> | null,
      workouts: find_for_date('workouts') as unknown,
      sessions: find_for_date('sessions') as unknown,
      sleep_time: find_for_date('sleep_time') as Record<string, unknown> | null,
      fetched_at: new Date().toISOString(),
    };

    try {
      await save_wellness_cache(snapshot);
      synced++;
    } catch (err) {
      errors.push(`Cache save failed for ${date_str}: ${err}`);
    }
  }


  return { connected: true, synced, skipped: skipped.length, errors, range: { start: start_str, end: end_str } };
}
