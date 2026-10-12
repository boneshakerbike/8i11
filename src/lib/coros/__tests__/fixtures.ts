/**
 * COROS MCP tool output in the exact format seen in the Phase 0 preview test
 * (2026-10-12), with made-up values, generic place names and no GPS
 * coordinates. Never paste real tool output here.
 */

export const DAILY_HEALTH = `Daily Health Data — Last 7 days | Resting HR: 45 bpm | HRV Baseline: 40 ms
Note: sleep entries are dated by their wake-up day.

--- 20260101 ---
Steps: 12,345 | Calories: 2,100 kcal | Exercise: 2h 5min | Floors: 120
Stress: Avg 40

--- 20260102 ---
Steps: 4,000 | Calories: 1,700 kcal | Exercise: 45 min | Floors: 3
Stress: Avg 30
Sleep Summary:
  Total: 7h 30min | Deep: 1h 10min | Light: 4h 20min | REM: 1h 30min | Awake: 30 min
  Sleep HR: Avg 46 bpm | Min 41 bpm | Max 70 bpm`;

export const SLEEP_HRV = `Sleep HRV — 2026-01-01 to 2026-01-03
========================
Note: dates are wake-up days (each value comes from the night that ended that morning).

HRV Assessment — Last 7 days
========================

2026-01-03:
  HRV Avg: 75 ms — Above normal
  Normal Range: 60 - 72 ms
  Baseline: 66 ms
2026-01-02:
  HRV Avg: 58 ms — Below normal
  Normal Range: 61 - 74 ms
  Baseline: 67 ms
2026-01-01:
  No data

Sleep HRV Time Series — Last 7 days
========================

2026-01-02:
  timestamp=1767300000, timezone=-28, hrv=55 ms, status=4, confidence=100000
2026-01-03:
  timestamp=1767386400, timezone=-28, hrv=80 ms, status=4, confidence=95000`;

export const RESTING_HR = `Resting Heart Rate — Last 7 days
========================

2026-01-03: 44 bpm
2026-01-02: 47 bpm
2026-01-01: No data`;

export const RECOVERY = `Recovery Status
========================

Recovery: 82%
Level: Moderate training allowed
Estimated Full Recovery: 20h`;

export const FITNESS = `Fitness Assessment Overview
========================

VO2max: 50
Running Level: 80
Threshold Pace: 4:30 /km`;

export const TRAINING_LOAD = `Training Load Assessment
========================

2026-01-03
Comment: Maintaining
Short-Term Load: 120
Long-Term Load: 125
Load Ratio: 0.96

2026-01-02
Comment: Optimized
Short-Term Load: 140
Long-Term Load: 124
Load Ratio: 1.13`;

export const SPORT_RECORDS = `Sport Records — 2026-01-01 to 2026-01-03 (4 records)
========================

1. Strength — 2026-01-03
   Location: Test Gym
   Time Window: startTimestamp=1767430000 | endTimestamp=1767431200
   Duration: 20:00 | Sets: 12
 | Avg HR: 70 bpm | Calories: 200 kcal
   LabelId: 100000000000000001 | SportType: 402

2. Mountain Bike — 2026-01-02
   Location: Test County Mountain Bike
   Start Coordinates: 0.000000, 0.000000
   Time Window: startTimestamp=1767340000 | endTimestamp=1767350000
   Duration: 2:46:40 | Distance: 30.50 km
   Average Speed: 11.0 km/h | Avg HR: 120 bpm | Calories: 1,500 kcal
   LabelId: 100000000000000002 | SportType: 204

3. Walk — 2026-01-02
   Location: Test Walk
   Time Window: startTimestamp=1767330000 | endTimestamp=1767331000
   Duration: 16:40 | Distance: 900 m
   Average Pace: 18:31 /km | Avg HR: 90 bpm | Calories: 120 kcal
   LabelId: 100000000000000003 | SportType: 900

4. Sport(9806) — 2026-01-01
   Location: Test E MTB
   Time Window: startTimestamp=1767250000 | endTimestamp=1767257000
   Duration: 1:56:40 | Distance: 35.00 km
   Average Pace: 3:20 /km | Avg HR: 125 bpm | Calories: 1,400 kcal
   LabelId: 100000000000000004 | SportType: 9806`;

/** getActivityDetail for a ride (labelId + sportType), same layout as the real reply. */
export const ACTIVITY_DETAIL = `🚴 Mountain Bike Activity Details
========================================

Workout Time: 3:00:00
Distance: 30.00 km
Total Time: 3:10:00
Calories: 1800 kcal
Average Speed: 10.0 km/h
Moving Average Speed: 12.0 km/h
Max Speed: 40.0 km/h
Average Heart Rate: 115 bpm
Elevation Gain / Loss: 1200 m / 1250 m
Training Load: 250
Efficiency Factor: 655.35
Variation Index: 655.35
Aerobic TE: 4.0
Anaerobic TE: 1.0
Training Focus: Base`;

/**
 * queryActivityLapData for a strength session (labelId + sportType 402). Same
 * JSON shape as the real reply: effort and rest rows (sets 0), then one
 * summary row per exercise (sets > 0), then a "Rest" summary row.
 * Row: [exercise, sets, reps, seconds, weight].
 */
type LapRow = [string, number, number, number, number];
const strength_laps = (label_id: string, rows: LapRow[]) => JSON.stringify({
  source: 'activityDetail', labelId: label_id, sportType: 402, mode: 23, subMode: 2,
  columns: [
    { name: 'lapIndex', label: '圈数' }, { name: 'exerciseNameKey', label: '动作名称' }, { name: 'sets', label: '组数' },
    { name: 'reps', label: '次数' }, { name: 'time', label: '时间' }, { name: 'totalLength', label: '累计时间' },
    { name: 'weight', label: '强度' }, { name: 'avgHr', label: '平均心率' }, { name: 'maxHr', label: '最大心率' },
    { name: 'calories', label: '卡路里' }, { name: 'bodyTemperature', label: '体温' },
  ],
  lapGroups: [{
    type: 2, lapDistance: 100000, fastLapIndexList: [],
    laps: rows.map(([exerciseNameKey, sets, reps, time, weight], i) => ({
      lapIndex: i + 1, exerciseNameKey, sets, reps, time, totalLength: time, weight,
      avgHr: 80, maxHr: 90, calories: 10000, bodyTemperature: 0,
    })),
  }],
  sportDataDetails: [],
});

/** Stretching and bodyweight work, no added weight (like a yoga or rehab session). */
export const STRENGTH_LAPS_MOBILITY = strength_laps('100000000000000001', [
  ['Hamstring Stretch', 0, 3, 60, 0],
  ['Hamstring Stretch', 0, 0, 10, 0],
  ['Hamstring Stretch', 0, 3, 60, 0],
  ['Hamstring Stretch', 0, 0, 10, 0],
  ['Hamstring Stretch', 2, 6, 120, 0],
  ['Rest', 2, 0, 20, 0],
  ['Bird Dog', 0, 10, 90, 0],
  ['Bird Dog', 1, 10, 90, 0],
  ['Rest', 1, 0, 10, 0],
  ['Cat Cow', 0, 0, 45, 0],
  ['Cat Cow', 1, 0, 45, 0],
]);

/** Loaded lifts: 3 + 3 weighted sets, plus 2 bodyweight core sets. */
export const STRENGTH_LAPS_HEAVY = strength_laps('100000000000000001', [
  ['Goblet Squat', 0, 8, 40, 16],
  ['Goblet Squat', 0, 8, 40, 16],
  ['Goblet Squat', 0, 8, 40, 16],
  ['Goblet Squat', 3, 24, 120, 16],
  ['Rest', 3, 0, 180, 0],
  ['Romanian Deadlift', 0, 6, 35, 40],
  ['Romanian Deadlift', 0, 6, 35, 40],
  ['Romanian Deadlift', 0, 6, 35, 40],
  ['Romanian Deadlift', 3, 18, 105, 40],
  ['Rest', 3, 0, 180, 0],
  ['Dead Bug', 0, 10, 45, 0],
  ['Dead Bug', 0, 10, 45, 0],
  ['Dead Bug', 2, 20, 90, 0],
]);
