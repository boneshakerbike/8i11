import { describe, expect, it } from 'vitest';
import {
  clock_seconds, duration_text_min, iso_date, parse_daily_health, parse_fitness, parse_recovery,
  parse_resting_hr, parse_sleep_hrv, parse_sport_records, parse_training_load, tool_text,
} from '@/lib/coros/parse';
import * as F from './fixtures';

describe('tool_text', () => {
  it('unwraps the JSON string literal COROS returns', () => {
    const result = { content: [{ type: 'text' as const, text: JSON.stringify(F.RECOVERY) }] };
    expect(tool_text(result)).toBe(F.RECOVERY);
  });

  it('passes plain text through and handles empty results', () => {
    expect(tool_text({ content: [{ type: 'text', text: 'plain' }] })).toBe('plain');
    expect(tool_text({ content: [] })).toBe('');
    expect(tool_text(null)).toBe('');
  });
});

describe('small helpers', () => {
  it('reads COROS durations', () => {
    expect(duration_text_min('2h 50min')).toBe(170);
    expect(duration_text_min('36 min')).toBe(36);
    expect(duration_text_min('1h')).toBe(60);
    expect(duration_text_min('soon')).toBeNull();
    expect(clock_seconds('16:27')).toBe(987);
    expect(clock_seconds('1:33:09')).toBe(5589);
    expect(clock_seconds('x')).toBeNull();
    expect(iso_date('20261006')).toBe('2026-10-06');
  });
});

describe('parse_daily_health', () => {
  const days = parse_daily_health(F.DAILY_HEALTH);

  it('reads one record per day', () => {
    expect(days.map(d => d.date)).toEqual(['2026-01-01', '2026-01-02']);
  });

  it('reads steps, exercise and stress', () => {
    expect(days[0]).toMatchObject({ steps: 12345, exercise_min: 125, stress_avg: 40, sleep_total_min: null });
  });

  it('reads the sleep summary filed under the wake-up day', () => {
    expect(days[1]).toMatchObject({
      sleep_total_min: 450, sleep_deep_min: 70, sleep_light_min: 260, sleep_rem_min: 90, sleep_awake_min: 30, sleep_hr_avg: 46,
    });
  });
});

describe('parse_sleep_hrv', () => {
  const rows = parse_sleep_hrv(F.SLEEP_HRV);

  it('reads the assessment and ignores the raw time series', () => {
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ date: '2026-01-03', hrv_avg: 75, status: 'Above normal', range_low: 60, range_high: 72, baseline: 66 });
  });

  it('keeps a no-data day as nulls', () => {
    expect(rows[2]).toMatchObject({ date: '2026-01-01', hrv_avg: null, status: null });
  });
});

describe('parse_resting_hr', () => {
  it('reads values and no-data days', () => {
    expect(parse_resting_hr(F.RESTING_HR)).toEqual([
      { date: '2026-01-03', resting_hr: 44 },
      { date: '2026-01-02', resting_hr: 47 },
      { date: '2026-01-01', resting_hr: null },
    ]);
  });
});

describe('parse_recovery and parse_fitness', () => {
  it('reads the current recovery state', () => {
    expect(parse_recovery(F.RECOVERY)).toEqual({ recovery_pct: 82, level: 'Moderate training allowed', full_recovery_hours: 20 });
  });

  it('reads VO2max', () => {
    expect(parse_fitness(F.FITNESS)).toEqual({ vo2max: 50 });
  });

  it('returns null when the text has no value', () => {
    expect(parse_recovery('Recovery Status\n(no data)')).toBeNull();
    expect(parse_fitness('nothing')).toBeNull();
  });
});

describe('parse_training_load', () => {
  it('reads one record per day', () => {
    expect(parse_training_load(F.TRAINING_LOAD)).toEqual([
      { date: '2026-01-03', comment: 'Maintaining', short_term: 120, long_term: 125, ratio: 0.96 },
      { date: '2026-01-02', comment: 'Optimized', short_term: 140, long_term: 124, ratio: 1.13 },
    ]);
  });
});

describe('parse_sport_records', () => {
  const acts = parse_sport_records(F.SPORT_RECORDS);

  it('reads every activity', () => {
    expect(acts.map(a => a.sport_type)).toEqual([402, 204, 900, 9806]);
  });

  it('reads a strength session split across lines', () => {
    expect(acts[0]).toMatchObject({
      label_id: '100000000000000001', sport_name: 'Strength', date: '2026-01-03',
      duration_s: 1200, sets: 12, avg_hr: 70, calories: 200, distance_m: null,
    });
  });

  it('reads a ride in km and does not keep coordinates', () => {
    expect(acts[1]).toMatchObject({
      sport_name: 'Mountain Bike', duration_s: 10000, distance_m: 30500, avg_speed_kmh: 11, calories: 1500,
      start_ts: 1767340000, end_ts: 1767350000, location: 'Test County Mountain Bike',
    });
    expect(JSON.stringify(acts[1])).not.toMatch(/Coordinates|0\.000000/);
  });

  it('reads a distance in meters and a custom sport type', () => {
    expect(acts[2].distance_m).toBe(900);
    expect(acts[3]).toMatchObject({ sport_name: 'Sport(9806)', sport_type: 9806, distance_m: 35000 });
  });

  it('returns nothing for text without records', () => {
    expect(parse_sport_records('Sport Records (0 records)')).toEqual([]);
  });
});

describe('COROS "no value" placeholder', () => {
  it('reads 65535 in any scale as missing', () => {
    const text = F.SPORT_RECORDS.replace('Avg HR: 120 bpm', 'Avg HR: 65535 bpm').replace('Calories: 1,500 kcal', 'Calories: 655.35 kcal');
    const ride = parse_sport_records(text)[1];
    expect(ride.avg_hr).toBeNull();
    expect(ride.calories).toBeNull();
    expect(parse_fitness('VO2max: 6553.5')).toBeNull();
  });
});

describe('parse_activity_detail', () => {
  it('reads elevation gain and loss separately', async () => {
    const { parse_activity_detail } = await import('@/lib/coros/parse');
    expect(parse_activity_detail(F.ACTIVITY_DETAIL)).toEqual({ ascent_m: 1200, descent_m: 1250 });
  });

  it('converts feet and treats the placeholder as missing', async () => {
    const { parse_activity_detail } = await import('@/lib/coros/parse');
    expect(parse_activity_detail('Elevation Gain / Loss: 3281 ft / 655.35 ft')).toEqual({ ascent_m: 1000, descent_m: null });
  });

  it('returns null without an elevation line', async () => {
    const { parse_activity_detail } = await import('@/lib/coros/parse');
    expect(parse_activity_detail('Strength Activity Details\nSets: 12')).toBeNull();
  });
});
