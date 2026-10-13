import { describe, expect, it } from 'vitest';
import { build_daily_brief, is_lift_assisted, last_night_from_oura, must_mention, type BriefInput, type LastNight } from '@/lib/health/daily-brief';
import { weekly_scorecard } from '@/lib/health/scorecard';
import type { StoredCorosActivity } from '@/lib/coros/data';

// Made-up values. Tuesday 2026-10-13; yesterday is Monday 2026-10-12.
const TODAY = '2026-10-13';
const YESTERDAY = '2026-10-12';

const NIGHT: LastNight = {
  sleep_min: 505, deep_min: 30, rem_min: 169, efficiency_pct: 88,
  hrv: 94, resting_hr: 41, spo2: 96, readiness: 82,
  resilience: 'High recovery, low stress', status: 'Ready, moderate effort',
};

const activity = (extra: Partial<StoredCorosActivity>): StoredCorosActivity => ({
  label_id: 'x', sport_type: 204, sport_name: 'Mountain Bike', date: YESTERDAY, start_ts: 1, end_ts: null,
  duration_s: 4500, distance_m: 24460, sets: null, avg_hr: 116, calories: null, avg_speed_kmh: null, location: null,
  ascent_m: null, descent_m: null, aerobic_te: null, anaerobic_te: null, training_focus: null,
  exercises: null, working_sets: null, loaded_sets: null, ...extra,
});

function brief(extra: Partial<BriefInput> = {}) {
  const scorecard = weekly_scorecard({
    today: TODAY, activities: [], sleep: [], vitals: [],
    weights: [{ date: YESTERDAY, lbs: 197.1 }],
  });
  return build_daily_brief({
    today: TODAY, last_night: NIGHT, yesterday: [], scorecard,
    weight: { today: null, last_7: [] }, back: { today: null, notes: null, last_7: [] },
    bowel: null, notes: null, ...extra,
  });
}

describe('build_daily_brief: dates (past bug: wrong weekday, wrong night)', () => {
  it('states the date, the weekday and which night last night was', () => {
    const text = brief();
    expect(text).toContain('Today: Tuesday, October 13, 2026 (Mountain Time)');
    expect(text).toContain('Last night: Monday night into Tuesday morning');
    expect(text).toContain('YESTERDAY (Monday, October 12, 2026, from COROS)');
  });

  it('gets the weekday right across a year end', () => {
    const scorecard = weekly_scorecard({ today: '2027-01-01', activities: [], sleep: [], vitals: [], weights: [] });
    const text = build_daily_brief({
      today: '2027-01-01', last_night: NIGHT, yesterday: [], scorecard,
      weight: { today: null, last_7: [] }, back: { today: null, notes: null, last_7: [] }, bowel: null, notes: null,
    });
    expect(text).toContain('Today: Friday, January 1, 2027');
    expect(text).toContain('Last night: Thursday night into Friday morning');
  });
});

describe('build_daily_brief: recovery', () => {
  it('lists last night with the 90-day context from the scorecard', () => {
    const text = brief();
    expect(text).toContain('Sleep 8h 25m: deep 30m, REM 2h 49m, efficiency 88%');
    expect(text).toContain('HRV 94 ms last night. Fewer than 3 nights in the last 7 days');
    expect(text).toContain('Resting HR 41 bpm last night. Fewer than 3 nights in the last 7 days');
    expect(text).toContain('SpO2 96%. Readiness 82. Stress vs recovery: High recovery, low stress');
    expect(text).toContain('Status: Ready, moderate effort');
  });

  it('says last night is not uploaded yet instead of showing an older night', () => {
    const text = brief({ last_night: null });
    expect(text).toContain('Not uploaded yet');
    expect(text).toContain('missing data, not a night without sleep');
    expect(text).not.toMatch(/^Sleep \d/m);
  });
});

describe('last_night_from_oura (past bug: a nap read as the night)', () => {
  it('takes the longest long_sleep period, not the first period', () => {
    const night = last_night_from_oura({
      sleep_periods: [
        { type: 'late_nap', total_sleep_duration: 1200 },
        { type: 'long_sleep', total_sleep_duration: 30300, deep_sleep_duration: 1800, rem_sleep_duration: 10140, efficiency: 88 },
      ],
      hrv: 94, resting_hr: 41, spo2: 96, readiness: 82,
    });
    expect(night).toMatchObject({ sleep_min: 505, deep_min: 30, rem_min: 169, efficiency_pct: 88, hrv: 94 });
  });

  it('is null when nothing from last night has been uploaded', () => {
    expect(last_night_from_oura({ sleep_periods: [], hrv: null, resting_hr: null, spo2: null, readiness: null })).toBeNull();
  });
});

describe('build_daily_brief: training (past bug: descent read as climbing)', () => {
  it('lists climbing and descent separately', () => {
    const text = brief({ yesterday: [activity({ ascent_m: 384, descent_m: 381, training_focus: 'Base' })] });
    expect(text).toContain('- Mountain Bike: 1h 15m, 15.2 mi, climbed 1,260 ft, descended 1,250 ft, avg HR 116, focus Base');
    expect(text).not.toContain('lift-assisted');
  });

  it('marks a bike park day where lifts did the climbing', () => {
    expect(is_lift_assisted({ ascent_m: 300, descent_m: 1500 })).toBe(true);
    expect(is_lift_assisted({ ascent_m: 1539, descent_m: 1534 })).toBe(false);
    expect(is_lift_assisted({ ascent_m: 50, descent_m: 200 })).toBe(false); // too small to matter
    const text = brief({ yesterday: [activity({ ascent_m: 300, descent_m: 1500 })] });
    expect(text).toContain('Likely lift-assisted bike park day: count the descending, not the climbing');
  });

  it('names custom-sport rides, strength sessions and interval sessions', () => {
    const text = brief({
      yesterday: [
        activity({ sport_type: 9806, sport_name: 'Sport(9806)', location: 'Test E MTB' }),
        activity({ sport_type: 402, sport_name: 'Strength', duration_s: 960, distance_m: null, avg_hr: 66, working_sets: 17, loaded_sets: 0, exercises: ['Bird Dog', 'Cat Cow'] }),
        activity({ anaerobic_te: 3.4, training_focus: 'VO2 Max' }),
      ],
    });
    expect(text).toContain('- Test E MTB (custom sport): 1h 15m, 15.2 mi, avg HR 116');
    expect(text).toContain('- Strength (mobility): 16m, avg HR 66, Bird Dog, Cat Cow');
    expect(text).toContain('Counts as an interval session');
  });

  it('says when there is nothing, and when COROS could not refresh', () => {
    expect(brief()).toContain('No activities in COROS for yesterday.');
    expect(brief({ coros_problem: 'COROS is not connected' })).toContain('COROS refresh problem (COROS is not connected); training data may be out of date.');
  });
});

describe('build_daily_brief: this week and body', () => {
  it('includes the scorecard summary with reasons, and every row', () => {
    const text = brief();
    expect(text).toContain('THIS WEEK (Monday, October 12, 2026 to Sunday, October 18, 2026; day 2 of 7)');
    expect(text).toMatch(/^Not met: .*Weight \(Mon 197\.1 lb was over 195\)$/m);
    expect(text).toMatch(/^- Heavy strength: 0 of 3 \(target 3 a week\): /m);
  });

  it('gives today\'s weight with the 7-day average, or the last reading', () => {
    expect(brief({ weight: { today: 196.2, last_7: [{ date: YESTERDAY, lbs: 197.2 }, { date: TODAY, lbs: 196.2 }] } }))
      .toContain('Weight 196.2 lb today. 7-day avg 196.7 lb over 2 readings');
    expect(brief({ weight: { today: null, last_7: [{ date: YESTERDAY, lbs: 197.1 }] } }))
      .toContain('No COROS weight today; last 197.1 lb on Monday, October 12, 2026');
  });

  it('lists back pain by day so a "spikes this week" claim can be checked', () => {
    const text = brief({ back: { today: 3, notes: 'stiff', last_7: [{ date: YESTERDAY, scale: 9 }, { date: '2026-10-10', scale: 2 }] } });
    expect(text).toContain('Back 3/10 today (stiff). Last 7 days: Sat 2, Mon 9');
  });
});

describe('must_mention: weekly to-dos the coach has to name', () => {
  // Week of Monday 2026-10-12
  const card = (today: string, extra: Partial<Parameters<typeof weekly_scorecard>[0]> = {}) =>
    weekly_scorecard({ today, activities: [], sleep: [], vitals: [], weights: [], ...extra });

  it('waits until Wednesday', () => {
    expect(must_mention(card('2026-10-13'), '2026-10-13')).toEqual([]); // Tuesday: heavy is already behind
    expect(must_mention(card('2026-10-14'), '2026-10-14').map(r => r.key)).toContain('heavy');
  });

  it('names actions only: not missed ride or yoga days, not HRV or resting HR', () => {
    const thursday = '2026-10-15';
    const vitals = [
      ...Array.from({ length: 90 }, (_, i) => ({ date: `2026-${i < 60 ? '08' : '07'}-${String((i % 28) + 1).padStart(2, '0')}`, hrv: i % 2 ? 40 : 50, resting_hr: 50 })),
    ];
    const keys = must_mention(card(thursday, {
      vitals,
      sleep: [{ date: '2026-10-12', total_min: 400 }],
      weights: [{ date: '2026-10-12', lbs: 197.1 }],
    }), thursday).map(r => r.key);
    expect(keys).toEqual(['ride_time', 'heavy', 'intervals', 'sleep', 'weight']);
    expect(keys).not.toContain('ride_days');
    expect(keys).not.toContain('mobility');
  });

  it('drops an item once it is done', () => {
    const thursday = '2026-10-15';
    const heavy = (date: string) => ({ date, sport_type: 402, duration_s: 2700, working_sets: 8, loaded_sets: 6, anaerobic_te: null, training_focus: null });
    const keys = must_mention(card(thursday, { activities: [heavy('2026-10-12'), heavy('2026-10-13'), heavy('2026-10-14')] }), thursday).map(r => r.key);
    expect(keys).not.toContain('heavy');
  });

  it('puts the list in the brief from Wednesday, with the reasons', () => {
    const scorecard = card('2026-10-15', { weights: [{ date: '2026-10-12', lbs: 197.1 }] });
    const text = build_daily_brief({
      today: '2026-10-15', last_night: NIGHT, yesterday: [], scorecard,
      weight: { today: null, last_7: [] }, back: { today: null, notes: null, last_7: [] }, bowel: null, notes: null,
    });
    expect(text).toContain('MUST MENTION (weekly to-dos from his framework, not done yet; name each one in your first reply)');
    expect(text).toContain('- Intervals: 0 of 1; still to do this week'); // on pace until Friday, named anyway
    expect(text).toContain('- Heavy strength: 0 of 3; pace is 1 by now');
    expect(text).toContain('- Weight (not met): 197.1 lb; Mon 197.1 lb was over 195');
    expect(brief()).not.toContain('MUST MENTION'); // Tuesday
  });
});
