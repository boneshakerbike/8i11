/**
 * What kind of session an activity was, for the weekly framework checks.
 * Read from COROS's own intensity analysis; nothing for Bill to log.
 */

import type { CorosActivityDetail } from '@/lib/coros/parse';

/** Built-in ride sport types (custom sports report no intensity analysis). */
export const RIDE_SPORT_TYPES = new Set([200, 202, 203, 204, 205]);

/** Anaerobic training effect at or above this means real high-intensity work. */
export const INTERVAL_ANAEROBIC_TE = 3.0;

/**
 * An interval session (framework Lever 1: one 4x4 near max each week). COROS
 * labels a session's training focus; a high-intensity focus or a high
 * anaerobic training effect counts. Label wording to confirm on Bill's first
 * real interval ride (seen so far: "Base").
 */
export function is_interval_session(a: Pick<CorosActivityDetail, 'anaerobic_te' | 'training_focus'>): boolean {
  if (a.anaerobic_te != null && a.anaerobic_te >= INTERVAL_ANAEROBIC_TE) return true;
  return /vo2|threshold|anaerobic|interval|speed|power/i.test(a.training_focus ?? '');
}

/** COROS sport type for strength sessions (lifting, yoga, Pilates and rehab alike). */
export const STRENGTH_SPORT_TYPE = 402;

/** Loaded working sets that make a strength session heavy. */
export const HEAVY_LOADED_SETS = 6;

export type StrengthKind = 'heavy' | 'mobility';

/**
 * Heavy strength (framework Lever 3: heavy lifting 3x a week) or mobility
 * (yoga, Pilates, rehab). Heavy means at least 6 working sets with added
 * weight, e.g. 3 lifts x 2 sets; a stretching or bodyweight session has none.
 * Null until the exercises are read, or when COROS recorded none. To confirm
 * on Bill's first real heavy session.
 */
export function strength_kind(a: { working_sets: number | null; loaded_sets: number | null }): StrengthKind | null {
  if (a.loaded_sets == null || !a.working_sets) return null;
  return a.loaded_sets >= HEAVY_LOADED_SETS ? 'heavy' : 'mobility';
}
