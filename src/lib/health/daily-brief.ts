/**
 * The daily brief: the facts the coach reads before Bill's first message.
 * Pure: data in, labeled text out, so every number is exact and testable.
 *
 * It exists because the coach got facts wrong: the weekday, which night the
 * sleep was, a nap read as the night, descent read as climbing, and no COROS
 * at all. Rules:
 * - Always the date, the weekday and which night "last night" was (Mountain Time).
 * - Last night not uploaded yet (Bill has not opened the Oura app): say so,
 *   never show an older night as last night.
 * - Climbing and descent are separate; a lift-served bike park day is marked.
 * - Training comes from COROS; recovery from Oura.
 */

import { shift_date } from '@/lib/coaching/day';
import { STRENGTH_SPORT_TYPE, is_interval_session, strength_kind } from '@/lib/coros/classify';
import type { StoredCorosActivity } from '@/lib/coros/data';
import { scorecard_summary, type Scorecard, type ScoreRow, type ScoreStatus } from '@/lib/health/scorecard';
import { primary_sleep } from '@/lib/health/oura-derive';

/** Last night's Oura numbers, from the night's main sleep period (never a nap). */
export interface LastNight {
  sleep_min: number | null;
  deep_min: number | null;
  rem_min: number | null;
  efficiency_pct: number | null;
  hrv: number | null;
  resting_hr: number | null;
  spo2: number | null;
  readiness: number | null;
  resilience: string | null; // e.g. "High recovery, low stress"
  status: string | null;     // recovery status, e.g. "Ready, moderate effort"
}

interface SleepPeriod {
  type?: unknown;
  total_sleep_duration?: unknown;
  deep_sleep_duration?: unknown;
  rem_sleep_duration?: unknown;
  efficiency?: unknown;
}

const minutes = (seconds: unknown) => {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? Math.round(n / 60) : null;
};
const number_or_null = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Last night from Oura's data for today: the main sleep period (the longest
 * long_sleep, never a nap) plus the nightly scores. Null when nothing from
 * last night has been uploaded yet.
 */
export function last_night_from_oura(o: {
  sleep_periods: unknown;
  hrv: unknown;
  resting_hr: unknown;
  spo2: unknown;
  readiness: unknown;
  resilience?: string | null;
  status?: string | null;
}): LastNight | null {
  const night = primary_sleep(Array.isArray(o.sleep_periods) ? (o.sleep_periods as SleepPeriod[]) : null);
  const n: LastNight = {
    sleep_min: night ? minutes(night.total_sleep_duration) : null,
    deep_min: night ? minutes(night.deep_sleep_duration) : null,
    rem_min: night ? minutes(night.rem_sleep_duration) : null,
    efficiency_pct: night ? number_or_null(night.efficiency) : null,
    hrv: number_or_null(o.hrv),
    resting_hr: number_or_null(o.resting_hr),
    spo2: number_or_null(o.spo2),
    readiness: number_or_null(o.readiness),
    resilience: o.resilience ?? null,
    status: o.status ?? null,
  };
  return n.sleep_min == null && n.hrv == null && n.resting_hr == null ? null : n;
}

export interface BriefInput {
  today: string; // YYYY-MM-DD, Mountain Time
  /** Null when last night has not been uploaded yet. */
  last_night: LastNight | null;
  /** COROS activities dated yesterday. */
  yesterday: StoredCorosActivity[];
  /** Set when COROS could not be refreshed at session start. */
  coros_problem?: string | null;
  scorecard: Scorecard;
  weight: {
    today: number | null;
    /** Readings over the last 7 days, today's included. */
    last_7: Array<{ date: string; lbs: number }>;
  };
  back: {
    today: number | null;
    notes: string | null;
    /** Readings from the 7 days before today. */
    last_7: Array<{ date: string; scale: number }>;
  };
  bowel: string | null;
  notes: string | null;
}

/** Descent this much bigger than climbing, and at least 1,000 ft, reads as a lift-served park day. */
export const LIFT_DESCENT_RATIO = 2;
export const LIFT_MIN_DESCENT_M = 305;

const long_date = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const weekday = (d: string, style: 'long' | 'short' = 'long') =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: style, timeZone: 'UTC' });
const hm = (min: number) => {
  const total = Math.round(min);
  return total < 60 ? `${total}m` : `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
};
const feet = (m: number) => `${Math.round(m * 3.281).toLocaleString('en-US')} ft`;
const miles = (m: number) => `${(m / 1609.34).toFixed(1)} mi`;

const STATUS: Record<ScoreStatus, string> = {
  done: 'done', on_track: 'on track', behind: 'behind', missed: 'not met', no_data: 'no data',
};

/** True when a ride's descent dwarfs its climbing: lifts or shuttles did the climbing. */
export function is_lift_assisted(a: { ascent_m: number | null; descent_m: number | null }): boolean {
  if (a.descent_m == null || a.descent_m < LIFT_MIN_DESCENT_M) return false;
  return a.ascent_m == null || a.descent_m >= LIFT_DESCENT_RATIO * a.ascent_m;
}

/** COROS names custom sports "Sport(9806)"; the watch label reads better. */
const activity_name = (a: StoredCorosActivity) =>
  /^Sport\(\d+\)$/.test(a.sport_name) && a.location ? `${a.location} (custom sport)` : a.sport_name;

function activity_line(a: StoredCorosActivity): string {
  const parts: string[] = [];
  if (a.duration_s != null) parts.push(hm(a.duration_s / 60));
  if (a.distance_m) parts.push(miles(a.distance_m));
  if (a.ascent_m != null) parts.push(`climbed ${feet(a.ascent_m)}`);
  if (a.descent_m != null) parts.push(`descended ${feet(a.descent_m)}`);
  if (a.avg_hr != null) parts.push(`avg HR ${a.avg_hr}`);
  if (a.training_focus) parts.push(`focus ${a.training_focus}`);
  if (a.anaerobic_te != null) parts.push(`anaerobic TE ${a.anaerobic_te}`);

  let name = activity_name(a);
  if (a.sport_type === STRENGTH_SPORT_TYPE) {
    const kind = strength_kind(a);
    name += kind === 'heavy' ? ' (heavy strength)' : kind === 'mobility' ? ' (mobility)' : '';
    if (a.exercises?.length) parts.push(a.exercises.join(', '));
  }
  const flags: string[] = [];
  if (is_lift_assisted(a)) flags.push('Likely lift-assisted bike park day: count the descending, not the climbing');
  if (is_interval_session(a)) flags.push('Counts as an interval session');
  return `- ${name}: ${parts.join(', ')}${flags.length ? `. ${flags.join('; ')}` : ''}`;
}

/** Monday = 1 ... Sunday = 7, within the scorecard's week. */
const day_of_week = (card: Scorecard, today: string) =>
  Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${card.week_start}T12:00:00Z`)) / 86400000) + 1;

/**
 * Weekly to-dos the coach must name in its first reply (the coach never
 * mentioned heavy strength or intervals for two months). Only actions:
 * a missed ride or yoga day can't be undone, and HRV and resting HR are
 * recovery signals, not to-dos.
 */
export const NUDGE_KEYS: readonly ScoreRow['key'][] = ['heavy', 'intervals', 'ride_time', 'sleep', 'weight'];
/**
 * Heavy strength and intervals are named until done, even on pace: a once-a-week
 * session only falls behind pace on Friday, too late to plan it.
 */
export const UNTIL_DONE_KEYS: readonly ScoreRow['key'][] = ['heavy', 'intervals'];
/** Nudges start Wednesday: earlier in the week the pace is too short to judge. */
export const NUDGE_FROM_DAY = 3;

export function must_mention(card: Scorecard, today: string): ScoreRow[] {
  if (day_of_week(card, today) < NUDGE_FROM_DAY) return [];
  return card.rows.filter(r => NUDGE_KEYS.includes(r.key) && (
    r.status === 'behind' || r.status === 'missed' || (UNTIL_DONE_KEYS.includes(r.key) && r.status === 'on_track')
  ));
}

function row_line(r: ScoreRow): string {
  return `- ${r.label}: ${r.value} (target ${r.target}): ${STATUS[r.status]}${r.reason ? `, ${r.reason}` : ''}${r.note ? `. ${r.note}` : ''}`;
}

export function build_daily_brief(input: BriefInput): string {
  const { today } = input;
  const yesterday = shift_date(today, 1);
  const lines: string[] = [];

  lines.push(`Today: ${long_date(today)} (Mountain Time)`);
  lines.push(`Last night: ${weekday(yesterday)} night into ${weekday(today)} morning`);

  // --- Recovery (Oura) ---
  lines.push('', 'RECOVERY (Oura, last night)');
  const n = input.last_night;
  const vital = (key: ScoreRow['key']) => input.scorecard.rows.find(r => r.key === key);
  if (!n) {
    lines.push('Not uploaded yet: Bill has not synced the Oura app this morning. This is missing data, not a night without sleep. Ask him to open the Oura app, then start a new session.');
  } else {
    if (n.sleep_min != null) {
      const detail = [
        n.deep_min != null ? `deep ${hm(n.deep_min)}` : '',
        n.rem_min != null ? `REM ${hm(n.rem_min)}` : '',
        n.efficiency_pct != null ? `efficiency ${n.efficiency_pct}%` : '',
      ].filter(Boolean).join(', ');
      lines.push(`Sleep ${hm(n.sleep_min)}${detail ? `: ${detail}` : ''}`);
    } else {
      lines.push('Sleep: not in the Oura data yet');
    }
    const context = (r: ScoreRow | undefined) => (r && r.value !== '-' ? `; ${r.value}${r.note ? `. ${r.note}` : ''}` : r?.note ? `. ${r.note}` : '');
    if (n.hrv != null) lines.push(`HRV ${n.hrv} ms last night${context(vital('hrv'))}`);
    if (n.resting_hr != null) lines.push(`Resting HR ${n.resting_hr} bpm last night${context(vital('resting_hr'))}`);
    const extra = [
      n.spo2 != null ? `SpO2 ${n.spo2}%` : '',
      n.readiness != null ? `Readiness ${n.readiness}` : '',
      n.resilience ? `Stress vs recovery: ${n.resilience}` : '',
    ].filter(Boolean);
    if (extra.length) lines.push(extra.join('. '));
    if (n.status) lines.push(`Status: ${n.status}`);
  }

  // --- Yesterday's training (COROS) ---
  lines.push('', `YESTERDAY (${long_date(yesterday)}, from COROS)`);
  if (input.coros_problem) lines.push(`COROS refresh problem (${input.coros_problem}); training data may be out of date.`);
  if (input.yesterday.length === 0) {
    lines.push('No activities in COROS for yesterday.');
  } else {
    for (const a of input.yesterday) lines.push(activity_line(a));
  }

  // --- This week ---
  const card = input.scorecard;
  const summary = scorecard_summary(card.rows);
  lines.push('', `THIS WEEK (${long_date(card.week_start)} to ${long_date(card.week_end)}; day ${day_of_week(card, today)} of 7)`);
  lines.push(`${summary.ok} of ${summary.judged} on track`);
  if (summary.missed.length) lines.push(`Not met: ${summary.missed.join('; ')}`);
  if (summary.behind.length) lines.push(`Behind: ${summary.behind.join('; ')}`);
  for (const r of card.rows) lines.push(row_line(r));

  const nudges = must_mention(card, today);
  if (nudges.length > 0) {
    lines.push('', 'MUST MENTION (weekly to-dos from his framework, not done yet; name each one in your first reply)');
    for (const r of nudges) {
      const why = r.reason ?? (r.status === 'on_track' ? 'still to do this week' : '');
      lines.push(`- ${r.label}${r.status === 'missed' ? ' (not met)' : ''}: ${r.value}${why ? `; ${why}` : ''}`);
    }
  }

  // --- Body (typed) ---
  lines.push('', 'BODY (typed by Bill)');
  const w = input.weight;
  const avg = w.last_7.length ? w.last_7.reduce((s, r) => s + r.lbs, 0) / w.last_7.length : null;
  const avg_text = avg != null && w.last_7.length > 1 ? `. 7-day avg ${avg.toFixed(1)} lb over ${w.last_7.length} readings` : '';
  if (w.today != null) {
    lines.push(`Weight ${w.today} lb today${avg_text}`);
  } else {
    const last = [...w.last_7].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    lines.push(last ? `Weight not entered today; last ${last.lbs} lb on ${long_date(last.date)}${avg_text}` : 'Weight not entered in the last 7 days');
  }
  const b = input.back;
  const history = [...b.last_7].sort((x, y) => (x.date < y.date ? -1 : 1)).map(r => `${weekday(r.date, 'short')} ${r.scale}`).join(', ');
  const today_back = b.today != null ? `Back ${b.today}/10 today${b.notes ? ` (${b.notes})` : ''}` : 'Back not entered today';
  lines.push(`${today_back}. Last 7 days: ${history || 'no entries'}`);
  if (input.bowel) lines.push(`Bowel: ${input.bowel}`);
  if (input.notes) lines.push(`Notes: ${input.notes}`);

  lines.push('', 'Coach me.');
  return lines.join('\n');
}
