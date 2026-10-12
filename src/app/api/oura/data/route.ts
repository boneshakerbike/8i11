/**
 * API route: GET /api/oura/data
 * Fetches wellness data from Oura (9 working endpoints)
 * Cache-first for past dates, always fresh for today
 * Supports ?range=N to return N days from cache
 *
 * Dead endpoints (Oura API returns no data): personal_info,
 * cardiovascular_age, vo2_max, resilience, sleep_time
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import {
  get_oura_tokens,
  refresh_oura_access_token,
  get_wellness_cache,
  save_wellness_cache,
  get_wellness_range,
} from '@/lib/db';
import type { OuraTokens, WellnessSnapshot } from '@/lib/db';
import { primary_sleep } from '@/lib/health/oura-derive';

async function require_auth(request: NextRequest): Promise<NextResponse | null> {
  const token = await getToken({ req: request });
  if (token) return null;

  const pin_header = request.headers.get('X-Guest-Pin');
  if (pin_header) {
    const valid_pins = (process.env.GUEST_PINS || process.env.GUEST_PIN || '')
      .split(',').map(p => p.trim()).filter(Boolean);
    if (valid_pins.includes(pin_header)) return null;
  }

  return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
}

async function oura_fetch(url: string, tokens: OuraTokens): Promise<Response> {
  return fetch(url, {
    headers: { 'Authorization': `Bearer ${tokens.access_token}` },
  });
}

interface EndpointDef {
  key: string;
  path: string;
  use_activity_params?: boolean;  // exclusive end_date
  array_response?: boolean;       // returns array (heartrate, sleep periods, workouts, sessions)
}

const ENDPOINTS: EndpointDef[] = [
  // Scope: daily (inclusive end_date)
  { key: 'daily_sleep', path: 'daily_sleep' },
  { key: 'daily_readiness', path: 'daily_readiness' },
  { key: 'daily_stress', path: 'daily_stress' },
  // Scope: spo2 (inclusive end_date)
  { key: 'daily_spo2', path: 'daily_spo2' },
  // Exclusive end_date endpoints (need +1 day)
  { key: 'daily_activity', path: 'daily_activity', use_activity_params: true },
  { key: 'sleep_detail', path: 'sleep', array_response: true, use_activity_params: true },
  { key: 'heartrate', path: 'heartrate', array_response: true, use_activity_params: true },
  { key: 'workouts', path: 'workout', array_response: true, use_activity_params: true },
  { key: 'sessions', path: 'session', array_response: true, use_activity_params: true },
];

function extract_headline_scores(data: Record<string, unknown>): Partial<WellnessSnapshot> {
  const sleep = data.daily_sleep as Record<string, unknown> | null;
  const readiness = data.daily_readiness as Record<string, unknown> | null;
  const activity = data.daily_activity as Record<string, unknown> | null;
  const stress = data.daily_stress as Record<string, unknown> | null;
  const sleep_detail_arr = data.sleep_detail as Record<string, unknown>[] | null;
  const sleep_detail = primary_sleep(sleep_detail_arr);
  const spo2 = data.daily_spo2 as Record<string, unknown> | null;

  return {
    sleep_score: (sleep?.score as number) ?? null,
    readiness_score: (readiness?.score as number) ?? null,
    activity_score: (activity?.score as number) ?? null,
    stress_high: (stress?.stress_high as number) ?? null,
    recovery_high: (stress?.recovery_high as number) ?? null,
    hrv_average: (sleep_detail?.average_hrv as number) ?? null,
    resting_hr: (sleep_detail?.lowest_heart_rate as number) ?? null,
    spo2_average: ((spo2?.spo2_percentage as Record<string, unknown>)?.average as number) ?? null,
    steps: (activity?.steps as number) ?? null,
    active_calories: (activity?.active_calories as number) ?? null,
  };
}

async function fetch_all_endpoints(
  tokens: OuraTokens,
  target_date: string,
  params: string,
  activity_params: string
): Promise<Record<string, unknown>> {
  const base = 'https://api.ouraring.com/v2/usercollection';

  const results = await Promise.allSettled(
    ENDPOINTS.map(async (ep) => {
      const q = ep.use_activity_params ? activity_params : params;
      const res = await oura_fetch(`${base}/${ep.path}?${q}`, tokens);
      if (!res.ok) {
        if ([401, 403, 404].includes(res.status)) return { key: ep.key, data: null }; // not available
        throw new Error(`${ep.key}: ${res.status}`);
      }
      const json = await res.json();
      const value = ep.array_response ? (json.data || []) : (json.data?.[0] || null);
      return { key: ep.key, data: value };
    })
  );

  const data: Record<string, unknown> = {};
  for (const result of results) {
    if (result.status === 'fulfilled') {
      data[result.value.key] = result.value.data;
    } else {
      // Log but don't fail the whole request
      console.warn('Oura endpoint failed:', result.reason);
    }
  }
  return data;
}

export async function GET(request: NextRequest) {
  const auth_error = await require_auth(request);
  if (auth_error) return auth_error;

  try {
    let tokens = await get_oura_tokens();
    if (!tokens) {
      return NextResponse.json({ error: 'Oura not connected', connected: false }, { status: 404 });
    }

    // Auto-refresh if expired (with 60s buffer)
    if (tokens.expires_at < Math.floor(Date.now() / 1000) + 60) {
      try {
        tokens = await refresh_oura_access_token();
      } catch (err) {
        console.error('Oura token refresh failed:', err);
        return NextResponse.json(
          { error: 'Oura token expired. Please reconnect.', connected: false },
          { status: 401 }
        );
      }
    }

    const { searchParams } = new URL(request.url);
    const target_date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const range = searchParams.get('range');

    // Range query: return cached data for N days
    if (range) {
      const days = Math.min(parseInt(range, 10) || 7, 90);
      const end = new Date(target_date + 'T12:00:00Z');
      const start = new Date(end);
      start.setDate(start.getDate() - days + 1);
      const start_date = start.toISOString().split('T')[0];

      const snapshots = await get_wellness_range(start_date, target_date);
      return NextResponse.json({
        success: true,
        connected: true,
        range: true,
        start_date,
        end_date: target_date,
        days: snapshots.length,
        snapshots,
      });
    }

    // Use Mountain Time for "today" check (client sends Mountain Time dates)
    const now_mt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }));
    const today = now_mt.toISOString().split('T')[0];
    const is_today = target_date === today;

    // Cache-first for past dates
    if (!is_today) {
      const cached = await get_wellness_cache(target_date);
      if (cached) {
        return NextResponse.json({
          success: true,
          connected: true,
          cached: true,
          date: target_date,
          ...build_response(cached),
        });
      }
    }

    // Build query params
    const params = `start_date=${target_date}&end_date=${target_date}`;
    const next_day = new Date(target_date + 'T12:00:00Z');
    next_day.setDate(next_day.getDate() + 1);
    const activity_end = next_day.toISOString().split('T')[0];
    const activity_params = `start_date=${target_date}&end_date=${activity_end}`;

    // Fetch all endpoints
    let data = await fetch_all_endpoints(tokens, target_date, params, activity_params);

    // If we got no data at all, try a token refresh and retry
    const has_any_data = Object.values(data).some(v => v !== null && v !== undefined);
    if (!has_any_data) {
      try {
        tokens = await refresh_oura_access_token();
        data = await fetch_all_endpoints(tokens, target_date, params, activity_params);
      } catch {
        return NextResponse.json(
          { error: 'Oura token invalid. Please reconnect.', connected: false },
          { status: 401 }
        );
      }
    }

    // Extract headline scores and build snapshot
    const scores = extract_headline_scores(data);
    const snapshot: WellnessSnapshot = {
      date: target_date,
      sleep_score: scores.sleep_score ?? null,
      readiness_score: scores.readiness_score ?? null,
      activity_score: scores.activity_score ?? null,
      stress_high: scores.stress_high ?? null,
      recovery_high: scores.recovery_high ?? null,
      hrv_average: scores.hrv_average ?? null,
      resting_hr: scores.resting_hr ?? null,
      spo2_average: scores.spo2_average ?? null,
      steps: scores.steps ?? null,
      active_calories: scores.active_calories ?? null,
      daily_sleep: data.daily_sleep ?? null,
      daily_readiness: data.daily_readiness ?? null,
      daily_activity: data.daily_activity ?? null,
      daily_stress: data.daily_stress ?? null,
      daily_resilience: null,
      daily_cardiovascular_age: null,
      daily_spo2: data.daily_spo2 ?? null,
      sleep_detail: data.sleep_detail ?? null,
      heartrate: data.heartrate ?? null,
      vo2_max: null,
      workouts: data.workouts ?? null,
      sessions: data.sessions ?? null,
      sleep_time: null,
      fetched_at: new Date().toISOString(),
    };

    // Cache past dates
    if (!is_today) {
      try {
        await save_wellness_cache(snapshot);
      } catch (err) {
        console.warn('Failed to cache wellness data:', err);
      }
    }

    return NextResponse.json({
      success: true,
      connected: true,
      cached: false,
      date: target_date,
      ...build_response(snapshot),
    });

  } catch (error) {
    console.error('Oura data fetch error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch Oura data' },
      { status: 500 }
    );
  }
}

function build_response(s: WellnessSnapshot) {
  return {
    sleep: s.daily_sleep,
    readiness: s.daily_readiness,
    activity: s.daily_activity,
    stress: s.daily_stress,
    spo2: s.daily_spo2,
    sleep_detail: s.sleep_detail,
    heartrate: s.heartrate,
    workouts: s.workouts,
    sessions: s.sessions,
    scores: {
      sleep: s.sleep_score,
      readiness: s.readiness_score,
      activity: s.activity_score,
      stress_high: s.stress_high,
      recovery_high: s.recovery_high,
      hrv_average: s.hrv_average,
      resting_hr: s.resting_hr,
      spo2_average: s.spo2_average,
      steps: s.steps,
      active_calories: s.active_calories,
    },
  };
}
