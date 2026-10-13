/**
 * Weekly scorecard: this week against Bill's targets (docs/health-roadmap.md,
 * Decisions, 2026-10-12). Plain counting from synced data, no AI; the coach
 * will read the same rows. Pure: data in, rows out.
 *
 * - Week: Monday to Sunday, Mountain Time. Work days: Monday to Friday.
 * - Dates are YYYY-MM-DD. Sleep is filed under the morning Bill woke up
 *   (Oura and COROS agree), so Monday's sleep is Sunday night.
 * - Pace ("on track") is measured through yesterday, so a day that has not
 *   happened yet never counts against him.
 */

import { RIDE_DAY_SPORT_TYPES, STRENGTH_SPORT_TYPE, is_interval_session, strength_kind } from '@/lib/coros/classify';
import { shift_date } from '@/lib/coaching/day';

export const TARGETS = {
  ride_min: 7 * 60,        // ride time per week (MTB, e-MTB, gravel)
  heavy_per_week: 3,       // framework Lever 3
  intervals_per_week: 1,   // framework Lever 1 (4x4)
  sleep_goal_min: 8 * 60,  // average
  sleep_floor_min: 7 * 60, // every night
  weight_max_lbs: 195,     // never above
  weight_goal_lbs: 190,    // at least one reading below, each week
} as const;

/** Days of history needed before HRV and resting HR are judged against normal. */
export const BASELINE_MIN_DAYS = 28;
/** Baseline window, ending the day before the last 7 days. */
export const BASELINE_DAYS = 90;
/**
 * The 7-day average counts as off normal when it is more than half a standard
 * deviation of the 90-day baseline away from its mean, on the bad side. This is
 * the "smallest worthwhile change" used in HRV-guided training (Plews et al.,
 * Sports Med 2013). The framework can replace it in Phase 3.
 */
export const OFF_NORMAL_SD = 0.5;

export type ScoreStatus = 'done' | 'on_track' | 'behind' | 'missed' | 'no_data';

export interface ScoreRow {
  key: 'ride_time' | 'ride_days' | 'mobility' | 'heavy' | 'intervals' | 'sleep' | 'hrv' | 'resting_hr' | 'weight';
  label: string;
  value: string;
  target: string;
  status: ScoreStatus;
  note?: string;
  /** Why a row is behind or not met, in a few words, for the one-line summary. */
  reason?: string;
}

export interface ScorecardActivity {
  date: string;
  sport_type: number;
  duration_s: number | null;
  working_sets: number | null;
  loaded_sets: number | null;
  anaerobic_te: number | null;
  training_focus: string | null;
}

export interface ScorecardInput {
  today: string;
  /** COROS activities; only this week's are counted. */
  activities: ScorecardActivity[];
  /** Total sleep per wake-up day; only this week's are counted. */
  sleep: Array<{ date: string; total_min: number | null }>;
  /** Weight readings; only this week's are counted. */
  weights: Array<{ date: string; lbs: number | null }>;
  /** Nightly HRV and resting HR, covering at least the last 97 days. */
  vitals: Array<{ date: string; hrv: number | null; resting_hr: number | null }>;
}

export interface Scorecard {
  week_start: string;
  week_end: string;
  today: string;
  rows: ScoreRow[];
}

/**
 * One row per date: the first source's values, with the second filling any
 * value the first lacks. Used to fill gaps in the Oura cache from coach-session
 * history, which holds the same Oura numbers.
 */
export function fill_gaps<T extends { date: string }>(primary: T[], fallback: T[]): T[] {
  const by_date = new Map<string, T>(fallback.map(r => [r.date, r]));
  for (const r of primary) {
    const older = by_date.get(r.date);
    if (!older) {
      by_date.set(r.date, r);
      continue;
    }
    const merged: Record<string, unknown> = { ...older };
    for (const [k, v] of Object.entries(r)) if (v != null) merged[k] = v;
    by_date.set(r.date, merged as T);
  }
  return [...by_date.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 0 = Sunday ... 6 = Saturday */
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Monday of the week containing `date`. */
export function week_start(date: string): string {
  return shift_date(date, (weekday(date) + 6) % 7);
}

const hm = (min: number) => {
  const total = Math.round(min);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * A count target such as "heavy strength 3 times". Missed when there are not
 * enough days left (one a day); behind when under the pace for the days
 * already finished.
 */
function count_status(count: number, target: number, days_done: number): ScoreStatus {
  if (count >= target) return 'done';
  const days_left = 7 - days_done; // today included
  if (target - count > days_left) return 'missed';
  return count >= pace(target, days_done) ? 'on_track' : 'behind';
}

/** How many of a weekly count should be done after `days_done` finished days. */
const pace = (target: number, days_done: number) => Math.round((target * days_done) / 7);

/** Short weekday names, e.g. "Tue, Wed". */
const day_names = (dates: string[]) =>
  dates.map(d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })).join(', ');

/**
 * A daily target such as "a ride every day", over the days so far: missed once
 * a finished day lacks it, done when all `span` days of the week have it.
 */
function every_day_status(done: Set<string>, days: string[], today: string, span: number): ScoreStatus {
  if (days.some(d => d < today && !done.has(d))) return 'missed';
  return days.length === span && days.every(d => done.has(d)) ? 'done' : 'on_track';
}

function vital_row(
  key: 'hrv' | 'resting_hr', label: string, unit: string,
  vitals: ScorecardInput['vitals'], today: string, higher_is_better: boolean,
): ScoreRow {
  const recent_from = shift_date(today, 6);
  const base_from = shift_date(today, 6 + BASELINE_DAYS);
  const pick = (v: ScorecardInput['vitals'][number]) => v[key];
  const recent = vitals.filter(v => v.date >= recent_from && v.date <= today).map(pick).filter((x): x is number => x != null && x > 0);
  const base = vitals.filter(v => v.date >= base_from && v.date < recent_from).map(pick).filter((x): x is number => x != null && x > 0);
  const target = 'within your 90-day normal';
  if (recent.length < 3) return { key, label, value: '-', target, status: 'no_data', note: 'Fewer than 3 nights in the last 7 days' };
  const now = mean(recent);
  const value = `${Math.round(now)} ${unit} (7-day avg)`;
  if (base.length < BASELINE_MIN_DAYS) {
    return { key, label, value, target, status: 'no_data', note: `Building your normal: ${base.length} of ${BASELINE_MIN_DAYS} days so far` };
  }
  const m = mean(base);
  const band = OFF_NORMAL_SD * sd(base);
  const low = Math.round(m - band);
  const high = Math.round(m + band);
  const where = now < m - band ? 'below normal' : now > m + band ? 'above normal' : 'normal';
  const worse = higher_is_better ? now < m - band : now > m + band;
  const range = low === high ? `${low}` : `${low}-${high}`;
  return {
    key, label, value, target, status: worse ? 'behind' : 'on_track', note: `Normal ${range} ${unit}; now ${where}`,
    reason: worse ? `${where.replace(' normal', '')} your normal` : undefined,
  };
}

export function weekly_scorecard(input: ScorecardInput): Scorecard {
  const { today } = input;
  const start = week_start(today);
  const end = shift_date(start, -6);
  const days: string[] = [];
  for (let d = start; d <= today; d = shift_date(d, -1)) days.push(d);
  const days_done = days.length - 1; // finished days before today
  const in_week = (date: string) => date >= start && date <= today;
  const acts = input.activities.filter(a => in_week(a.date));

  const rides = acts.filter(a => RIDE_DAY_SPORT_TYPES.has(a.sport_type));
  const ride_min = rides.reduce((sum, a) => sum + (a.duration_s ?? 0) / 60, 0);
  const ride_days = new Set(rides.map(a => a.date));

  const strength = acts.filter(a => a.sport_type === STRENGTH_SPORT_TYPE);
  const heavy = strength.filter(a => strength_kind(a) === 'heavy');
  const unread = strength.filter(a => strength_kind(a) == null).length;
  const mobility_days = new Set(strength.filter(a => strength_kind(a) !== 'heavy').map(a => a.date));
  const work_days = days.filter(d => weekday(d) >= 1 && weekday(d) <= 5);

  const intervals = acts.filter(a => is_interval_session(a));

  const rows: ScoreRow[] = [];

  const ride_pace = (TARGETS.ride_min * days_done) / 7;
  const ride_status: ScoreStatus = ride_min >= TARGETS.ride_min ? 'done' : ride_min >= ride_pace ? 'on_track' : 'behind';
  rows.push({
    key: 'ride_time', label: 'Ride time', value: hm(ride_min), target: hm(TARGETS.ride_min), status: ride_status,
    reason: ride_status === 'behind' ? `pace is ${hm(ride_pace)} by now` : undefined,
  });

  const no_ride = days.filter(d => d < today && !ride_days.has(d));
  rows.push({
    key: 'ride_days', label: 'Ride days', value: `${ride_days.size} of ${days.length}`, target: 'every day',
    status: every_day_status(ride_days, days, today, 7),
    reason: no_ride.length > 0 ? `no ride ${day_names(no_ride)}` : undefined,
  });

  const mobility_done = new Set(work_days.filter(d => mobility_days.has(d)));
  const no_mobility = work_days.filter(d => d < today && !mobility_done.has(d));
  rows.push({
    key: 'mobility', label: 'Yoga / mobility', value: `${mobility_done.size} of ${work_days.length} work days`, target: 'every work day',
    status: every_day_status(mobility_done, work_days, today, 5),
    reason: no_mobility.length > 0 ? `none ${day_names(no_mobility)}` : undefined,
  });

  const heavy_status = count_status(heavy.length, TARGETS.heavy_per_week, days_done);
  rows.push({
    key: 'heavy', label: 'Heavy strength', value: `${heavy.length} of ${TARGETS.heavy_per_week}`, target: `${TARGETS.heavy_per_week} a week`,
    status: heavy_status,
    note: unread > 0 ? `${plural(unread, 'strength session')} not classified yet` : undefined,
    reason: heavy_status === 'behind' ? `pace is ${pace(TARGETS.heavy_per_week, days_done)} by now`
      : heavy_status === 'missed' ? `too few days left for ${TARGETS.heavy_per_week}` : undefined,
  });

  const interval_status = count_status(intervals.length, TARGETS.intervals_per_week, days_done);
  rows.push({
    key: 'intervals', label: 'Intervals', value: `${intervals.length} of ${TARGETS.intervals_per_week}`, target: `${TARGETS.intervals_per_week} a week (4x4)`,
    status: interval_status,
    reason: interval_status === 'behind' ? 'none yet' : undefined,
  });

  const nights = input.sleep.filter(s => in_week(s.date) && s.total_min != null && s.total_min > 0).map(s => s.total_min as number);
  if (nights.length === 0) {
    rows.push({ key: 'sleep', label: 'Sleep', value: '-', target: '8h avg, 7h minimum', status: 'no_data' });
  } else {
    const avg = mean(nights);
    const short = nights.filter(n => n < TARGETS.sleep_floor_min).length;
    const why = [avg < TARGETS.sleep_goal_min ? 'average under 8h' : '', short > 0 ? `${plural(short, 'night')} under 7h` : ''].filter(Boolean);
    rows.push({
      key: 'sleep', label: 'Sleep', value: `${hm(avg)} avg over ${plural(nights.length, 'night')}`, target: '8h avg, 7h minimum',
      status: why.length === 0 ? 'on_track' : 'behind',
      note: short > 0 ? `${plural(short, 'night')} under 7h` : undefined,
      reason: why.length > 0 ? why.join(', ') : undefined,
    });
  }

  rows.push(vital_row('hrv', 'HRV', 'ms', input.vitals, today, true));
  rows.push(vital_row('resting_hr', 'Resting HR', 'bpm', input.vitals, today, false));

  const week_weights = input.weights.filter(w => in_week(w.date) && w.lbs != null && w.lbs > 0);
  const weights = week_weights.map(w => w.lbs as number);
  const weight_target = `under ${TARGETS.weight_goal_lbs} once, never over ${TARGETS.weight_max_lbs}`;
  if (weights.length === 0) {
    rows.push({ key: 'weight', label: 'Weight', value: '-', target: weight_target, status: 'no_data', note: 'No COROS weight this week' });
  } else {
    const low = Math.min(...weights);
    const high = Math.max(...weights);
    const status: ScoreStatus = high > TARGETS.weight_max_lbs ? 'missed'
      : low < TARGETS.weight_goal_lbs ? 'done'
      : count_status(0, 1, days_done);
    rows.push({
      key: 'weight', label: 'Weight', value: weights.length === 1 ? `${low} lb` : `${low}-${high} lb`, target: weight_target, status,
      // Name the day, so an old reading does not read as today's weight
      reason: status === 'missed' ? `${day_names([week_weights.find(w => w.lbs === high)!.date])} ${high} lb was over ${TARGETS.weight_max_lbs}`
        : status === 'behind' ? `not under ${TARGETS.weight_goal_lbs} yet` : undefined,
    });
  }

  return { week_start: start, week_end: end, today, rows };
}

export interface ScorecardSummary {
  ok: number;       // rows done or on track
  judged: number;   // rows with data to judge
  behind: string[]; // rows behind, as "Label (reason)"
  missed: string[]; // rows not met, as "Label (reason)"
  level: 'good' | 'behind' | 'missed';
}

/** The one-line view: how many targets are fine, and which ones need attention and why. */
export function scorecard_summary(rows: ScoreRow[]): ScorecardSummary {
  const labels = (status: ScoreStatus) =>
    rows.filter(r => r.status === status).map(r => (r.reason ? `${r.label} (${r.reason})` : r.label));
  const behind = labels('behind');
  const missed = labels('missed');
  return {
    ok: rows.filter(r => r.status === 'done' || r.status === 'on_track').length,
    judged: rows.filter(r => r.status !== 'no_data').length,
    behind,
    missed,
    level: missed.length > 0 ? 'missed' : behind.length > 0 ? 'behind' : 'good',
  };
}
