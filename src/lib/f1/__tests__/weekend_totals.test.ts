/**
 * Weekend totals tests
 * Spec: running per-player points for the current weekend across revealed sessions.
 */

import { describe, it, expect } from 'vitest';
import { compute_weekend_totals } from '../weekend_totals';

const pick = (player_name: string, total: number | null) => ({
  player_name,
  score: total == null ? null : { total },
});

// Singapore 2026 going into the Grand Prix: sprint quali, sprint and quali revealed
const sessions = [
  { state: 'revealed', group: { predictions: [pick('Bill', 6), pick('Mr Bear', 5), pick('Mo', 4)] } },
  { state: 'revealed', group: { predictions: [pick('Mr Bear', 10), pick('Bill', 5), pick('Mo', 5)] } },
  { state: 'revealed', group: { predictions: [pick('Bill', 9), pick('Mo', 7), pick('Mr Bear', 4)] } },
  { state: 'watching', group: { predictions: [pick('Bill', null), pick('Mo', null), pick('Mr Bear', null)] } },
];

describe('compute_weekend_totals', () => {
  it('sums revealed session scores per player, leader first', () => {
    const { totals, revealed, total_sessions } = compute_weekend_totals(sessions);
    expect(totals).toEqual([
      { player_name: 'Bill', points: 20, position: 1 },
      { player_name: 'Mr Bear', points: 19, position: 2 },
      { player_name: 'Mo', points: 16, position: 3 },
    ]);
    expect(revealed).toBe(3);
    expect(total_sessions).toBe(4);
  });

  it('gives tied players the same position', () => {
    const tied = [{ state: 'revealed', group: { predictions: [pick('Mo', 5), pick('Bill', 5), pick('Ann', 2)] } }];
    expect(compute_weekend_totals(tied).totals.map(t => [t.player_name, t.position])).toEqual([
      ['Bill', 1], ['Mo', 1], ['Ann', 3],
    ]);
  });

  it('lists players at 0 before anything is revealed', () => {
    const { totals, revealed } = compute_weekend_totals([sessions[3]]);
    expect(totals.every(t => t.points === 0 && t.position === 1)).toBe(true);
    expect(revealed).toBe(0);
  });

  it('handles sessions without group data', () => {
    expect(compute_weekend_totals([{ state: 'predicting', group: null }]).totals).toEqual([]);
  });
});
