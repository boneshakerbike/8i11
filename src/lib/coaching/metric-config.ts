/**
 * Single source of truth for all coached health metrics.
 * Labels, units, thresholds, DB column names, slugs, and health interpretation.
 */

export interface MetricDef {
  slug: string;
  label: string;
  shortLabel: string;
  unit: string;
  dbColumn: string;
  higherIsBetter: boolean;
  /** Day-over-day delta below this threshold is treated as "stable" (no arrow) */
  deadZone: number;
  /** Whether this metric is available for trend detail pages */
  chartable: boolean;
}

export const METRIC_CONFIG: Record<string, MetricDef> = {
  hrv: {
    slug: 'hrv',
    label: 'HRV',
    shortLabel: 'HRV',
    unit: 'ms',
    dbColumn: 'hrv_rmssd',
    higherIsBetter: true,
    deadZone: 2,
    chartable: true,
  },
  resting_hr: {
    slug: 'resting-hr',
    label: 'Resting HR',
    shortLabel: 'RHR',
    unit: 'bpm',
    dbColumn: 'resting_hr',
    higherIsBetter: false,
    deadZone: 1,
    chartable: true,
  },
  spo2: {
    slug: 'spo2',
    label: 'Blood Oxygen',
    shortLabel: 'SpO2',
    unit: '%',
    dbColumn: 'spo2_average',
    higherIsBetter: true,
    deadZone: 1,
    chartable: true,
  },
  cv_age: {
    slug: 'cv-age',
    label: 'CV Age',
    shortLabel: 'CVAge',
    unit: 'yr',
    dbColumn: 'cardiovascular_age',
    higherIsBetter: false,
    deadZone: 1,
    chartable: true,
  },
  sleep_total: {
    slug: 'sleep-total',
    label: 'Total Sleep',
    shortLabel: 'Total',
    unit: 'min',
    dbColumn: 'sleep_duration_min',
    higherIsBetter: true,
    deadZone: 10,
    chartable: true,
  },
  deep_sleep: {
    slug: 'deep-sleep',
    label: 'Deep Sleep',
    shortLabel: 'Deep',
    unit: 'min',
    dbColumn: 'deep_sleep_min',
    higherIsBetter: true,
    deadZone: 5,
    chartable: true,
  },
  rem_sleep: {
    slug: 'rem-sleep',
    label: 'REM Sleep',
    shortLabel: 'REM',
    unit: 'min',
    dbColumn: 'rem_sleep_min',
    higherIsBetter: true,
    deadZone: 5,
    chartable: true,
  },
  resilience: {
    slug: 'resilience',
    label: 'Resilience',
    shortLabel: 'Resilience',
    unit: '%',
    dbColumn: 'recovery_pct',
    higherIsBetter: true,
    deadZone: 3,
    chartable: false,
  },
  weight: {
    slug: 'weight',
    label: 'Weight',
    shortLabel: 'Weight',
    unit: 'lbs',
    dbColumn: 'weight_lbs',
    higherIsBetter: false,
    deadZone: 2,
    chartable: true,
  },
};

/** Look up a MetricDef by its URL slug */
export function getMetricBySlug(slug: string): MetricDef | undefined {
  return Object.values(METRIC_CONFIG).find(m => m.slug === slug);
}

export type TrendDirection = 'up' | 'down' | 'stable';
export type HealthImpact = 'positive' | 'negative' | 'neutral';

export interface MetricTrend {
  slug: string;
  label: string;
  unit: string;
  today: number | null;
  yesterday: number | null;
  delta: number | null;
  direction: TrendDirection;
  healthImpact: HealthImpact;
  significant: boolean;
}

/**
 * Compute day-over-day trend with dead-zone thresholds and health interpretation.
 * Returns semantic results ready for UI consumption.
 */
export function computeTrend(key: string, today: number | null, yesterday: number | null): MetricTrend | null {
  const def = METRIC_CONFIG[key];
  if (!def) return null;

  const delta = (today != null && yesterday != null) ? today - yesterday : null;
  const absDelta = delta != null ? Math.abs(delta) : null;
  const significant = absDelta != null && absDelta > def.deadZone;

  let direction: TrendDirection = 'stable';
  if (significant && delta != null) {
    direction = delta > 0 ? 'up' : 'down';
  }

  let healthImpact: HealthImpact = 'neutral';
  if (significant) {
    if (def.higherIsBetter) {
      healthImpact = direction === 'up' ? 'positive' : 'negative';
    } else {
      healthImpact = direction === 'down' ? 'positive' : 'negative';
    }
  }

  return {
    slug: def.slug,
    label: def.label,
    unit: def.unit,
    today,
    yesterday,
    delta,
    direction,
    healthImpact,
    significant,
  };
}
