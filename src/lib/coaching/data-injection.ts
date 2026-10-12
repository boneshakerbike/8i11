/**
 * Data injection formatter for coaching sessions.
 * Pulls Oura data from wellness_cache + Ride with GPS activities + manual inputs.
 * No COROS. Oura drives decisions. Activity data is context only.
 */

import { get_wellness_cache } from '@/lib/db';
import { get_trends, get_last_known_manual_metrics, type TrendRow } from '@/lib/coaching/db';
import { rwgps_activity_date_str, type RwgpsActivity } from '@/lib/ridewithgps';
import { estimate_cv_age, primary_sleep } from '@/lib/health/oura-derive';

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

function seconds_to_hm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function fmt_trend(value: number | null, trends: Map<string, TrendRow>, metric: string, unit: string): string {
  if (value === null || value === undefined) return 'no data';
  const t = trends.get(metric);
  let s = `${value}${unit}`;
  if (t) {
    if (t.value_7day_avg !== null) s += ` (7d avg: ${t.value_7day_avg}${unit}`;
    if (t.value_30day_avg !== null) s += `, 30d avg: ${t.value_30day_avg}${unit}`;
    if (t.value_7day_direction && t.value_7day_direction !== 'stable') s += ` [${t.value_7day_direction}]`;
    s += ')';
  }
  return s;
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
 * Build the data injection string for a coaching session.
 * date_str: YYYY-MM-DD format
 * epoch_day: mt_epoch_day() (Mountain Time day boundary) for trend_cache lookup
 */
export async function build_data_injection(
  date_str: string,
  epoch_day: number,
  manual: ManualInputs,
  oura_live?: Record<string, unknown> | null,
  activities?: RwgpsActivity[] | null,
): Promise<{ injection: string; metrics: Record<string, unknown> }> {
  const yesterday = new Date(date_str + 'T12:00:00');
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterday_str = yesterday.toISOString().split('T')[0];

  const [oura_initial, trend_rows, last_manual] = await Promise.all([
    get_wellness_cache(date_str),
    get_trends(epoch_day),
    get_last_known_manual_metrics(),
  ]);
  let oura = oura_initial;

  // If live Oura data was passed from the client, use it over cache
  if (oura_live && oura_live.success) {
    const scores = oura_live.scores as Record<string, unknown> | undefined;
    const daily_sleep = (oura_live.sleep ?? oura_live.daily_sleep) as OuraSleepDetail | undefined;
    const readiness = (oura_live.readiness ?? oura_live.daily_readiness) as OuraReadinessDetail | undefined;
    const stress = (oura_live.stress ?? oura_live.daily_stress) as OuraStressDetail | undefined;
    oura = {
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

  // Fall back to yesterday's cached data if today's isn't available
  if (!oura) {
    oura = await get_wellness_cache(yesterday_str);
  }

  const trends = new Map<string, TrendRow>();
  for (const row of trend_rows) {
    trends.set(row.metric_name, row);
  }

  // Build metrics object for pre-chat display
  const metrics: Record<string, unknown> = {};
  const lines: string[] = [];
  lines.push(`Health data for ${date_str}:`);
  lines.push('');

  // --- OURA ---
  const oura_label = oura?.date === yesterday_str ? `using ${yesterday_str} data` : '';
  if (oura) {
    const readiness = oura.daily_readiness as OuraReadinessDetail | null;
    const cv_age = oura.daily_cardiovascular_age as OuraCardiovascularAge | null;
    const stress = oura.daily_stress as OuraStressDetail | null;

    // Sleep durations come from sleep_detail (period data), not daily_sleep (scores only)
    const sleep_period = primary_sleep(oura.sleep_detail as Record<string, unknown>[] | null) as OuraSleepDetail | null;

    const readiness_val = readiness?.score ?? oura.readiness_score ?? null;
    const hrv_val = oura.hrv_average ?? null;
    const rhr_val = oura.resting_hr ?? null;
    const spo2_val = oura.spo2_average ?? null;

    metrics.readiness = readiness_val;
    metrics.hrv = hrv_val;
    metrics.resting_hr = rhr_val;
    metrics.spo2 = spo2_val;
    metrics.sleep_score = oura.sleep_score;

    if (oura_label) lines.push(`(Oura ${oura_label})`);
    lines.push(`Readiness: ${readiness_val ?? 'N/A'}/100`);
    lines.push(`HRV: ${fmt_trend(hrv_val, trends, 'hrv_rmssd', 'ms')}`);
    lines.push(`Resting HR: ${fmt_trend(rhr_val, trends, 'resting_hr', ' bpm')}`);

    if (sleep_period) {
      const total = sleep_period.total_sleep_duration ? seconds_to_hm(sleep_period.total_sleep_duration) : 'N/A';
      const deep = sleep_period.deep_sleep_duration ? seconds_to_hm(sleep_period.deep_sleep_duration) : 'N/A';
      const rem = sleep_period.rem_sleep_duration ? seconds_to_hm(sleep_period.rem_sleep_duration) : 'N/A';
      const deep_min = sleep_period.deep_sleep_duration ? Math.round(sleep_period.deep_sleep_duration / 60) : null;
      const rem_min = sleep_period.rem_sleep_duration ? Math.round(sleep_period.rem_sleep_duration / 60) : null;
      const efficiency = sleep_period.efficiency ? `${sleep_period.efficiency}%` : 'N/A';
      lines.push(`Sleep: ${total} total, ${deep} deep, ${rem} REM, efficiency ${efficiency}`);
      metrics.sleep_total = sleep_period.total_sleep_duration ? Math.round(sleep_period.total_sleep_duration / 60) : null;
      metrics.deep_sleep_min = deep_min;
      metrics.rem_sleep_min = rem_min;
      metrics.sleep_efficiency = sleep_period.efficiency ?? null;
    } else if (oura.sleep_score) {
      lines.push(`Sleep score: ${oura.sleep_score}`);
    }

    if (spo2_val) {
      lines.push(`SpO2: ${spo2_val}%`);
      metrics.spo2 = spo2_val;
    }

    if (cv_age?.vascular_age) {
      lines.push(`Cardiovascular age: ${cv_age.vascular_age}`);
      metrics.cv_age = cv_age.vascular_age;
    } else {
      // Estimate CV age from HRV + RHR (Umetani regression)
      const estimated_cv_age = estimate_cv_age(hrv_val, rhr_val);
      if (estimated_cv_age != null) {
        lines.push(`Cardiovascular age: ~${estimated_cv_age} (estimated from HRV + RHR)`);
        metrics.cv_age = estimated_cv_age;
      }
    }

    if (stress) {
      const stressed_min = stress.stress_high ? Math.round(stress.stress_high / 60) : null;
      const restored_min = stress.recovery_high ? Math.round(stress.recovery_high / 60) : null;
      if (stressed_min !== null || restored_min !== null) {
        lines.push(`Stress: ${stressed_min ?? '?'}min stressed, ${restored_min ?? '?'}min restored`);
        metrics.stress_min = stressed_min;
        metrics.restored_min = restored_min;

        // Resilience indicator: stress-recovery balance
        if (stressed_min !== null && restored_min !== null) {
          const total = stressed_min + restored_min;
          if (total > 0) {
            const recovery_pct = Math.round((restored_min / total) * 100);
            let resilience: string;
            if (recovery_pct >= 65) resilience = 'High recovery, low stress';
            else if (recovery_pct >= 50) resilience = 'Balanced';
            else if (recovery_pct >= 35) resilience = 'Elevated stress';
            else resilience = 'High stress, low recovery';
            metrics.resilience = resilience;
            metrics.resilience_pct = recovery_pct;
            lines.push(`Resilience: ${resilience} (${recovery_pct}% recovery)`);
          }
        }
      }
    }
    // Compute recovery status from available signals
    const recovery_status = compute_recovery_status(
      readiness_val, hrv_val, sleep_period, stress, rhr_val, trends
    );
    metrics.recovery_status = recovery_status;
    lines.push(`Recovery status: ${recovery_status}`);
  } else {
    lines.push('No Oura data available');
  }

  lines.push('');

  // --- ACTIVITIES (yesterday) ---
  if (activities && activities.length > 0) {
    // Filter to yesterday's activities
    const yesterday_activities = activities.filter(a => {
      if (!a.departed_at) return false;
      return rwgps_activity_date_str(a.departed_at) === yesterday_str;
    });

    if (yesterday_activities.length > 0) {
      lines.push(`Yesterday's activities (${yesterday_str}):`);
      metrics.yesterday_activities = [];
      for (const a of yesterday_activities.slice(0, 5)) {
        const name = a.name || 'Activity';
        const type = a.type || '';
        const dist = a.distance ? `${(a.distance / 1609.34).toFixed(1)}mi` : '';
        const elev = a.total_elevation_gain ? `${Math.round(a.total_elevation_gain * 3.281)}ft elev` : '';
        const time = a.moving_time ? `${Math.round(a.moving_time / 60)}min` : '';
        const hr = a.average_heartrate ? `avg HR ${Math.round(a.average_heartrate)}` : '';
        const parts = [type, dist, elev, time, hr].filter(Boolean).join(', ');
        lines.push(`- ${name}: ${parts}`);
        (metrics.yesterday_activities as RwgpsActivity[]).push({
          id: a.id, name, type, distance: a.distance, moving_time: a.moving_time,
          total_elevation_gain: a.total_elevation_gain,
          average_heartrate: a.average_heartrate, max_heartrate: a.max_heartrate,
          url: a.url,
        });
      }
    } else {
      lines.push('No activities recorded yesterday');
    }
  } else {
    lines.push('No activity data available');
  }

  lines.push('');

  // --- WEIGHT & MANUAL ---
  if (manual.weight_lbs !== undefined) {
    lines.push(`Weight: ${fmt_trend(manual.weight_lbs, trends, 'weight_lbs', ' lbs')}`);
    metrics.weight = manual.weight_lbs;
  } else if (last_manual.weight_lbs !== null && last_manual.weight_date !== null) {
    const d = new Date(last_manual.weight_date * 86400000).toISOString().split('T')[0];
    lines.push(`Weight: ${last_manual.weight_lbs} lbs (last entered ${d})`);
    metrics.weight = last_manual.weight_lbs;
    metrics.weight_stale = true;
  }

  if (manual.back_pain_scale !== undefined) {
    const back = manual.back_pain_scale;
    const label = back === 0 ? 'None' : back <= 3 ? 'Mild' : back <= 6 ? 'Moderate' : 'Severe';
    const mobility = manual.back_mobility_notes ? `, ${manual.back_mobility_notes}` : '';
    lines.push(`Back: ${label} (${back}/10)${mobility}`);
    metrics.back_pain = back;
  }

  if (manual.bowel_status) lines.push(`Bowel: ${manual.bowel_status}`);
  if (manual.injury_notes) lines.push(`Notes: ${manual.injury_notes}`);

  lines.push('');
  lines.push('Coach me.');

  return { injection: lines.join('\n'), metrics };
}
