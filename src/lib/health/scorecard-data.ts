/**
 * Loads this week's scorecard from the database. Shared by the scorecard route
 * and the daily brief, so the page and the coach see the same numbers.
 */

import { get_client, get_wellness_sleep_minutes, get_wellness_vitals } from '@/lib/db'
import { get_coros_activities } from '@/lib/coros/data'
import { get_daily_metric_vitals, get_weights } from '@/lib/coaching/db'
import { date_str_to_epoch_day, shift_date } from '@/lib/coaching/day'
import { BASELINE_DAYS, fill_gaps, week_start, weekly_scorecard, type Scorecard } from '@/lib/health/scorecard'

/**
 * `typed_weight`: a weight typed for today that is not saved yet (it reaches
 * the database when the coach session is saved).
 */
export async function load_scorecard(today: string, typed_weight?: number | null): Promise<Scorecard> {
  const start = week_start(today)
  // The last 7 days plus the 90 before them
  const history_from = shift_date(today, 6 + BASELINE_DAYS)
  const [activities, cache_sleep, cache_vitals, history, weights] = await Promise.all([
    get_coros_activities(get_client(), start, today),
    get_wellness_sleep_minutes(start, today),
    get_wellness_vitals(history_from, today),
    // Coach sessions saved the same Oura numbers; they fill days the cache lacks
    get_daily_metric_vitals(date_str_to_epoch_day(history_from), date_str_to_epoch_day(today)),
    get_weights(date_str_to_epoch_day(start), date_str_to_epoch_day(today)),
  ])
  const vitals = fill_gaps(cache_vitals, history.map(h => ({ date: h.date, hrv: h.hrv, resting_hr: h.resting_hr })))
  const sleep = fill_gaps(cache_sleep, history.map(h => ({ date: h.date, total_min: h.sleep_min })))
  const all_weights = typed_weight != null
    ? [...weights.filter(w => w.date !== today), { date: today, lbs: typed_weight }]
    : weights
  return weekly_scorecard({ today, activities, sleep, vitals, weights: all_weights })
}
