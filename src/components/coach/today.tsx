/**
 * The Today page (/health): this morning's Oura and COROS data, the weekly
 * scorecard, and the daily coaching chat. /coach redirects here.
 * Pre-chat: key metrics and manual inputs. Chat: a short 1-3 turn session.
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import NavTabs from '@/components/nav_tabs';
import SyncStatus from '@/components/sync_status';
import WeeklyScorecard from '@/components/weekly_scorecard';
import ProfileProposals from '@/components/profile_proposals';
import { MetricCard, Sparkline, TrendArrow, type TrendInfo } from '@/components/coach/metric_cards';
import { BACK_LEVELS, BOWEL_LEVELS, LevelSelector } from '@/components/coach/level_selector';
import SessionHistory, { type HistorySession } from '@/components/coach/session_history';
import YesterdayActivities from '@/components/coach/yesterday_activities';
import type { ProfileProposal } from '@/lib/coaching/memory';
import { mt_date_str, mt_epoch_day } from '@/lib/coaching/day';
import { parseAdviceFull } from '@/lib/coaching/advice';
import { estimate_cv_age, primary_sleep } from '@/lib/health/oura-derive';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Metrics {
  readiness?: number | null;
  hrv?: number | null;
  resting_hr?: number | null;
  spo2?: number | null;
  sleep_score?: number | null;
  sleep_total?: number | null;
  deep_sleep_min?: number | null;
  rem_sleep_min?: number | null;
  sleep_efficiency?: number | null;
  cv_age?: number | null;
  stress_min?: number | null;
  restored_min?: number | null;
  recovery_status?: string | null;
  resilience?: string | null;
  resilience_pct?: number | null;
  weight?: number | null;
  weight_stale?: boolean;
  back_pain?: number | null;
}

export default function CoachToday() {
  useEffect(() => { document.title = '8i11 | Today'; }, []);

  // Manual inputs — selectors start unset so an untouched input saves null
  const [backPain, setBackPain] = useState<number | null>(null);
  const [bowel, setBowel] = useState<number | null>(null);
  const [injuries, setInjuries] = useState('');

  // Data state
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [dataInjection, setDataInjection] = useState('');
  const [trends, setTrends] = useState<Record<string, TrendInfo>>({});
  const [sparklines, setSparklines] = useState<Record<string, (number | null)[]>>({});

  const [showHistory, setShowHistory] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionStarted, setSessionStarted] = useState(false);
  const [metricsCollapsed, setMetricsCollapsed] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [savedSummary, setSavedSummary] = useState('');
  const [proposals, setProposals] = useState<ProfileProposal[] | undefined>(undefined);
  const [todaySession, setTodaySession] = useState<HistorySession | null>(null);
  const [todayChecked, setTodayChecked] = useState(false);
  const [startNewAnyway, setStartNewAnyway] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const [turnCount, setTurnCount] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  // Bumped after each COROS sync so the weekly box re-reads what was saved
  const [corosVersion, setCorosVersion] = useState(0);

  // Day boundary is Mountain Time regardless of where the client runs
  const dateStr = mt_date_str();
  const epochDay = mt_epoch_day();

  // Pull COROS on open (Bill weighs in and syncs the watch each morning), then
  // show the saved weight and reload the weekly box. Best effort: on failure
  // the page keeps what was already saved.
  useEffect(() => {
    fetch('/api/coros/sync', { method: 'POST' })
      .then(res => res.json())
      .then((data: { weight?: { value: number; stale: boolean } | null }) => {
        const w = data?.weight;
        if (w) setMetrics(prev => (prev ? { ...prev, weight: w.value, weight_stale: w.stale } : prev));
        setCorosVersion(v => v + 1);
      })
      .catch(() => {});
  }, []);

  // Hydrate manual-input draft from sessionStorage so refreshes don't lose in-progress entries
  useEffect(() => {
    const draft_key = `coach_manual_inputs_${dateStr}`;
    try {
      const raw = sessionStorage.getItem(draft_key);
      if (raw) {
        const draft = JSON.parse(raw);
        if (typeof draft.backPain === 'number' || draft.backPain === null) setBackPain(draft.backPain);
        if (typeof draft.bowel === 'number' || draft.bowel === null) setBowel(draft.bowel);
        if (typeof draft.injuries === 'string') setInjuries(draft.injuries);
      }
    } catch { /* corrupt draft — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore an in-progress chat session from sessionStorage. Runs unconditionally
  // on mount — a local read, independent of the loadTodaySession network call —
  // so a slow/failed fetch never blocks recovering the conversation. If today's
  // session turns out to already be finalized server-side, loadTodaySession
  // corrects for it afterward (see below).
  useEffect(() => {
    const session_key = `coach_session_${dateStr}`;
    try {
      const raw = sessionStorage.getItem(session_key);
      if (raw) {
        const draft = JSON.parse(raw);
        if (Array.isArray(draft.messages) && draft.messages.length > 0) {
          setMessages(draft.messages);
          setSessionStarted(Boolean(draft.sessionStarted));
          setMetricsCollapsed(Boolean(draft.sessionStarted));
          if (typeof draft.dataInjection === 'string') setDataInjection(draft.dataInjection);
          if (typeof draft.turnCount === 'number') setTurnCount(draft.turnCount);
          if (typeof draft.totalTokens === 'number') setTotalTokens(draft.totalTokens);
        }
      }
    } catch { /* corrupt draft — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save manual-input draft as it changes
  useEffect(() => {
    const draft_key = `coach_manual_inputs_${dateStr}`;
    try {
      sessionStorage.setItem(draft_key, JSON.stringify({ backPain, bowel, injuries }));
    } catch { /* storage full or unavailable — skip */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backPain, bowel, injuries]);

  // Auto-save the in-progress chat session as it changes
  useEffect(() => {
    if (!sessionStarted || finalized) return;
    const session_key = `coach_session_${dateStr}`;
    try {
      sessionStorage.setItem(session_key, JSON.stringify({ messages, sessionStarted, dataInjection, turnCount, totalTokens }));
    } catch { /* storage full or unavailable — skip */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, sessionStarted, dataInjection, turnCount, totalTokens, finalized]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load metrics on mount (Oura, then trends)
  useEffect(() => {
    // Repaint instantly from today's cache, then refresh in the background
    const cache_key = `coach_metrics_${dateStr}`;
    try {
      const cached = sessionStorage.getItem(cache_key);
      if (cached) {
        const c = JSON.parse(cached);
        if (c.metrics) setMetrics(c.metrics);
        if (c.trends) setTrends(c.trends);
        if (c.sparklines) setSparklines(c.sparklines);
        setMetricsLoading(false);
      }
    } catch { /* corrupt cache — ignore */ }

    async function loadMetrics() {
      try {
        const ouraRes = await fetch(`/api/oura/data?date=${dateStr}`).catch(() => null);
        const ouraData = ouraRes?.ok ? await ouraRes.json() : null;

        // Quick metrics extraction from Oura data
        const m: Metrics = {};
        if (ouraData?.success) {
          const scores = ouraData.scores || {};
          m.readiness = scores.readiness ?? null;
          m.hrv = scores.hrv_average ?? null;
          m.resting_hr = scores.resting_hr ?? null;
          m.spo2 = scores.spo2_average ?? null;
          m.sleep_score = scores.sleep ?? null;

          // Sleep durations come from sleep_detail (period data), not daily_sleep (scores only)
          const sleep_period = primary_sleep(ouraData.sleep_detail as Record<string, unknown>[] | null);
          if (sleep_period) {
            m.sleep_total = sleep_period.total_sleep_duration ? Math.round(Number(sleep_period.total_sleep_duration) / 60) : null;
            m.deep_sleep_min = sleep_period.deep_sleep_duration ? Math.round(Number(sleep_period.deep_sleep_duration) / 60) : null;
            m.rem_sleep_min = sleep_period.rem_sleep_duration ? Math.round(Number(sleep_period.rem_sleep_duration) / 60) : null;
            m.sleep_efficiency = sleep_period.efficiency ? Number(sleep_period.efficiency) : null;
          }

          const stress = ouraData.stress;
          if (stress) {
            m.stress_min = stress.stress_high ? Math.round(stress.stress_high / 60) : null;
            m.restored_min = stress.recovery_high ? Math.round(stress.recovery_high / 60) : null;
            // Client-side resilience from today's stress/recovery
            if (m.stress_min != null && m.restored_min != null) {
              const total = m.stress_min + m.restored_min;
              if (total > 0) {
                const pct = Math.round((m.restored_min / total) * 100);
                m.resilience_pct = pct;
                if (pct >= 65) m.resilience = 'High recovery, low stress';
                else if (pct >= 50) m.resilience = 'Balanced';
                else if (pct >= 35) m.resilience = 'Elevated stress';
                else m.resilience = 'High stress, low recovery';
              }
            }
          }
        }

        // Client-side recovery estimate (upgraded by server after inject)
        if (m.readiness !== null && m.readiness !== undefined) {
          const deep_ok = m.deep_sleep_min ? m.deep_sleep_min >= 60 : null;
          const sleep_ok = m.sleep_total ? m.sleep_total >= 420 : null;
          const stress_ratio = (m.stress_min && m.restored_min)
            ? m.restored_min / (m.stress_min + m.restored_min) : null;
          let score = 0;
          if (m.readiness >= 85) score += 2; else if (m.readiness >= 70) score += 1;
          else if (m.readiness < 60) score -= 2; else score -= 1;
          if (deep_ok === true) score += 1; if (deep_ok === false) score -= 1;
          if (sleep_ok === true) score += 1; if (sleep_ok === false) score -= 1;
          if (stress_ratio !== null && stress_ratio >= 0.5) score += 1;
          if (stress_ratio !== null && stress_ratio < 0.5) score -= 1;
          if (score >= 4) m.recovery_status = 'Ready to push';
          else if (score >= 2) m.recovery_status = 'Ready, moderate effort';
          else if (score >= 0) m.recovery_status = 'Easy day';
          else if (score >= -2) m.recovery_status = 'Recovery, light movement only';
          else m.recovery_status = 'Rest day';
        }

        // Estimate cardiovascular age from HRV + RHR (Umetani regression)
        const estimated_cv_age = estimate_cv_age(m.hrv, m.resting_hr);
        if (estimated_cv_age != null) m.cv_age = estimated_cv_age;

        setMetrics(m);

        // POST live metrics to ensure today's daily_metrics row exists, then get trends
        try {
          const trendsRes = await fetch('/api/coaching/trends/today', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              metrics: {
                hrv_rmssd: m.hrv ?? null,
                resting_hr: m.resting_hr ?? null,
                spo2_average: m.spo2 ?? null,
                readiness_score: m.readiness ?? null,
                sleep_duration_min: m.sleep_total ?? null,
                deep_sleep_min: m.deep_sleep_min ?? null,
                rem_sleep_min: m.rem_sleep_min ?? null,
                sleep_efficiency_pct: m.sleep_efficiency ?? null,
                cardiovascular_age: m.cv_age ?? null,
              },
            }),
          });
          if (trendsRes.ok) {
            const trendsData = await trendsRes.json();
            const trendMap: Record<string, TrendInfo> = {};
            for (const t of trendsData.trends || []) {
              trendMap[t.slug] = { direction: t.direction, healthImpact: t.healthImpact, significant: t.significant };
            }
            setTrends(trendMap);
            if (trendsData.sparklines) {
              setSparklines(trendsData.sparklines);
            }
            const merged = { ...m };
            if (trendsData.lastWeight) {
              merged.weight = m.weight ?? trendsData.lastWeight.value;
              merged.weight_stale = m.weight ? m.weight_stale : trendsData.lastWeight.stale;
              setMetrics(merged);
            }
            try {
              sessionStorage.setItem(cache_key, JSON.stringify({ metrics: merged, trends: trendMap, sparklines: trendsData.sparklines ?? {} }));
            } catch { /* storage full or unavailable — skip */ }
          }
        } catch {
          // Best effort — arrows just won't show
        }
      } catch {
        // Best effort — metrics pane just won't show
      } finally {
        setMetricsLoading(false);
      }
    }
    loadMetrics();

    // Check whether today's session is already saved (hides the start form)
    async function loadTodaySession() {
      try {
        const res = await fetch(`/api/coaching/today?date=${epochDay}`);
        if (res.ok) {
          const data = await res.json();
          if (data.session) {
            setTodaySession(data.session);
          }
        }
      } catch { /* best effort — form shows as usual */ }
      setTodayChecked(true);
    }
    loadTodaySession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startSession() {
    setLoading(true);
    setError('');

    try {
      const ouraRes = await fetch(`/api/oura/data?date=${dateStr}`).catch(() => null);
      const ouraData = ouraRes?.ok ? await ouraRes.json() : null;

      // Build data injection on the server
      const injectRes = await fetch('/api/coaching/inject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date_str: dateStr,
          epoch_day: epochDay,
          manual: {
            back_pain_scale: backPain ?? undefined,
            bowel_status: bowel != null ? BOWEL_LEVELS.find(o => o.value === bowel)?.label : undefined,
            bowel_scale: bowel ?? undefined,
            injury_notes: injuries || undefined,
          },
          oura_live: ouraData?.success ? ouraData : undefined,
        }),
      });

      if (!injectRes.ok) throw new Error('Failed to build health data');
      const { injection, metrics: serverMetrics } = await injectRes.json();
      setDataInjection(injection);

      // Update metrics with server-computed values (weight comes from COROS)
      if (serverMetrics) {
        setMetrics(prev => ({ ...prev, ...serverMetrics }));
      }
      // Session start refreshed COROS too
      setCorosVersion(v => v + 1);

      // Send to coaching chat
      const chatRes = await fetch('/api/coaching/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_history: [],
          user_message: injection,
        }),
      });

      if (!chatRes.ok) {
        const err = await chatRes.json();
        throw new Error(err.error || 'Chat failed');
      }

      const data = await chatRes.json();
      setTotalTokens((data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0));
      setTurnCount(1);

      setMessages([
        { role: 'user', content: injection },
        { role: 'assistant', content: data.response },
      ]);
      setSessionStarted(true);
      setMetricsCollapsed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start session');
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput('');
    setLoading(true);
    setError('');

    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: userMsg }];
    setMessages(newMessages);

    try {
      const res = await fetch('/api/coaching/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_history: messages,
          user_message: userMsg,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Chat failed');
      }

      const data = await res.json();
      setTotalTokens(prev => prev + (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0));
      setTurnCount(data.turn || turnCount + 1);
      setMessages([...newMessages, { role: 'assistant', content: data.response }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message');
    } finally {
      setLoading(false);
    }
  }

  async function saveSession() {
    setLoading(true);
    setError('');

    try {
      const adviceFull = messages
        .map(m => `${m.role === 'assistant' ? 'Coach' : 'You'}: ${m.content}`)
        .join('\n\n');

      const res = await fetch('/api/coaching/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: epochDay,
          date_str: dateStr,
          advice_full: adviceFull,
          conversation_turns: turnCount,
          token_count: totalTokens,
          data_snapshot: dataInjection,
          manual: {
            back_pain_scale: backPain ?? undefined,
            bowel_status: bowel != null ? BOWEL_LEVELS.find(o => o.value === bowel)?.label : undefined,
            bowel_scale: bowel ?? undefined,
            injury_notes: injuries || undefined,
          },
          inject_metrics: metrics ? {
            readiness: metrics.readiness,
            hrv: metrics.hrv,
            resting_hr: metrics.resting_hr,
            spo2: metrics.spo2,
            sleep_total: metrics.sleep_total,
            deep_sleep_min: metrics.deep_sleep_min,
            rem_sleep_min: metrics.rem_sleep_min,
            sleep_efficiency: metrics.sleep_efficiency,
            stress_min: metrics.stress_min,
            restored_min: metrics.restored_min,
          } : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Save failed');
      }

      const data = await res.json();
      setFinalized(true);
      setSavedSummary(data.summary || '');
      setProposals(data.proposals ?? []);
      try {
        sessionStorage.removeItem(`coach_manual_inputs_${dateStr}`);
        sessionStorage.removeItem(`coach_session_${dateStr}`);
      } catch { /* unavailable — skip */ }
      // Mirror what finalize stored so a re-render shows the completed view
      setTodaySession({
        date: epochDay,
        advice_full: dataInjection
          ? `[Data for this session]\n${dataInjection}\n\n[Conversation]\n${adviceFull}`
          : adviceFull,
        advice_summary: data.summary || null,
        conversation_turns: turnCount,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  function formatMinutes(min: number | null | undefined): string {
    if (!min) return '—';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <NavTabs />
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">Today</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">{dateStr}</span>
            <Link
              href="/coach/memory"
              className="text-sm text-gray-400 hover:text-white border border-zinc-700 px-3 py-1 rounded transition-colors"
            >
              Memory
            </Link>
            <button
              onClick={() => setShowHistory(s => !s)}
              className="text-sm text-gray-400 hover:text-white border border-zinc-700 px-3 py-1 rounded transition-colors"
            >
              {showHistory ? 'Hide' : 'History'}
            </button>
          </div>
        </div>

        <SyncStatus />
        <WeeklyScorecard refresh={corosVersion} />

        <SessionHistory open={showHistory} />

        {/* Pre-Chat: Metrics Pane */}
        <div className="space-y-4 mb-5">
            {/* Once a session starts, metrics collapse behind this header */}
            {sessionStarted && (
              <button
                onClick={() => setMetricsCollapsed(c => !c)}
                className="w-full flex justify-between items-center bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
              >
                <span>Today&apos;s data{metrics?.recovery_status ? ` · ${metrics.recovery_status}` : ''}</span>
                <span className={`text-xs transition-transform ${metricsCollapsed ? '' : 'rotate-180'}`}>▼</span>
              </button>
            )}

            {/* Metrics Grid */}
            {(!sessionStarted || !metricsCollapsed) && (metricsLoading ? (
              <div className="text-gray-500 text-sm">Loading health data...</div>
            ) : metrics ? (
              <div className="space-y-3">
                {/* Recovery Status — the primary signal */}
                {metrics.recovery_status && (
                  <div className={`border rounded-lg px-4 py-3 ${
                    metrics.recovery_status.startsWith('Ready to push') ? 'bg-green-950 border-green-800' :
                    metrics.recovery_status.startsWith('Ready') ? 'bg-emerald-950 border-emerald-800' :
                    metrics.recovery_status.startsWith('Easy') ? 'bg-yellow-950 border-yellow-800' :
                    metrics.recovery_status.startsWith('Recovery') ? 'bg-orange-950 border-orange-800' :
                    'bg-red-950 border-red-800'
                  }`}>
                    <div className="text-xs text-gray-400">Today&apos;s Status</div>
                    <div className="text-lg font-semibold text-white">{metrics.recovery_status}</div>
                  </div>
                )}

                {/* Sleep — actual durations */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-500 mb-1">Sleep</div>
                  <div className="grid grid-cols-3 gap-3">
                    <Link href="/coach/metric/sleep-total" className="hover:opacity-80 transition-opacity">
                      <div className="text-lg font-semibold text-white">
                        {metrics.sleep_total ? formatMinutes(metrics.sleep_total) : '—'}
                        <TrendArrow trend={trends['sleep-total']} />
                      </div>
                      <div className="text-xs text-gray-500">total</div>
                      {sparklines['sleep-total'] && <Sparkline data={sparklines['sleep-total']} />}
                    </Link>
                    <Link href="/coach/metric/deep-sleep" className="hover:opacity-80 transition-opacity">
                      <div className="text-lg font-semibold text-white">
                        {metrics.deep_sleep_min ? formatMinutes(metrics.deep_sleep_min) : '—'}
                        <TrendArrow trend={trends['deep-sleep']} />
                      </div>
                      <div className="text-xs text-gray-500">deep</div>
                      {sparklines['deep-sleep'] && <Sparkline data={sparklines['deep-sleep']} />}
                    </Link>
                    <Link href="/coach/metric/rem-sleep" className="hover:opacity-80 transition-opacity">
                      <div className="text-lg font-semibold text-white">
                        {metrics.rem_sleep_min ? formatMinutes(metrics.rem_sleep_min) : '—'}
                        <TrendArrow trend={trends['rem-sleep']} />
                      </div>
                      <div className="text-xs text-gray-500">REM</div>
                      {sparklines['rem-sleep'] && <Sparkline data={sparklines['rem-sleep']} />}
                    </Link>
                  </div>
                </div>

                {/* Physiology: six equal tiles, two rows of three on phones */}
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  <MetricCard label="HRV" value={metrics.hrv} unit="ms" trend={trends['hrv']} sparkline={sparklines['hrv']} href="/coach/metric/hrv" />
                  <MetricCard label="Resting HR" value={metrics.resting_hr} unit="bpm" trend={trends['resting-hr']} sparkline={sparklines['resting-hr']} href="/coach/metric/resting-hr" />
                  <MetricCard label="Blood Oxygen" value={metrics.spo2 ? Math.round(metrics.spo2) : null} unit="%" trend={trends['spo2']} sparkline={sparklines['spo2']} href="/coach/metric/spo2" />
                  <MetricCard label="CV Age" value={metrics.cv_age} unit="yr" trend={trends['cv-age']} sparkline={sparklines['cv-age']} href="/coach/metric/cv-age" />
                  <MetricCard label="Weight" value={metrics.weight} unit="lbs" warn={metrics.weight_stale} trend={trends['weight']} sparkline={sparklines['weight']} href="/coach/metric/weight" />
                  {(metrics.stress_min != null && metrics.restored_min != null) && (
                    <div className={`h-full flex flex-col bg-zinc-900 border rounded-lg px-3 py-2 ${
                      metrics.resilience?.includes('High recovery') ? 'border-green-800' :
                      metrics.resilience?.includes('Balanced') ? 'border-zinc-700' :
                      metrics.resilience?.includes('Elevated') ? 'border-yellow-700' :
                      metrics.resilience?.includes('High stress') ? 'border-red-800' :
                      'border-zinc-800'
                    }`}>
                      <div className="text-xs text-gray-500 truncate">Resilience</div>
                      <div className="text-sm font-medium text-white">{metrics.resilience || 'No stress data yet'}</div>
                      <div className="mt-auto text-xs text-gray-500">{metrics.stress_min}m / {metrics.restored_min}m</div>
                    </div>
                  )}
                </div>

                <YesterdayActivities refresh={corosVersion} />
              </div>
            ) : (
              <div className="text-gray-500 text-sm">No health data available. Oura may need to sync.</div>
            ))}

            {/* Completed session: synopsis + transcript instead of the form */}
            {!sessionStarted && todaySession && !startNewAnyway && (
              <div className="space-y-3">
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">Today&apos;s session</span>
                    <span className="text-xs text-green-400">✓ Complete</span>
                  </div>
                  {todaySession.advice_summary ? (
                    <p className="text-sm text-gray-300">{todaySession.advice_summary}</p>
                  ) : (
                    <p className="text-sm text-gray-500">Session saved — no summary was generated.</p>
                  )}
                  {parseAdviceFull(todaySession.advice_full).dataSnapshot && (
                    <details className="text-xs">
                      <summary className="text-gray-500 cursor-pointer">What the coach saw</summary>
                      <div className="mt-1 text-gray-500 whitespace-pre-wrap bg-zinc-950 rounded p-2">{parseAdviceFull(todaySession.advice_full).dataSnapshot}</div>
                    </details>
                  )}
                  <details className="text-xs">
                    <summary className="text-gray-500 cursor-pointer">Full conversation</summary>
                    <div className="mt-1 text-gray-400 whitespace-pre-wrap">{parseAdviceFull(todaySession.advice_full).conversation}</div>
                  </details>
                </div>
                <ProfileProposals />
                <button
                  onClick={() => setStartNewAnyway(true)}
                  className="text-xs text-gray-500 hover:text-gray-300 underline decoration-zinc-700 transition-colors"
                >
                  Start a new session
                </button>
              </div>
            )}

            {!sessionStarted && todayChecked && (!todaySession || startNewAnyway) && (<>
            {startNewAnyway && (
              <p className="text-xs text-yellow-500">Saving a new session will replace today&apos;s saved session.</p>
            )}

            {/* Manual Inputs */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Back</label>
                <LevelSelector options={BACK_LEVELS} value={backPain} onChange={setBackPain} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Bowel</label>
                <LevelSelector options={BOWEL_LEVELS} value={bowel} onChange={setBowel} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <textarea
                  value={injuries}
                  onChange={e => setInjuries(e.target.value)}
                  placeholder="Injuries or notes for today"
                  rows={2}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-white text-sm"
                />
              </div>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              onClick={startSession}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 text-white font-medium py-3 rounded transition-colors"
            >
              {loading ? 'Starting...' : 'Start Session'}
            </button>
            </>)}
        </div>

        {/* Chat */}
        {sessionStarted && (
          <div className="space-y-3">
            {/* The daily brief the coach was given, so a wrong number can be caught */}
            <details className="text-xs">
              <summary className="text-gray-500 cursor-pointer">What the coach sees</summary>
              <div className="mt-1 text-gray-500 whitespace-pre-wrap bg-zinc-950 rounded p-2">{dataInjection}</div>
            </details>

            {/* Messages — skip the first user message (data injection) */}
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {messages.slice(1).map((msg, i) => (
                <div
                  key={i}
                  className={`text-sm rounded p-3 ${
                    msg.role === 'assistant'
                      ? 'bg-zinc-900 border border-zinc-800 text-gray-200'
                      : 'bg-zinc-950 text-gray-300'
                  }`}
                >
                  {msg.role === 'assistant' && <span className="text-xs text-gray-500 block mb-1">Coach</span>}
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Input or Saved */}
            {finalized ? (
              <div className="text-center py-3 space-y-2">
                <p className="text-green-400 text-sm">Session saved.</p>
                {savedSummary && <p className="text-gray-400 text-xs">{savedSummary}</p>}
                <ProfileProposals initial={proposals} />
              </div>
            ) : (
              <div className="space-y-2">
                {error && <p className="text-red-400 text-sm">{error}</p>}

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                    placeholder={turnCount >= 3 ? 'Last chance to clarify...' : 'Ask a follow-up...'}
                    disabled={loading}
                    className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-white text-sm"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={loading || !input.trim()}
                    className="bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 text-white px-4 py-2 rounded text-sm transition-colors"
                  >
                    Send
                  </button>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600">
                    Turn {turnCount}
                  </span>
                  <button
                    onClick={saveSession}
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 text-white text-sm px-4 py-1.5 rounded transition-colors"
                  >
                    Save Session
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
