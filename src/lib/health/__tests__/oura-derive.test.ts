import { describe, expect, it } from 'vitest';
import { estimate_cv_age, primary_sleep } from '@/lib/health/oura-derive';

describe('primary_sleep', () => {
  it('returns null for missing or empty input', () => {
    expect(primary_sleep(null)).toBeNull();
    expect(primary_sleep(undefined)).toBeNull();
    expect(primary_sleep([])).toBeNull();
  });

  it('ignores a nap listed before the night (#186)', () => {
    const nap = { type: 'late_nap', total_sleep_duration: 2400 };
    const night = { type: 'long_sleep', total_sleep_duration: 25200 };
    expect(primary_sleep([nap, night])).toBe(night);
  });

  it('picks the longest long_sleep when a night is split', () => {
    const first = { type: 'long_sleep', total_sleep_duration: 7200 };
    const second = { type: 'long_sleep', total_sleep_duration: 18000 };
    expect(primary_sleep([first, second])).toBe(second);
  });

  it('falls back to the longest period when no long_sleep exists', () => {
    const short = { type: 'rest', total_sleep_duration: 600 };
    const sleep = { type: 'sleep', total_sleep_duration: 14400 };
    expect(primary_sleep([short, sleep])).toBe(sleep);
  });

  it('treats a missing duration as zero', () => {
    const blank = { type: 'long_sleep' };
    const real = { type: 'long_sleep', total_sleep_duration: 21600 };
    expect(primary_sleep([blank, real])).toBe(real);
  });
});

describe('estimate_cv_age', () => {
  it('matches the Umetani regression', () => {
    // 0.65 * (107 - 12.5 * ln 50) + 0.35 * (1.4 * 55 - 40) = 50.72
    expect(estimate_cv_age(50, 55)).toBe(51);
  });

  it('returns null when HRV is zero, negative or missing', () => {
    expect(estimate_cv_age(0, 55)).toBeNull();
    expect(estimate_cv_age(-5, 55)).toBeNull();
    expect(estimate_cv_age(null, 55)).toBeNull();
  });

  it('returns null when resting HR is missing or not finite', () => {
    expect(estimate_cv_age(50, null)).toBeNull();
    expect(estimate_cv_age(50, undefined)).toBeNull();
    expect(estimate_cv_age(50, NaN)).toBeNull();
    expect(estimate_cv_age(50, 0)).toBeNull();
  });
});
