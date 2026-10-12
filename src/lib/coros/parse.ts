/**
 * Parsers for COROS MCP tool output.
 *
 * COROS answers in human-readable text, not JSON (docs/health-roadmap.md,
 * Phase 0 findings). Each parser reads one tool's text and returns plain
 * records. A line it cannot read becomes null, never a guess; the sync treats
 * "text but zero records" as a format change and reports it.
 *
 * Dates come back as yyyyMMdd or YYYY-MM-DD and are returned as YYYY-MM-DD.
 * Sleep dates are wake-up days (the night of D is filed under D+1).
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** The tool's text. COROS wraps it in a JSON string literal, so unwrap that too. */
export function tool_text(result: CallToolResult | null | undefined): string {
  const block = result?.content?.find(c => c.type === 'text');
  const text = block && 'text' in block ? String(block.text) : '';
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      const inner = JSON.parse(text);
      if (typeof inner === 'string') return inner;
    } catch { /* not a JSON string; use as is */ }
  }
  return text;
}

/**
 * COROS fills a missing value with 65535 (shown as 65535, 6553.5 or 655.35).
 * Number patterns below read decimals on purpose: a whole-number pattern would
 * turn 655.35 into a believable but wrong 655.
 */
const PLACEHOLDERS = new Set([65535, 6553.5, 655.35]);

const num = (s: string | undefined | null): number | null => {
  if (s == null) return null;
  const n = Number(s.replaceAll(',', ''));
  return Number.isFinite(n) && !PLACEHOLDERS.has(n) ? n : null;
};

const match_num = (text: string, re: RegExp): number | null => num(text.match(re)?.[1]);

/** "2h 50min", "36 min", "1h" -> minutes. */
export function duration_text_min(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = s.match(/^\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?\s*$/);
  if (!m || (m[1] == null && m[2] == null)) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

/** "16:27" (m:ss) or "1:33:09" (h:mm:ss) -> seconds. */
export function clock_seconds(s: string | undefined | null): number | null {
  if (!s) return null;
  const parts = s.trim().split(':').map(Number);
  if (parts.some(p => !Number.isInteger(p) || p < 0) || parts.length < 2 || parts.length > 3) return null;
  return parts.reduce((total, p) => total * 60 + p, 0);
}

/** "20261006" or "2026-10-06" -> "2026-10-06". */
export function iso_date(s: string): string {
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}

/** Split text into [date, block] pairs at lines that are only a date header. */
function blocks_by_date(text: string, header: RegExp): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const lines = text.split('\n');
  let current: [string, string[]] | null = null;
  for (const line of lines) {
    const m = line.trim().match(header);
    if (m) {
      if (current) out.push([current[0], current[1].join('\n')]);
      current = [iso_date(m[1]), []];
    } else if (current) {
      current[1].push(line);
    }
  }
  if (current) out.push([current[0], current[1].join('\n')]);
  return out;
}

export interface CorosDailyHealth {
  date: string;
  steps: number | null;
  exercise_min: number | null;
  stress_avg: number | null;
  sleep_total_min: number | null;
  sleep_deep_min: number | null;
  sleep_light_min: number | null;
  sleep_rem_min: number | null;
  sleep_awake_min: number | null;
  sleep_hr_avg: number | null;
}

/** queryDailyHealthData */
export function parse_daily_health(text: string): CorosDailyHealth[] {
  return blocks_by_date(text, /^---\s*(\d{8})\s*---$/).map(([date, b]) => {
    const dur = (label: string) => duration_text_min(b.match(new RegExp(`${label}:\\s*([^|\\n]+)`))?.[1]);
    const sleep = b.split(/Sleep Summary:/)[1] ?? '';
    const sleep_dur = (label: string) => duration_text_min(sleep.match(new RegExp(`${label}:\\s*([^|\\n]+)`))?.[1]);
    return {
      date,
      steps: match_num(b, /Steps:\s*([\d,.]+)/),
      exercise_min: dur('Exercise'),
      stress_avg: match_num(b, /Stress:\s*Avg\s*([\d.]+)/),
      sleep_total_min: sleep_dur('Total'),
      sleep_deep_min: sleep_dur('Deep'),
      sleep_light_min: sleep_dur('Light'),
      sleep_rem_min: sleep_dur('REM'),
      sleep_awake_min: sleep_dur('Awake'),
      sleep_hr_avg: match_num(sleep, /Sleep HR:\s*Avg\s*([\d.]+)/),
    };
  });
}

export interface CorosSleepHrv {
  date: string;
  hrv_avg: number | null;
  status: string | null;
  range_low: number | null;
  range_high: number | null;
  baseline: number | null;
}

/** querySleepHrv: the official daily assessment only; raw time series is skipped. */
export function parse_sleep_hrv(text: string): CorosSleepHrv[] {
  const assessment = text.split(/Sleep HRV Time Series/)[0];
  return blocks_by_date(assessment, /^(\d{4}-\d{2}-\d{2}):$/).map(([date, b]) => {
    const avg = b.match(/HRV Avg:\s*([\d.]+)\s*ms\s*\S\s*(.+)/);
    const range = b.match(/Normal Range:\s*([\d.]+)\s*-\s*([\d.]+)/);
    return {
      date,
      hrv_avg: num(avg?.[1]),
      status: avg?.[2]?.trim() || null,
      range_low: num(range?.[1]),
      range_high: num(range?.[2]),
      baseline: match_num(b, /Baseline:\s*([\d.]+)/),
    };
  });
}

/** queryRestingHeartRate */
export function parse_resting_hr(text: string): Array<{ date: string; resting_hr: number | null }> {
  return [...text.matchAll(/^(\d{4}-\d{2}-\d{2}):\s*(.+)$/gm)].map(m => ({
    date: m[1],
    resting_hr: match_num(m[2], /^([\d.]+)\s*bpm/),
  }));
}

export interface CorosRecovery {
  recovery_pct: number | null;
  level: string | null;
  full_recovery_hours: number | null;
}

/** queryRecoveryStatus: current state only, no date in the text. */
export function parse_recovery(text: string): CorosRecovery | null {
  const pct = match_num(text, /Recovery:\s*([\d.]+)\s*%/);
  if (pct == null) return null;
  return {
    recovery_pct: pct,
    level: text.match(/Level:\s*(.+)/)?.[1]?.trim() ?? null,
    full_recovery_hours: match_num(text, /Estimated Full Recovery:\s*([\d.]+)\s*h/),
  };
}

/** queryFitnessAssessmentOverview: VO2max is all the plan uses. */
export function parse_fitness(text: string): { vo2max: number | null } | null {
  const vo2max = match_num(text, /VO2max:\s*([\d.]+)/);
  return vo2max == null ? null : { vo2max };
}

export interface CorosTrainingLoad {
  date: string;
  comment: string | null;
  short_term: number | null;
  long_term: number | null;
  ratio: number | null;
}

/** queryTrainingLoadAssessment (stored and shown, never used to coach). */
export function parse_training_load(text: string): CorosTrainingLoad[] {
  return blocks_by_date(text, /^(\d{4}-\d{2}-\d{2})$/).map(([date, b]) => ({
    date,
    comment: b.match(/Comment:\s*(.+)/)?.[1]?.trim() ?? null,
    short_term: match_num(b, /Short-Term Load:\s*([\d.]+)/),
    long_term: match_num(b, /Long-Term Load:\s*([\d.]+)/),
    ratio: match_num(b, /Load Ratio:\s*([\d.]+)/),
  }));
}

export interface CorosActivity {
  label_id: string;
  sport_type: number;
  sport_name: string;
  date: string;
  start_ts: number | null;
  end_ts: number | null;
  duration_s: number | null;
  distance_m: number | null;
  sets: number | null;
  avg_hr: number | null;
  calories: number | null;
  avg_speed_kmh: number | null;
  location: string | null;
}

/** querySportRecords. GPS coordinates in the text are deliberately not kept. */
export function parse_sport_records(text: string): CorosActivity[] {
  const out: CorosActivity[] = [];
  const parts = text.split(/^(?=\d+\.\s)/m).slice(1);
  for (const part of parts) {
    const head = part.match(/^\d+\.\s*(.+?)\s+\S\s+(\d{4}-\d{2}-\d{2})\s*$/m);
    const ids = part.match(/LabelId:\s*(\d+)\s*\|\s*SportType:\s*(\d+)/);
    if (!head || !ids) continue;
    const distance = part.match(/Distance:\s*([\d.,]+)\s*(km|m)\b/);
    const distance_value = num(distance?.[1]);
    out.push({
      label_id: ids[1],
      sport_type: Number(ids[2]),
      sport_name: head[1].trim(),
      date: head[2],
      start_ts: match_num(part, /startTimestamp=(\d+)/),
      end_ts: match_num(part, /endTimestamp=(\d+)/),
      duration_s: clock_seconds(part.match(/Duration:\s*([\d:]+)/)?.[1]),
      distance_m: distance_value == null ? null : Math.round(distance?.[2] === 'km' ? distance_value * 1000 : distance_value),
      sets: match_num(part, /Sets:\s*([\d.]+)/),
      avg_hr: match_num(part, /Avg HR:\s*([\d.]+)/),
      calories: match_num(part, /Calories:\s*([\d,.]+)/),
      avg_speed_kmh: match_num(part, /Average Speed:\s*([\d.]+)\s*km\/h/),
      location: part.match(/Location:\s*(.+)/)?.[1]?.trim() ?? null,
    });
  }
  return out;
}

export interface CorosActivityDetail {
  ascent_m: number | null;
  descent_m: number | null;
}

/**
 * getActivityDetail: elevation gain and loss, kept separate so a lift-served
 * park day (big descent, little climbing) is never read as climbing.
 * Returns null when the text has no elevation line.
 */
export function parse_activity_detail(text: string): CorosActivityDetail | null {
  const m = text.match(/Elevation Gain\s*\/\s*Loss:\s*([\d.,]+)\s*(m|ft)\s*\/\s*([\d.,]+)\s*(m|ft)/);
  if (!m) return null;
  const meters = (value: string, unit: string) => {
    const n = num(value);
    return n == null ? null : Math.round(unit === 'ft' ? n / 3.281 : n);
  };
  return { ascent_m: meters(m[1], m[2]), descent_m: meters(m[3], m[4]) };
}
