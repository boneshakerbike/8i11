'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import SeasonGrid from '@/components/f1/season_grid';
import WeekendView from '@/components/f1/weekend_view';
import Leaderboard from '@/components/f1/leaderboard';
import RosterManager from '@/components/f1/roster_manager';
import PlayerPicker from '@/components/f1/player_picker';
import ActivityHud from '@/components/f1/activity_hud';
import AnthemPlayer from '@/components/f1/anthem_player';
import type { ActivityEntry } from '@/components/f1/activity_hud';
import type {
  F1RaceSchedule, F1Driver, F1DriverResult, SessionType, F1CancelledRound,
} from '@/lib/f1/types';
import { PLAYER_ANTHEMS } from '@/lib/f1/anthems';

interface SessionInfo {
  session_type: SessionType;
  state: string;
  prediction: { p1: string; p2: string; p3: string; fastest_lap: string | null; is_locked?: boolean } | null;
  score: { perfect_match: number; podium_lock: number; almost: number; fastest_lap: number; total: number } | null;
}

interface RevealData {
  results: F1DriverResult[];
  fastest_lap_driver_id: string | null;
  prediction: { p1: string; p2: string; p3: string; fastest_lap: string | null } | null;
  score: { perfect_match: number; podium_lock: number; almost: number; fastest_lap: number; total: number } | null;
}

interface LeaderboardEntry {
  player_name: string;
  total_score: number;
  sessions_played: number;
}

export default function F1Page() {
  const current_year = new Date().getFullYear();
  const { data: auth_session } = useSession();
  const is_admin = !!auth_session?.user && (auth_session.user as { id?: string }).id !== 'guest';
  const [season, set_season] = useState(current_year);
  const [races, set_races] = useState<F1RaceSchedule[]>([]);
  const [cancelled_rounds, set_cancelled_rounds] = useState<F1CancelledRound[]>([]);
  const [drivers, set_drivers] = useState<F1Driver[]>([]);
  const [selected_round, set_selected_round] = useState<number | null>(null);
  const [sessions, set_sessions] = useState<SessionInfo[]>([]);
  const [standings, set_standings] = useState<LeaderboardEntry[]>([]);
  const [revealed_data, set_revealed_data] = useState<Record<string, RevealData>>({});
  const [active_form, set_active_form] = useState<string | null>(null);
  const [submitting, set_submitting] = useState(false);
  const [revealing, set_revealing] = useState<string | null>(null);
  const [player_name, set_player_name] = useState('');
  const [, set_player_id] = useState('');
  const [name_resolving, set_name_resolving] = useState(true);
  const [show_name_prompt, set_show_name_prompt] = useState(false);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [roster, set_roster] = useState<string[]>([]);
  const [roster_loaded, set_roster_loaded] = useState(false);
  const [active_round, set_active_round] = useState<number | undefined>(undefined);
  const [completed_rounds, set_completed_rounds] = useState<number[]>([]);
  const [show_roster, set_show_roster] = useState(false);
  const [setup_banner_dismissed, set_setup_banner_dismissed] = useState(false);
  const [activity, set_activity] = useState<ActivityEntry[]>([]);
  const [anthem_winner, set_anthem_winner] = useState<{ player_name: string; anthem_url: string } | null>(null);
  const activity_counter = useRef(0);
  const drivers_ref = useRef<F1Driver[]>([]);
  const standings_ref = useRef<LeaderboardEntry[]>([]);
  const anthem_triggered_ref = useRef(false); // prevents double-trigger within same round
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prev_sessions_ref = useRef<any[] | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selected_round_ref = useRef<any>(null); // mirrors selected_round without being a dep of refresh_state
  const initialized_from_url = useRef(false);
  const active_form_ref = useRef<string | null>(null); // lets polls skip session updates while picks are being entered

  // Read season/round from URL params on mount (prevents "bounces to 2026" on refresh)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url_season = parseInt(params.get('season') || '');
    const url_round = parseInt(params.get('round') || '');
    if (url_season && !isNaN(url_season)) set_season(url_season);
    if (url_round && !isNaN(url_round)) set_selected_round(url_round);
    initialized_from_url.current = true;
  }, []);

  // Update URL when season/round changes
  useEffect(() => {
    if (!initialized_from_url.current) return;
    const params = new URLSearchParams();
    params.set('season', String(season));
    if (selected_round) params.set('round', String(selected_round));
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }, [season, selected_round]);

  useEffect(() => { active_form_ref.current = active_form; }, [active_form]);

  // Keep standings ref in sync for use inside refresh_state callback
  useEffect(() => { standings_ref.current = standings; }, [standings]);

  // Clear stale UI whenever the selected round changes; reset anthem trigger
  useEffect(() => {
    set_revealed_data({});
    set_active_form(null);
    set_sessions([]);
    set_anthem_winner(null);
    anthem_triggered_ref.current = false;
    selected_round_ref.current = selected_round; // keep ref in sync
  }, [selected_round]);

  // Reset HUD baseline when active round or season changes
  useEffect(() => {
    prev_sessions_ref.current = null;
    anthem_triggered_ref.current = false;
    set_anthem_winner(null);
  }, [active_round, season]);

  // Load player identity from localStorage; if no claimed ID, picker will show after roster loads
  useEffect(() => {
    const id = localStorage.getItem('f1_player_id');
    if (!id) {
      set_name_resolving(false);
      return;
    }
    set_player_id(id);
    fetch(`/api/f1/player?id=${encodeURIComponent(id)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.display_name) {
          set_player_name(data.display_name);
          localStorage.setItem('f1_player_name', data.display_name);
        }
        // If server has no record for this id, player_name stays empty → picker shows
        set_name_resolving(false);
      })
      .catch(() => {
        const local_name = localStorage.getItem('f1_player_name');
        if (local_name) set_player_name(local_name);
        set_name_resolving(false);
      });
  }, []);

  // Once roster is loaded and identity is resolved, show picker for guests with an unclaimed roster
  useEffect(() => {
    if (!roster_loaded || name_resolving || is_admin) return;
    const has_id = !!localStorage.getItem('f1_player_id');
    if ((!has_id || !player_name) && roster.length > 0) {
      set_show_name_prompt(true);
    }
  }, [roster_loaded, name_resolving, is_admin, player_name, roster]);

  // Claim a roster name as this device's identity
  const claim_player = (name: string) => {
    localStorage.setItem('f1_player_id', name);
    localStorage.setItem('f1_player_name', name);
    set_player_id(name);
    set_player_name(name);
    set_show_name_prompt(false);
    fetch('/api/f1/player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: name, display_name: name }),
    }).catch(() => {});
  };

  // Reset device association; admin gets inline picker, guest gets modal
  const reset_player = () => {
    localStorage.removeItem('f1_player_id');
    localStorage.removeItem('f1_player_name');
    set_player_id('');
    set_player_name('');
    if (!is_admin) set_show_name_prompt(true);
  };

  // Fetch season progress + roster
  const refresh_progress = useCallback(() => {
    fetch(`/api/f1/season_progress?season=${season}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        // A failed poll keeps the last good state instead of blanking the roster and active round
        if (!data || !Array.isArray(data.roster)) { set_roster_loaded(true); return; }
        set_roster(data.roster || []);
        set_active_round(data.roster?.length > 0 ? data.active_round : undefined);
        set_completed_rounds(data.roster?.length > 0 ? (data.completed_rounds || []) : []);
        set_roster_loaded(true);
      })
      .catch(() => { set_roster_loaded(true); });
  }, [season]);

  useEffect(() => { refresh_progress(); }, [refresh_progress]);

  // Fetch schedule + cancelled rounds
  const refresh_schedule = useCallback(() => {
    set_loading(true);
    set_error(null);
    fetch(`/api/f1/schedule?season=${season}`)
      .then(res => res.json())
      .then(data => {
        set_races(data.races || []);
        set_cancelled_rounds(data.cancelled_rounds || []);
        set_loading(false);
      })
      .catch(err => {
        set_error(err.message);
        set_loading(false);
      });
  }, [season]);

  useEffect(() => { refresh_schedule(); }, [refresh_schedule]);

  // Fetch drivers
  useEffect(() => {
    fetch(`/api/f1/drivers?season=${season}`)
      .then(res => res.json())
      .then(data => { const d = data.drivers || []; set_drivers(d); drivers_ref.current = d; })
      .catch(() => {}); // non-critical, form will show empty
  }, [season]);

  // Fetch leaderboard
  const refresh_leaderboard = useCallback(() => {
    fetch(`/api/f1/leaderboard?season=${season}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data && Array.isArray(data.standings)) set_standings(data.standings); })
      .catch(() => {});
  }, [season]);

  useEffect(() => { refresh_leaderboard(); }, [refresh_leaderboard]);

  // Push an entry to the activity feed (max 15, newest first)
  const push_activity = useCallback((entry_player: string, text: string) => {
    const id = ++activity_counter.current;
    set_activity(prev => [{ id, ts: Date.now(), player_name: entry_player, text }, ...prev].slice(0, 15));
  }, []);

  // Fetch player state for active round; diff against prev poll to update activity feed
  const refresh_state = useCallback(() => {
    if (!active_round || !player_name) return;
    fetch(`/api/f1/state?season=${season}&round=${active_round}&player=${encodeURIComponent(player_name)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        // A failed poll must not wipe the sessions, which would unmount an open prediction form
        if (!data || !Array.isArray(data.sessions)) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const new_sessions: any[] = data.sessions;
        const prev = prev_sessions_ref.current;
        const dvrs = drivers_ref.current;

        if (!prev) {
          // Synthesize catch-up status entries (other players only, appended not prepended)
          const catch_up: ActivityEntry[] = [];
          for (const ns of new_sessions) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const preds: any[] = ns.group?.predictions || [];
            const label = session_type_label(ns.session_type);
            for (const p of preds) {
              if (p.player_name === player_name) continue;
              catch_up.push({ id: ++activity_counter.current, ts: 0, player_name: p.player_name, text: `has picks for ${label}`, status: true });
            }
            if (ns.state === 'locked' || ns.state === 'revealed') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              for (const p of preds.filter((p: any) => p.player_name !== player_name)) {
                catch_up.push({ id: ++activity_counter.current, ts: 0, player_name: p.player_name, text: `locked in for ${label}`, status: true });
              }
            }
          }
          if (catch_up.length > 0) set_activity(catch_up.reverse().slice(0, 15));
        }

        if (prev) for (const ns of new_sessions) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ps = prev?.find((s: any) => s.session_type === ns.session_type);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const new_preds: any[] = ns.group?.predictions || [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const prev_preds: any[] = ps?.group?.predictions || [];
          const label = session_type_label(ns.session_type);
          for (const np of new_preds) {
            if (np.player_name === player_name) continue;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pp = prev_preds.find((p: any) => p.player_name === np.player_name);
            if (!pp) {
              // New prediction — collapse save+lock into one entry if already locked
              if (np.is_locked) {
                push_activity(np.player_name, `locked in ${fmt_picks(np, dvrs)} for ${label}`);
              } else {
                push_activity(np.player_name, `selected ${fmt_picks(np, dvrs)} for ${label}`);
              }
            } else {
              const picks_changed = pp.p1 !== np.p1 || pp.p2 !== np.p2 || pp.p3 !== np.p3;
              const just_locked = !pp.is_locked && np.is_locked;
              // Collapse pick change + lock into one entry
              if (picks_changed && just_locked) {
                push_activity(np.player_name, `locked in ${fmt_picks(np, dvrs)} for ${label}`);
              } else if (picks_changed) {
                const changed = (['p1', 'p2', 'p3'] as const).filter(pos => pp[pos] !== np[pos]);
                if (changed.length === 1) {
                  const pos = changed[0].toUpperCase();
                  push_activity(np.player_name, `changed ${pos} from ${driver_name(pp[changed[0]], dvrs)} to ${driver_name(np[changed[0]], dvrs)} for ${label}`);
                } else {
                  push_activity(np.player_name, `updated picks to ${fmt_picks(np, dvrs)} for ${label}`);
                }
              } else if (just_locked) {
                push_activity(np.player_name, `locked in for ${label}`);
              }
              if (!pp.score && np.score) {
                push_activity(np.player_name, `revealed ${label} results`);
              }
            }
          }
        }
        // Detect race session transitioning to revealed → trigger anthem once per round
        if (prev && !anthem_triggered_ref.current) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const race_ns = new_sessions.find((s: any) => s.session_type === 'race');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const race_ps = prev.find((s: any) => s.session_type === 'race');
          if (race_ns && race_ps && race_ps.state !== 'revealed' && race_ns.state === 'revealed') {
            anthem_triggered_ref.current = true;
            const winner = compute_round_winner(new_sessions, standings_ref.current);
            const anthem_url = winner ? PLAYER_ANTHEMS[winner] : undefined;
            if (winner && anthem_url) {
              set_anthem_winner({ player_name: winner, anthem_url });
            }
          }
        }

        prev_sessions_ref.current = new_sessions;
        // Only update weekend view sessions when viewing the active round, and not while picks are being entered
        if (selected_round_ref.current === active_round && !active_form_ref.current) set_sessions(new_sessions);
      })
      .catch(() => {});
  }, [season, active_round, player_name, push_activity]);

  useEffect(() => { refresh_state(); }, [refresh_state]);

  // Poll group state + season progress every 5s when active round is known
  useEffect(() => {
    if (!active_round || !player_name) return;
    const interval = setInterval(() => {
      refresh_state();
      refresh_progress();
    }, 5000);
    return () => clearInterval(interval);
  }, [active_round, player_name, refresh_state, refresh_progress]);

  // Fetch session data for the currently viewed round (weekend view display only)
  const refresh_viewed_round = useCallback(() => {
    if (!selected_round || !player_name) return;
    fetch(`/api/f1/state?season=${season}&round=${selected_round}&player=${encodeURIComponent(player_name)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data && Array.isArray(data.sessions)) set_sessions(data.sessions); })
      .catch(() => {});
  }, [season, selected_round, player_name]);

  useEffect(() => { refresh_viewed_round(); }, [refresh_viewed_round]);

  // Poll leaderboard + season progress every 10s on calendar view
  useEffect(() => {
    if (selected_round) return;
    const interval = setInterval(() => {
      refresh_leaderboard();
      refresh_progress();
    }, 10000);
    return () => clearInterval(interval);
  }, [selected_round, refresh_leaderboard, refresh_progress]);

  // Load cached revealed data for already-revealed sessions
  useEffect(() => {
    if (!sessions.length) return;

    const revealed_sessions = sessions.filter(s => s.state === 'revealed');
    for (const s of revealed_sessions) {
      if (revealed_data[s.session_type]) continue;

      fetch(`/api/f1/results?season=${season}&round=${selected_round}&session_type=${s.session_type}`)
        .then(res => {
          if (!res.ok) return null;
          return res.json();
        })
        .then(data => {
          if (!data) return;
          set_revealed_data(prev => ({
            ...prev,
            [s.session_type]: {
              results: data.results,
              fastest_lap_driver_id: data.fastest_lap_driver_id,
              prediction: s.prediction,
              score: s.score,
            },
          }));
        })
        .catch(() => {});
    }
  }, [sessions, season, selected_round, revealed_data]);

  // Submit prediction
  const handle_predict = async (
    session_type: SessionType, p1: string, p2: string, p3: string, fastest_lap: string | null
  ) => {
    set_submitting(true);
    try {
      const res = await fetch('/api/f1/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ season, round: selected_round, session_type, player_name, p1, p2, p3, fastest_lap }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to submit');
        return;
      }
      set_active_form(null);
      refresh_state();
    } catch {
      alert('Failed to submit prediction');
    } finally {
      set_submitting(false);
    }
  };

  // Lock prediction (picks must already be saved via Save Picks)
  const handle_lock = async (session_type: SessionType) => {
    set_submitting(true);
    try {
      const res = await fetch('/api/f1/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ season, round: selected_round, session_type, player_name }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to lock prediction');
        return;
      }
      refresh_state();
    } catch {
      alert('Failed to lock prediction');
    } finally {
      set_submitting(false);
    }
  };

  // Reveal results
  const handle_reveal = async (session_type: SessionType) => {
    set_revealing(session_type);
    try {
      const res = await fetch('/api/f1/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ season, round: selected_round, session_type, player_name }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to reveal');
        return;
      }
      set_revealed_data(prev => ({
        ...prev,
        [session_type]: data,
      }));
      refresh_state();
      refresh_leaderboard();
      refresh_progress();
      if (session_type === 'race') {
        refresh_schedule();
      }
    } catch {
      alert('Failed to reveal results');
    } finally {
      set_revealing(null);
    }
  };

  const selected_race = races.find(r => r.round === selected_round);

  return (
    <>
      <style jsx>{`
        .f1-page {
          max-width: 720px;
          margin: 0 auto;
          padding: 1.5rem 1rem;
          min-height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #111111;
          color: #e0e0e0;
        }
        .f1-header {
          text-align: center;
          margin-bottom: 1.5rem;
        }
        .f1-title {
          color: #ffffff;
          font-size: 1.5rem;
          font-weight: 700;
          margin-bottom: 0.25rem;
        }
        .f1-title-year {
          color: #e10600;
        }
        .f1-badge {
          display: inline-block;
          background: #e10600;
          color: #ffffff;
          font-weight: 900;
          font-style: italic;
          padding: 0.1rem 0.45rem;
          border-radius: 4px;
          font-size: 1.1rem;
          letter-spacing: -0.03em;
          margin-right: 0.3rem;
          vertical-align: baseline;
        }
        .f1-subtitle {
          color: #d1d5db;
          font-size: 0.85rem;
        }
        .player-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1.5rem;
          padding: 0.5rem 0.75rem;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 10px;
        }
        .player-name {
          color: #e0e0e0;
          font-size: 0.85rem;
        }
        .change-name {
          background: none;
          border: none;
          color: #e10600;
          cursor: pointer;
          font-size: 0.75rem;
        }
        .other-years {
          text-align: center;
          margin-top: 2rem;
          padding-top: 1.5rem;
          border-top: 1px solid rgba(255,255,255,0.05);
        }
        .other-years-label {
          color: #d1d5db;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.5rem;
        }
        .year-btn {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.05);
          color: #d1d5db;
          border-radius: 6px;
          padding: 0.3rem 0.75rem;
          cursor: pointer;
          font-size: 0.8rem;
          margin: 0 0.25rem;
        }
        .year-btn:hover {
          color: #e10600;
          border-color: rgba(225,6,0,0.3);
        }
      `}</style>

      <div style={{ background: '#111111', minHeight: '100vh' }}>
      <div className="f1-page">
        <div className="f1-header">
          <div className="f1-title">
            <span className="f1-badge">F1</span> <span className="f1-title-year">{season}</span> Predictors&apos; Championship
          </div>
          <div className="f1-subtitle">Predict the podium. Avoid spoilers. Settle the score.</div>
        </div>

        {/* Guest blocking picker — roster exists, guest hasn't claimed */}
        {show_name_prompt && !is_admin && (
          <PlayerPicker roster={roster} on_claim={claim_player} />
        )}

        {/* Admin: empty-season setup banner */}
        {is_admin && roster_loaded && roster.length === 0 && !setup_banner_dismissed && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem',
            background: 'rgba(225,6,0,0.08)', border: '1px solid rgba(225,6,0,0.25)',
            borderRadius: '8px', padding: '0.6rem 0.75rem', marginBottom: '1rem', fontSize: '0.85rem',
          }}>
            <span style={{ color: '#ccc' }}><strong>{season}</strong> season not set up — add players to get started.</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => set_show_roster(true)}
                style={{ background: '#e10600', border: 'none', color: '#fff', borderRadius: '5px', padding: '0.3rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700 }}
              >
                Open Roster Manager
              </button>
              <button
                onClick={() => set_setup_banner_dismissed(true)}
                style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Admin: inline name picker — roster exists but admin hasn't claimed */}
        {is_admin && roster_loaded && roster.length > 0 && !player_name && (
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px', padding: '0.6rem 0.75rem', marginBottom: '1rem',
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem',
          }}>
            <span style={{ color: '#d1d5db', fontSize: '0.8rem' }}>Playing as:</span>
            {roster.map(name => (
              <button
                key={name}
                onClick={() => claim_player(name)}
                style={{
                  background: 'rgba(225,6,0,0.1)', border: '1px solid rgba(225,6,0,0.3)',
                  color: '#e0e0e0', borderRadius: '5px', padding: '0.25rem 0.6rem',
                  fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600,
                }}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {/* Guest: empty roster message with season navigation */}
        {!is_admin && roster_loaded && roster.length === 0 && !player_name && (
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px', padding: '1rem', marginBottom: '1rem', textAlign: 'center',
          }}>
            <div style={{ color: '#d1d5db', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              No players on the roster yet.
            </div>
            <div style={{ color: '#d1d5db', fontSize: '0.8rem', marginBottom: '0.5rem' }}>Browse previous seasons:</div>
            <button className="year-btn" onClick={() => { set_season(s => s - 1); set_selected_round(null); }}>
              &larr; {season - 1}
            </button>
          </div>
        )}

        {/* Player bar */}
        {(player_name || is_admin) && (
          <div className="player-bar">
            <span className="player-name">
              {player_name ? <>Playing as: <strong>{player_name}</strong></> : <span style={{ color: '#555' }}>Not playing</span>}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {player_name && (
                <button className="change-name" onClick={reset_player}>
                  Not {player_name}?
                </button>
              )}
              {is_admin && (
                <button
                  onClick={() => set_show_roster(prev => !prev)}
                  style={{
                    background: show_roster ? 'rgba(225,6,0,0.15)' : 'none',
                    border: 'none',
                    color: show_roster ? '#e10600' : '#d1d5db',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    padding: '0.2rem',
                    lineHeight: 1,
                    borderRadius: '4px',
                  }}
                  title="Manage roster"
                >
                  &#9881;
                </button>
              )}
            </div>
          </div>
        )}

        {/* Roster manager (toggled by gear icon) */}
        {show_roster && is_admin && (
          <RosterManager
            season={season}
            round={selected_round}
            roster={roster}
            races={races}
            drivers={drivers}
            cancelled_rounds={cancelled_rounds}
            on_roster_change={(new_roster) => {
              set_roster(new_roster);
              refresh_progress();
            }}
            on_schedule_change={() => {
              refresh_schedule();
              refresh_progress();
            }}
            on_season_reset={() => {
              refresh_leaderboard();
              refresh_progress();
              set_sessions([]);
              set_revealed_data({});
            }}
          />
        )}

        {/* Leaderboard — loads independently, not gated on schedule fetch */}
        {!selected_round && (
          <Leaderboard standings={standings} season={season} />
        )}

        {/* Loading / Error */}
        {loading && !selected_round && (
          <div style={{ textAlign: 'center', color: '#d1d5db', padding: '2rem' }}>
            Loading {season} schedule...
          </div>
        )}
        {error && (
          <div style={{ textAlign: 'center', color: '#ff4466', padding: '2rem' }}>
            {error}
          </div>
        )}

        {/* Main content */}
        {!loading && !error && (
          <>
            {selected_round && selected_race ? (
              <WeekendView
                race={selected_race}
                sessions={sessions}
                drivers={drivers}
                revealed_data={revealed_data}
                active_form={active_form}
                on_predict_click={(st) => set_active_form(st)}
                on_predict_cancel={() => set_active_form(null)}
                on_predict_submit={handle_predict}
                on_lock={handle_lock}
                on_reveal={handle_reveal}
                submitting={submitting}
                revealing={revealing}
                roster_empty={roster.length === 0}
                is_admin={is_admin}
                on_podium_ceremony={() => {
                  const winner = compute_round_winner(sessions, standings_ref.current);
                  const anthem_url = winner ? PLAYER_ANTHEMS[winner] : undefined;
                  if (winner && anthem_url) set_anthem_winner({ player_name: winner, anthem_url });
                }}
                on_back={() => {
                  set_selected_round(null);
                  set_sessions([]);
                  set_revealed_data({});
                  set_active_form(null);
                }}
              />
            ) : (
              <>
                {races.length > 0 ? (
                  <SeasonGrid
                    races={races}
                    season={season}
                    cancelled_rounds={cancelled_rounds}
                    active_round={active_round}
                    completed_rounds={completed_rounds}
                    on_select_round={(round) => {
                      set_selected_round(round);
                      set_revealed_data({});
                      set_active_form(null);
                    }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', color: '#d1d5db', padding: '2rem' }}>
                    No races found for {season}. Try a different year.
                  </div>
                )}
                {/* Other years - de-emphasized at bottom */}
                <div className="other-years">
                  <div className="other-years-label">Other Seasons</div>
                  <button className="year-btn" onClick={() => { set_season(s => s - 1); set_selected_round(null); }}>
                    &larr; {season - 1}
                  </button>
                  <button className="year-btn" onClick={() => { set_season(s => s + 1); set_selected_round(null); }}>
                    {season + 1} &rarr;
                  </button>
                </div>
              </>
            )}
          </>
        )}
        <div style={{ textAlign: 'center', marginTop: '3rem', paddingBottom: '1rem' }}>
          <Link href="/" style={{ color: '#d1d5db', fontSize: '0.7rem', textDecoration: 'none' }}>8i11</Link>
        </div>
      </div>
      </div>
      <ActivityHud entries={activity} />
      {anthem_winner && (
        <AnthemPlayer
          player_name={anthem_winner.player_name}
          anthem_url={anthem_winner.anthem_url}
          on_dismiss={() => set_anthem_winner(null)}
        />
      )}
    </>
  );
}

// Determine the round winner from group predictions across all sessions.
// Tiebreak: season total from standings, then alphabetical.
function compute_round_winner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessions: any[],
  standings: LeaderboardEntry[],
): string | null {
  const round_scores: Record<string, number> = {};
  for (const session of sessions) {
    const preds = session.group?.predictions || [];
    for (const p of preds) {
      if (p.score?.total != null) {
        round_scores[p.player_name] = (round_scores[p.player_name] || 0) + p.score.total;
      }
    }
  }
  const players = Object.keys(round_scores);
  if (players.length === 0) return null;
  players.sort((a, b) => {
    const round_diff = round_scores[b] - round_scores[a];
    if (round_diff !== 0) return round_diff;
    const sa = standings.find(s => s.player_name === a)?.total_score ?? 0;
    const sb = standings.find(s => s.player_name === b)?.total_score ?? 0;
    if (sa !== sb) return sb - sa;
    return a.localeCompare(b);
  });
  return players[0];
}

function session_type_label(st: string): string {
  const labels: Record<string, string> = {
    qualifying: 'Qualifying', race: 'Race',
    sprint: 'Sprint', sprint_qualifying: 'Sprint Qualifying',
  };
  return labels[st] || st;
}

function driver_name(driver_id: string, drivers: F1Driver[]): string {
  return drivers.find(d => d.driver_id === driver_id)?.family_name || driver_id;
}

function fmt_picks(pred: { p1: string; p2: string; p3: string }, drivers: F1Driver[]): string {
  const n = (id: string) => driver_name(id, drivers);
  return `${n(pred.p1)} P1, ${n(pred.p2)} P2, ${n(pred.p3)} P3`;
}
