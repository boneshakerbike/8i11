/**
 * Oura derivations shared by the coach, the Oura pages, sync and daily_metrics.
 * Pure functions, safe to import from client components.
 */

interface SleepPeriodLike {
  type?: unknown;
  total_sleep_duration?: unknown;
}

const duration_of = (p: SleepPeriodLike): number => {
  const n = Number(p.total_sleep_duration);
  return isFinite(n) ? n : 0;
};

const longest = <T extends SleepPeriodLike>(periods: T[]): T =>
  periods.reduce((best, p) => (duration_of(p) > duration_of(best) ? p : best));

/**
 * The night's main sleep period. Oura returns naps and short rests as separate
 * periods and can split one night into several long_sleep periods. Taking the
 * first period read a nap as the night (#186), so pick the longest long_sleep,
 * else the longest period of any type.
 */
export function primary_sleep<T extends SleepPeriodLike>(periods: readonly T[] | null | undefined): T | null {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const long_sleeps = periods.filter(p => p.type === 'long_sleep');
  return longest(long_sleeps.length > 0 ? long_sleeps : [...periods]);
}

/**
 * Estimated cardiovascular age from HRV (rmssd, ms) and resting HR (bpm),
 * Umetani regression. Oura's API returns null for CV age, so every CV age in
 * this app is this estimate, not a measurement. The SQL backfill in
 * src/lib/db.ts uses the same formula.
 */
export function estimate_cv_age(hrv: number | null | undefined, resting_hr: number | null | undefined): number | null {
  // hrv must be > 0: Math.log(0) is -Infinity, which poisons a database insert
  if (hrv == null || !(hrv > 0) || resting_hr == null || !(resting_hr > 0) || !isFinite(resting_hr)) return null;
  const hrv_age = 107 - 12.5 * Math.log(hrv);
  const rhr_age = 1.4 * resting_hr - 40;
  const estimated = Math.round(0.65 * hrv_age + 0.35 * rhr_age);
  return isFinite(estimated) ? estimated : null;
}
