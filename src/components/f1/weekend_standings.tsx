'use client';

import { compute_weekend_totals } from '@/lib/f1/weekend_totals';

type WeekendStandingsProps = {
  sessions: Parameters<typeof compute_weekend_totals>[0];
};

// Running points for this weekend only; shown once the first session is revealed
export default function WeekendStandings({ sessions }: WeekendStandingsProps) {
  const { totals, revealed, total_sessions } = compute_weekend_totals(sessions);
  if (revealed === 0 || totals.length === 0) return null;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: '10px',
      marginBottom: '0.75rem',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '0.75rem 0.85rem',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}>
        <span style={{ color: '#ffffff', fontSize: '1rem', fontWeight: 700 }}>Weekend Standings</span>
        <span style={{ color: '#d1d5db', fontSize: '0.8rem' }}>
          {revealed === total_sessions ? 'Final' : `After ${revealed} of ${total_sessions} sessions`}
        </span>
      </div>
      {totals.map((t, i) => (
        <div key={t.player_name} style={{
          display: 'grid',
          gridTemplateColumns: '32px 1fr 56px',
          padding: '0.65rem 0.85rem',
          borderBottom: i < totals.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          background: i % 2 === 1 ? 'rgba(255,255,255,0.03)' : 'transparent',
        }}>
          <div style={{
            color: t.position === 1 ? '#ffd700' : t.position === 2 ? '#c0c0c0' : t.position === 3 ? '#cd7f32' : '#d1d5db',
            fontWeight: 700,
            fontSize: '0.9rem',
          }}>
            {t.position}
          </div>
          <div style={{ color: '#ffffff', fontSize: '0.9rem', fontWeight: 500 }}>{t.player_name}</div>
          <div style={{ color: '#ffffff', fontWeight: 700, fontSize: '0.9rem', textAlign: 'right' }}>
            {t.points} pts
          </div>
        </div>
      ))}
    </div>
  );
}
