/**
 * Running weekend totals from the group picks of a round's sessions.
 * Scores only exist for revealed sessions, so totals grow as each session is revealed.
 */

interface ScoredPick {
  player_name: string;
  score?: { total: number } | null;
}

interface WeekendSession {
  state: string;
  group?: { predictions: ScoredPick[] | null } | null;
}

export interface WeekendTotal {
  player_name: string;
  points: number;
  position: number; // tied players share a position
}

export function compute_weekend_totals(
  sessions: WeekendSession[],
): { totals: WeekendTotal[]; revealed: number; total_sessions: number } {
  const points: Record<string, number> = {};
  let revealed = 0;

  for (const s of sessions) {
    if (s.state === 'revealed') revealed++;
    for (const p of s.group?.predictions || []) {
      points[p.player_name] = (points[p.player_name] || 0) + (p.score?.total ?? 0);
    }
  }

  const sorted = Object.keys(points)
    .map(name => ({ player_name: name, points: points[name] }))
    .sort((a, b) => b.points - a.points || a.player_name.localeCompare(b.player_name));

  const totals = sorted.map(t => ({
    ...t,
    position: sorted.findIndex(o => o.points === t.points) + 1,
  }));

  return { totals, revealed, total_sessions: sessions.length };
}
