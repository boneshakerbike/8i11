/**
 * Long-range trends for the Trends page: every charted metric over 90 days
 * (daily) or a year (weekly averages, so a year stays readable). Pure, so
 * the grouping can be tested; the route reads daily_metrics.
 */

import { METRIC_CONFIG, type MetricDef } from '@/lib/coaching/metric-config';
import { epoch_day_to_date_str } from '@/lib/coaching/day';

export const TREND_RANGES = [90, 365] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

export interface TrendPoint {
  dateStr: string;
  value: number;
}

export interface TrendSeries {
  slug: string;
  label: string;
  unit: string;
  higherIsBetter: boolean;
  points: TrendPoint[];
  average: number | null;
  /** Mean of the first and last 7 days with data, to show which way it moved. */
  start: number | null;
  end: number | null;
}

export const TREND_METRICS: MetricDef[] = Object.values(METRIC_CONFIG).filter(m => m.chartable);

export const parse_range = (v: string | null): TrendRange => (Number(v) === 365 ? 365 : 90);

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Monday of the week a YYYY-MM-DD date falls in. */
export function week_start(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** One point per week (dated its Monday): the mean of that week's readings. */
export function weekly_means(points: TrendPoint[]): TrendPoint[] {
  const weeks = new Map<string, number[]>();
  for (const p of points) {
    const w = week_start(p.dateStr);
    weeks.set(w, [...(weeks.get(w) ?? []), p.value]);
  }
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dateStr, vs]) => ({ dateStr, value: mean(vs)! }));
}

/** Build every metric's series from daily_metrics rows ({ date: epoch day, <column>: value }). */
export function build_trend_series(rows: Record<string, unknown>[], range: TrendRange): TrendSeries[] {
  return TREND_METRICS.map(def => {
    const daily = rows
      .filter(r => r[def.dbColumn] != null && Number.isFinite(Number(r[def.dbColumn])))
      .map(r => ({ dateStr: epoch_day_to_date_str(Number(r.date)), value: Number(r[def.dbColumn]) }))
      .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    const values = daily.map(p => p.value);
    return {
      slug: def.slug,
      label: def.label,
      unit: def.unit,
      higherIsBetter: def.higherIsBetter,
      points: range === 365 ? weekly_means(daily) : daily,
      average: mean(values),
      start: mean(values.slice(0, 7)),
      end: mean(values.slice(-7)),
    };
  });
}
