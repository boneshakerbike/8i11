import { describe, expect, it } from 'vitest';
import { fill_gaps, scorecard_summary, summary_text, weekly_scorecard, week_start, type ScorecardActivity, type ScorecardInput, type ScoreRow } from '@/lib/health/scorecard';
import { shift_date } from '@/lib/coaching/day';

// Week of Monday 2026-10-12 to Sunday 2026-10-18. Made-up values.
const MON = '2026-10-12';
const day = (n: number) => shift_date(MON, -n); // 0 = Monday ... 6 = Sunday

const act = (date: string, sport_type: number, minutes: number, extra: Partial<ScorecardActivity> = {}): ScorecardActivity => ({
  date, sport_type, duration_s: minutes * 60, working_sets: null, loaded_sets: null, anaerobic_te: null, training_focus: null, ...extra,
});
const mobility = (date: string) => act(date, 402, 30, { working_sets: 17, loaded_sets: 0 });
const heavy = (date: string) => act(date, 402, 45, { working_sets: 8, loaded_sets: 6 });

function card(today: string, input: Partial<Omit<ScorecardInput, 'today'>> = {}) {
  return weekly_scorecard({ today, activities: [], sleep: [], weights: [], vitals: [], ...input });
}
const row = (rows: ScoreRow[], key: ScoreRow['key']) => rows.find(r => r.key === key)!;

describe('week_start', () => {
  it('is the Monday of the week, Monday to Sunday', () => {
    expect(week_start(day(0))).toBe(MON);
    expect(week_start(day(3))).toBe(MON);
    expect(week_start(day(6))).toBe(MON);
    expect(week_start(shift_date(MON, -7))).toBe(shift_date(MON, -7));
  });
});

describe('weekly_scorecard: training', () => {
  const thursday = day(3);
  const activities = [
    act(day(0), 204, 90),          // mountain bike
    act(day(1), 9806, 60),         // custom e-MTB counts as a ride
    act(day(3), 203, 120),         // gravel
    act(day(2), 900, 40),          // a walk is not a ride
    act(shift_date(MON, 1), 204, 300), // last Sunday: not this week
    mobility(day(0)), mobility(day(1)), mobility(day(2)),
    heavy(day(2)),
    act(day(1), 402, 20),          // strength session not classified yet
  ];

  it('adds ride time from rides this week only', () => {
    const r = row(card(thursday, { activities }).rows, 'ride_time');
    expect(r).toMatchObject({ value: '4h 30m', target: '7h 00m', status: 'on_track' });
  });

  it('rounds ride time to whole minutes', () => {
    const r = row(card(thursday, { activities: [act(day(0), 204, 0, { duration_s: 479.7 * 60 })] }).rows, 'ride_time');
    expect(r.value).toBe('8h 00m');
  });

  it('is behind on ride time when under 1 hour per finished day', () => {
    const r = row(card(thursday, { activities: [act(day(0), 204, 60)] }).rows, 'ride_time');
    expect(r.status).toBe('behind');
  });

  it('marks ride days missed once a finished day had no ride', () => {
    const r = row(card(thursday, { activities }).rows, 'ride_days');
    expect(r).toMatchObject({ value: '3 of 4', status: 'missed' });
  });

  it('does not count today against a daily target before it is over', () => {
    const rides = [act(day(0), 204, 60), act(day(1), 204, 60), act(day(2), 204, 60)];
    expect(row(card(thursday, { activities: rides }).rows, 'ride_days')).toMatchObject({ value: '3 of 4', status: 'on_track' });
  });

  it('calls a full week of ride days done', () => {
    const rides = [0, 1, 2, 3, 4, 5, 6].map(n => act(day(n), 204, 60));
    expect(row(card(day(6), { activities: rides }).rows, 'ride_days')).toMatchObject({ value: '7 of 7', status: 'done' });
  });

  it('counts mobility on work days, not heavy sessions', () => {
    const r = row(card(thursday, { activities }).rows, 'mobility');
    expect(r).toMatchObject({ value: '3 of 4 work days', status: 'on_track' });
    const weekend = row(card(day(5), { activities: [0, 1, 2, 3, 4].map(n => mobility(day(n))) }).rows, 'mobility');
    expect(weekend).toMatchObject({ value: '5 of 5 work days', status: 'done' });
  });

  it('counts heavy strength and says when sessions are not classified yet', () => {
    const r = row(card(thursday, { activities }).rows, 'heavy');
    expect(r).toMatchObject({ value: '1 of 3', status: 'on_track', note: '1 strength session not classified yet' });
  });

  it('is behind on heavy strength under pace, and missed when too few days are left', () => {
    expect(row(card(thursday).rows, 'heavy').status).toBe('behind');
    // Saturday: 1 done leaves 2 for 2 days, still possible; none done is not
    expect(row(card(day(5), { activities: [heavy(day(0))] }).rows, 'heavy').status).toBe('behind');
    expect(row(card(day(5)).rows, 'heavy').status).toBe('missed');
    expect(row(card(day(0)).rows, 'heavy').status).toBe('to_do');
  });

  it('counts an interval session from COROS intensity, behind from Friday without one', () => {
    expect(row(card(thursday).rows, 'intervals')).toMatchObject({ value: '0 of 1', status: 'to_do' });
    expect(row(card(day(4)).rows, 'intervals').status).toBe('behind');
    const ride = act(day(1), 204, 75, { anaerobic_te: 3.4, training_focus: 'VO2 Max' });
    expect(row(card(day(4), { activities: [ride] }).rows, 'intervals')).toMatchObject({ value: '1 of 1', status: 'done' });
  });

  it('says "to do", not "on track", when nothing is logged and nothing is due yet (Bill, 2026-10-19)', () => {
    const monday = card(day(0)).rows;
    for (const key of ['ride_time', 'ride_days', 'mobility', 'heavy', 'intervals', 'weight'] as const) {
      expect(row(monday, key).status, key).toBe('to_do');
    }
    // Once something is logged, the same pace is on track
    const started = card(day(1), { activities: [act(day(0), 204, 90), mobility(day(0))] }).rows;
    expect(row(started, 'ride_days')).toMatchObject({ value: '1 of 2', status: 'on_track' });
    expect(row(started, 'mobility').status).toBe('on_track');
    // Falling behind pace still says behind
    expect(row(card(day(1)).rows, 'ride_time').status).toBe('behind');
  });
});

describe('weekly_scorecard: sleep and weight', () => {
  it('averages this week\'s nights and flags nights under 7 hours', () => {
    const sleep = [{ date: day(0), total_min: 480 }, { date: day(1), total_min: 400 }, { date: day(2), total_min: 500 }];
    expect(row(card(day(2), { sleep }).rows, 'sleep')).toMatchObject({
      value: '7h 40m avg over 3 nights', status: 'behind', note: '1 night under 7h',
    });
    const good = [{ date: day(0), total_min: 490 }, { date: day(1), total_min: 470 }];
    expect(row(card(day(1), { sleep: good }).rows, 'sleep')).toMatchObject({ value: '8h 00m avg over 2 nights', status: 'on_track' });
  });

  it('reports no sleep data instead of guessing', () => {
    expect(row(card(day(2)).rows, 'sleep')).toMatchObject({ status: 'no_data', note: 'No nights synced yet this week' });
  });

  it('is done after one reading under 190, and not met only while the latest reading is over 195', () => {
    expect(row(card(day(3), { weights: [{ date: day(0), lbs: 191 }, { date: day(2), lbs: 189.5 }] }).rows, 'weight'))
      .toMatchObject({ value: '189.5 lb', status: 'done' });
    expect(row(card(day(3), { weights: [{ date: day(0), lbs: 189 }, { date: day(1), lbs: 196 }] }).rows, 'weight'))
      .toMatchObject({ status: 'missed', reason: '196 lb Tue is over 195', note: 'Last weigh-in Tue' });
    // Over 195 with no reading under 190 names both
    expect(row(card(day(3), { weights: [{ date: day(0), lbs: 192 }, { date: day(3), lbs: 196 }] }).rows, 'weight'))
      .toMatchObject({ status: 'missed', reason: '196 lb today is over 195; not under 190 yet this week', note: undefined });
  });

  it('forgets an earlier spike once the latest reading is back under 195', () => {
    // Bill's week of 2026-10-12: 197.1 Monday, 192.2 Tuesday
    const weights = [{ date: day(0), lbs: 197.1 }, { date: day(1), lbs: 192.2 }];
    expect(row(card(day(1), { weights }).rows, 'weight'))
      .toMatchObject({ value: '192.2 lb', status: 'to_do', reason: 'not under 190 yet this week' });
    expect(row(card(day(2), { weights: [...weights, { date: day(2), lbs: 189.8 }] }).rows, 'weight'))
      .toMatchObject({ value: '189.8 lb', status: 'done', reason: undefined });
    // A later reading over 195 counts again, even after one under 190
    expect(row(card(day(3), { weights: [{ date: day(0), lbs: 189 }, { date: day(3), lbs: 195.4 }] }).rows, 'weight'))
      .toMatchObject({ value: '195.4 lb (week low 189)', status: 'missed', reason: '195.4 lb today is over 195' });
  });

  it('gives the week until Friday to get under 190', () => {
    const weights = [{ date: day(0), lbs: 192 }];
    expect(row(card(day(3), { weights }).rows, 'weight').status).toBe('to_do');
    expect(row(card(day(4), { weights }).rows, 'weight').status).toBe('behind');
    // No weigh-in at all is still no reading under 190
    expect(row(card(day(3)).rows, 'weight')).toMatchObject({ status: 'to_do', value: '-', note: 'No COROS weight this week' });
    expect(row(card(day(4)).rows, 'weight')).toMatchObject({ status: 'behind', reason: 'not under 190 yet this week' });
  });
});

describe('weekly_scorecard: HRV and resting HR against the 90-day normal', () => {
  const today = day(3);
  // 90 baseline days before the last 7: HRV alternates 40/50 (mean 45), resting HR 48/52 (mean 50)
  const baseline = Array.from({ length: 90 }, (_, i) => ({
    date: shift_date(today, 7 + i), hrv: i % 2 ? 40 : 50, resting_hr: i % 2 ? 48 : 52,
  }));
  const recent = (hrv: number, resting_hr: number) =>
    Array.from({ length: 7 }, (_, i) => ({ date: shift_date(today, i), hrv, resting_hr }));

  it('is on track inside the normal band', () => {
    const rows = card(today, { vitals: [...baseline, ...recent(46, 50)] }).rows;
    expect(row(rows, 'hrv')).toMatchObject({ value: '46 ms (7-day avg)', status: 'on_track', note: 'Normal 42-48 ms; now normal' });
    expect(row(rows, 'resting_hr')).toMatchObject({ status: 'on_track', note: 'Normal 49-51 bpm; now normal' });
  });

  it('is behind when HRV drops below normal or resting HR rises above it', () => {
    const rows = card(today, { vitals: [...baseline, ...recent(38, 54)] }).rows;
    expect(row(rows, 'hrv')).toMatchObject({ status: 'behind', note: 'Normal 42-48 ms; now below normal' });
    expect(row(rows, 'resting_hr')).toMatchObject({ status: 'behind', note: 'Normal 49-51 bpm; now above normal' });
  });

  it('counts the good direction as on track', () => {
    const rows = card(today, { vitals: [...baseline, ...recent(55, 46)] }).rows;
    expect(row(rows, 'hrv')).toMatchObject({ status: 'on_track', note: 'Normal 42-48 ms; now above normal' });
    expect(row(rows, 'resting_hr')).toMatchObject({ status: 'on_track', note: 'Normal 49-51 bpm; now below normal' });
  });

  it('shows a single number when the normal range rounds to one value', () => {
    const steady = baseline.map(b => ({ ...b, resting_hr: 50 }));
    expect(row(card(today, { vitals: [...steady, ...recent(46, 50)] }).rows, 'resting_hr').note).toBe('Normal 50 bpm; now normal');
  });

  it('waits for enough history before judging', () => {
    const rows = card(today, { vitals: [...baseline.slice(0, 10), ...recent(46, 50)] }).rows;
    expect(row(rows, 'hrv')).toMatchObject({ status: 'no_data', note: 'Building your normal: 10 of 28 days so far' });
    expect(row(card(today, { vitals: baseline }).rows, 'hrv')).toMatchObject({ status: 'no_data', note: 'Fewer than 3 nights in the last 7 days' });
  });
});

describe('fill_gaps', () => {
  it('keeps cache values and fills missing days and values from coach history', () => {
    const cache = [
      { date: '2026-10-10', hrv: 44, resting_hr: null },
      { date: '2026-10-12', hrv: 47, resting_hr: 50 },
    ];
    const history = [
      { date: '2026-10-09', hrv: 41, resting_hr: 52 },
      { date: '2026-10-10', hrv: 99, resting_hr: 51 },
      { date: '2026-10-12', hrv: 99, resting_hr: 99 },
    ];
    expect(fill_gaps(cache, history)).toEqual([
      { date: '2026-10-09', hrv: 41, resting_hr: 52 }, // only in history
      { date: '2026-10-10', hrv: 44, resting_hr: 51 }, // cache wins, gap filled
      { date: '2026-10-12', hrv: 47, resting_hr: 50 }, // cache wins
    ]);
  });

  it('gives a 90-day normal from coach history alone', () => {
    const today = day(3);
    const history = Array.from({ length: 40 }, (_, i) => ({ date: shift_date(today, i), hrv: i % 2 ? 40 : 50, resting_hr: 50 }));
    const rows = card(today, { vitals: fill_gaps([], history) }).rows;
    expect(row(rows, 'hrv').status).toBe('on_track');
    expect(row(rows, 'hrv').note).toMatch(/^Normal \d+-\d+ ms; now normal$/);
  });
});

describe('scorecard_summary', () => {
  const r = (label: string, status: ScoreRow['status']): ScoreRow => ({ key: 'sleep', label, value: '', target: '', status });

  it('counts done and on track as fine, and leaves rows without data out', () => {
    const rows = [r('Ride time', 'on_track'), r('Ride days', 'done'), r('Sleep', 'no_data')];
    expect(scorecard_summary(rows)).toEqual({ ok: 2, judged: 2, to_do: 0, behind: [], missed: [], level: 'good' });
  });

  it('names what needs attention, missed first in level', () => {
    const rows = [r('Ride time', 'on_track'), r('Heavy strength', 'behind'), r('Weight', 'missed')];
    expect(scorecard_summary(rows)).toEqual({ ok: 1, judged: 3, to_do: 0, behind: ['Heavy strength'], missed: ['Weight'], level: 'missed' });
    expect(scorecard_summary(rows.slice(0, 2)).level).toBe('behind');
  });

  it('keeps to-do rows out of "on track" in the header', () => {
    const rows = [r('HRV', 'on_track'), r('Resting HR', 'on_track'), r('Ride time', 'to_do'), r('Heavy strength', 'to_do'), r('Sleep', 'no_data')];
    expect(scorecard_summary(rows)).toMatchObject({ ok: 2, judged: 2, to_do: 2, level: 'good' });
    expect(summary_text(scorecard_summary(rows))).toBe('2 of 2 on track, 2 to do');
    expect(summary_text(scorecard_summary(rows.slice(2, 4)))).toBe('2 to do');
    expect(summary_text(scorecard_summary(rows.slice(0, 2)))).toBe('2 of 2 on track');
  });
});

describe('reasons in the one-line summary', () => {
  it('says why weight is not met, so it does not read as a missing weight', () => {
    const rows = card(day(0), { weights: [{ date: day(0), lbs: 197.1 }] }).rows;
    expect(row(rows, 'weight')).toMatchObject({ status: 'missed', reason: '197.1 lb today is over 195; not under 190 yet this week' });
    expect(scorecard_summary(rows).missed).toEqual(['Weight (197.1 lb today is over 195; not under 190 yet this week)']);
  });

  it('names the days a daily target was skipped', () => {
    const rides = [act(day(0), 204, 60), act(day(3), 204, 60)];
    expect(row(card(day(3), { activities: rides }).rows, 'ride_days').reason).toBe('no ride Tue, Wed');
    expect(row(card(day(3), { activities: [mobility(day(0))] }).rows, 'mobility').reason).toBe('none Tue, Wed');
  });

  it('gives the pace for counts and ride time, and nothing when on track', () => {
    const rows = card(day(3)).rows;
    expect(row(rows, 'heavy').reason).toBe('pace is 1 by now');
    expect(row(rows, 'ride_time').reason).toBe('pace is 3h 00m by now');
    expect(row(rows, 'intervals').reason).toBeUndefined();
    expect(row(card(day(4)).rows, 'intervals').reason).toBe('none yet');
    expect(row(card(day(5)).rows, 'heavy').reason).toBe('too few days left for 3');
  });

  it('says which sleep rule and which direction for HRV and resting HR', () => {
    const sleep = [{ date: day(0), total_min: 480 }, { date: day(1), total_min: 400 }];
    expect(row(card(day(1), { sleep }).rows, 'sleep').reason).toBe('average under 8h, 1 night under 7h');
    const today = day(3);
    const vitals = [
      ...Array.from({ length: 90 }, (_, i) => ({ date: shift_date(today, 7 + i), hrv: i % 2 ? 40 : 50, resting_hr: i % 2 ? 48 : 52 })),
      ...Array.from({ length: 7 }, (_, i) => ({ date: shift_date(today, i), hrv: 38, resting_hr: 54 })),
    ];
    const rows = card(today, { vitals }).rows;
    expect(row(rows, 'hrv').reason).toBe('below your normal');
    expect(row(rows, 'resting_hr').reason).toBe('above your normal');
  });
});
