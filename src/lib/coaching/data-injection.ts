/**
 * Coach session data: the daily brief the coach reads (Oura recovery, COROS
 * training, the weekly scorecard, typed inputs) and the metrics the Coach page
 * shows. Device load scores are never included (#193).
 */

import { get_client, get_wellness_cache, type WellnessSnapshot } from '@/lib/db';
import { get_back_history, get_trends, get_last_known_manual_metrics, get_weights, type TrendRow } from '@/lib/coaching/db';
import { shift_date } from '@/lib/coaching/day';
import { get_coros_activities } from '@/lib/coros/data';
import { estimate_cv_age, primary_sleep } from '@/lib/health/oura-derive';
import { build_daily_brief, last_night_from_oura } from '@/lib/health/daily-brief';
import { load_scorecard } from '@/lib/health/scorecard-data';

export interface ManualInputs {
  weight_lbs?: number;
  back_pain_scale?: number;
  back_mobility_notes?: string;
  bowel_status?: string;
  bowel_scale?: number;
  injury_notes?: string;
}

interface OuraSleepDetail {
  total_sleep_duration?: number;
  efficiency?: number;
  deep_sleep_duration?: number;
  rem_sleep_duration?: number;
}

interface OuraReadinessDetail {
  score?: number;
}

interface OuraCardiovascularAge {
  vascular_age?: number;
}

interface OuraStressDetail {
  stress_high?: number;
  recovery_high?: number;
  day_summary?: string;
}

function compute_recovery_status(
  readiness: number | null,
  hrv: number | null,
  sleep: OuraSleepDetail | null,
  stress: OuraStressDetail | null,
  rhr: number | null,
  trends: Map<string, TrendRow>,
): string {
  if (readiness === null && hrv === null) return 'No data';

  // Gather signals
  const hrv_trend = trends.get('hrv_rmssd');
  const hrv_declining = hrv_trend?.value_7day_direction === 'declining';
  const hrv_improving = hrv_trend?.value_7day_direction === 'improving';

  const deep_ok = sleep?.deep_sleep_duration ? sleep.deep_sleep_duration >= 3600 : null; // >= 1hr deep
  const sleep_ok = sleep?.total_sleep_duration ? sleep.total_sleep_duration >= 25200 : null; // >= 7hr total
  const efficiency_ok = sleep?.efficiency ? sleep.efficiency >= 85 : null;

  const stress_ratio = (stress?.stress_high && stress?.recovery_high)
    ? stress.recovery_high / (stress.stress_high + stress.recovery_high)
    : null;
  const well_recovered = stress_ratio !== null ? stress_ratio >= 0.5 : null;

  // Score: each positive signal adds 1, each negative subtracts 1
  let score = 0;
  if (readiness !== null) {
    if (readiness >= 85) score += 2;
    else if (readiness >= 70) score += 1;
    else if (readiness < 60) score -= 2;
    else score -= 1;
  }
  if (hrv_declining) score -= 1;
  if (hrv_improving) score += 1;
  if (deep_ok === true) score += 1;
  if (deep_ok === false) score -= 1;
  if (sleep_ok === true) score += 1;
  if (sleep_ok === false) score -= 1;
  if (efficiency_ok === false) score -= 1;
  if (well_recovered === true) score += 1;
  if (well_recovered === false) score -= 1;

  if (score >= 4) return 'Ready to push';
  if (score >= 2) return 'Ready, moderate effort';
  if (score >= 0) return 'Easy day';
  if (score >= -2) return 'Recovery, light movement only';
  return 'Rest day';
}

/**
 * Build the coach's data for a session: the daily brief (src/lib/health/daily-brief.ts)
 * as the injection text, plus the metrics the Coach page displays.
 * date_str: YYYY-MM-DD format
 * epoch_day: mt_epoch_day() (Mountain Time day boundary) for trend_cache lookup
 * coros_problem: set when COROS could not be refreshed at session start
 */
export async function build_data_injection(
  date_str: string,
  epoch_day: number,
  manual: ManualInputs,
  oura_live?: Record<string, unknown> | null,
  coros_problem?: string | null,
): Promise<{ injection: string; metrics: Record<string, unknown> }> {
  const yesterday_str = shift_date(date_str, 1);

  const [oura_cached, trend_rows, last_manual, scorecard, yesterday_activities, weights, back_history] = await Promise.all([
    get_wellness_cache(date_str),
    get_trends(epoch_day),
    get_last_known_manual_metrics(),
    load_scorecard(date_str, manual.weight_lbs ?? null),
    get_coros_activities(get_client(), yesterday_str, yesterday_str),
    get_weights(epoch_day - 6, epoch_day),
    get_back_history(epoch_day - 7, epoch_day - 1),
  ]);

  // Today's Oura data: live from the client first, else the cache. Oura files
  // last night's sleep under today, so this is last night or nothing.
  let oura_today: WellnessSnapshot | null = oura_cached;
  if (oura_live && oura_live.success) {
    const scores = oura_live.scores as Record<string, unknown> | undefined;
    const daily_sleep = (oura_live.sleep ?? oura_live.daily_sleep) as OuraSleepDetail | undefined;
    const readiness = (oura_live.readiness ?? oura_live.daily_readiness) as OuraReadinessDetail | undefined;
    const stress = (oura_live.stress ?? oura_live.daily_stress) as OuraStressDetail | undefined;
    oura_today = {
      date: date_str,
      sleep_score: (scores?.sleep as number) ?? null,
      readiness_score: (scores?.readiness as number) ?? null,
      activity_score: (scores?.activity as number) ?? null,
      stress_high: (scores?.stress_high as number) ?? null,
      recovery_high: (scores?.recovery_high as number) ?? null,
      hrv_average: (scores?.hrv_average as number) ?? null,
      resting_hr: (scores?.resting_hr as number) ?? null,
      spo2_average: (scores?.spo2_average as number) ?? null,
      steps: null,
      active_calories: null,
      daily_sleep: daily_sleep ?? null,
      daily_readiness: readiness ?? null,
      daily_activity: null,
      daily_stress: stress ?? null,
      daily_resilience: null,
      daily_cardiovascular_age: null,
      daily_spo2: null,
      sleep_detail: oura_live.sleep_detail ?? null,
      heartrate: null,
      vo2_max: null,
      workouts: null,
      sessions: null,
      sleep_time: null,
      fetched_at: new Date().toISOString(),
    };
  }

  // The page's metric cards fall back to yesterday's cache; the brief never does.
  const oura = oura_today ?? await get_wellness_cache(yesterday_str);

  const trends = new Map<string, TrendRow>();
  for (const row of trend_rows) {
    trends.set(row.metric_name, row);
  }

  // Metrics for the Coach page display
  const metrics: Record<string, unknown> = {};

  if (oura) {
    const readiness = oura.daily_readiness as OuraReadinessDetail | null;
    const cv_age = oura.daily_cardiovascular_age as OuraCardiovascularAge | null;
    const stress = oura.daily_stress as OuraStressDetail | null;
    // Sleep durations come from sleep_detail (period data), not daily_sleep (scores only)
    const sleep_period = primary_sleep(oura.sleep_detail as Record<string, unknown>[] | null) as OuraSleepDetail | null;

    const readiness_val = readiness?.score ?? oura.readiness_score ?? null;
    const hrv_val = oura.hrv_average ?? null;
    const rhr_val = oura.resting_hr ?? null;
    metrics.readiness = readiness_val;
    metrics.hrv = hrv_val;
    metrics.resting_hr = rhr_val;
    metrics.spo2 = oura.spo2_average ?? null;
    metrics.sleep_score = oura.sleep_score;

    if (sleep_period) {
      metrics.sleep_total = sleep_period.total_sleep_duration ? Math.round(sleep_period.total_sleep_duration / 60) : null;
      metrics.deep_sleep_min = sleep_period.deep_sleep_duration ? Math.round(sleep_period.deep_sleep_duration / 60) : null;
      metrics.rem_sleep_min = sleep_period.rem_sleep_duration ? Math.round(sleep_period.rem_sleep_duration / 60) : null;
      metrics.sleep_efficiency = sleep_period.efficiency ?? null;
    }

    // Oura's API returns no CV age, so estimate it from HRV + RHR (Umetani regression)
    metrics.cv_age = cv_age?.vascular_age ?? estimate_cv_age(hrv_val, rhr_val);

    if (stress) {
      const stressed_min = stress.stress_high ? Math.round(stress.stress_high / 60) : null;
      const restored_min = stress.recovery_high ? Math.round(stress.recovery_high / 60) : null;
      if (stressed_min !== null || restored_min !== null) {
        metrics.stress_min = stressed_min;
        metrics.restored_min = restored_min;
        if (stressed_min !== null && restored_min !== null && stressed_min + restored_min > 0) {
          const recovery_pct = Math.round((restored_min / (stressed_min + restored_min)) * 100);
          metrics.resilience = recovery_pct >= 65 ? 'High recovery, low stress'
            : recovery_pct >= 50 ? 'Balanced'
            : recovery_pct >= 35 ? 'Elevated stress'
            : 'High stress, low recovery';
          metrics.resilience_pct = recovery_pct;
        }
      }
    }
    metrics.recovery_status = compute_recovery_status(readiness_val, hrv_val, sleep_period, stress, rhr_val, trends);
  }

  // Weight comes from COROS (saved by the COROS sync); stale when not from today
  if (last_manual.weight_lbs !== null) {
    metrics.weight = last_manual.weight_lbs;
    metrics.weight_stale = last_manual.weight_date !== epoch_day;
  }
  if (manual.back_pain_scale !== undefined) metrics.back_pain = manual.back_pain_scale;

  // A weight passed in for today (no longer sent by the Coach page) replaces
  // the reading the COROS sync saved for today
  const today_weight = manual.weight_lbs ?? weights.find(w => w.date === date_str)?.lbs ?? null;
  const weight_last_7 = [
    ...weights.filter(w => w.date !== date_str),
    ...(today_weight != null ? [{ date: date_str, lbs: today_weight }] : []),
  ];

  const injection = build_daily_brief({
    today: date_str,
    last_night: oura_today ? last_night_from_oura({
      sleep_periods: oura_today.sleep_detail,
      hrv: oura_today.hrv_average,
      resting_hr: oura_today.resting_hr,
      spo2: oura_today.spo2_average,
      readiness: (oura_today.daily_readiness as OuraReadinessDetail | null)?.score ?? oura_today.readiness_score,
      resilience: (metrics.resilience as string | undefined) ?? null,
      status: (metrics.recovery_status as string | undefined) ?? null,
    }) : null,
    yesterday: yesterday_activities,
    coros_problem,
    scorecard,
    weight: { today: today_weight, last_7: weight_last_7 },
    back: { today: manual.back_pain_scale ?? null, notes: manual.back_mobility_notes ?? null, last_7: back_history },
    bowel: manual.bowel_status ?? null,
    notes: manual.injury_notes ?? null,
  });

  return { injection, metrics };
}
