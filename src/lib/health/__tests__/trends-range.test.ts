import { describe, expect, it } from 'vitest';
import { build_trend_series, parse_range, week_start, weekly_means } from '@/lib/health/trends-range';

// Made-up values. Epoch day 20738 is Monday 2026-10-12.
describe('trends-range', () => {
  it('only allows 90 days or a year', () => {
    expect(parse_range('365')).toBe(365);
    expect(parse_range('90')).toBe(90);
    expect(parse_range('7')).toBe(90);
    expect(parse_range(null)).toBe(90);
  });

  it('dates a week by its Monday', () => {
    expect(week_start('2026-10-12')).toBe('2026-10-12');
    expect(week_start('2026-10-18')).toBe('2026-10-12'); // Sunday
    expect(week_start('2026-10-19')).toBe('2026-10-19');
  });

  it('averages each week for the year view', () => {
    expect(weekly_means([
      { dateStr: '2026-10-12', value: 190 },
      { dateStr: '2026-10-14', value: 192 },
      { dateStr: '2026-10-20', value: 189.5 },
    ])).toEqual([{ dateStr: '2026-10-12', value: 191 }, { dateStr: '2026-10-19', value: 189.5 }]);
  });

  it('builds a series per metric, skipping days with no reading', () => {
    const rows = [
      { date: 20738, hrv_rmssd: 50, weight_lbs: 197 },
      { date: 20739, hrv_rmssd: null, weight_lbs: 192 },
      { date: 20740, hrv_rmssd: 60, weight_lbs: null },
    ];
    const series = build_trend_series(rows, 90);
    const hrv = series.find(s => s.slug === 'hrv')!;
    expect(hrv.points).toEqual([{ dateStr: '2026-10-12', value: 50 }, { dateStr: '2026-10-14', value: 60 }]);
    expect(hrv.average).toBe(55);
    const weight = series.find(s => s.slug === 'weight')!;
    expect(weight).toMatchObject({ start: 194.5, end: 194.5, average: 194.5 });
    expect(build_trend_series(rows, 365).find(s => s.slug === 'weight')!.points).toEqual([{ dateStr: '2026-10-12', value: 194.5 }]);
    expect(series.find(s => s.slug === 'resilience')).toBeUndefined(); // not charted
  });
});
