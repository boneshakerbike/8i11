/**
 * Oura Dashboard - Clean, minimal Oura Ring data
 * Matches COROS page style: essentials summary, native <details>, no emoji
 */

'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import NavTabs from '@/components/nav_tabs';
import { primary_sleep } from '@/lib/health/oura-derive';

interface OuraData {
  date: string;
  cached?: boolean;
  sleep: Record<string, unknown> | null;
  readiness: Record<string, unknown> | null;
  activity: Record<string, unknown> | null;
  stress: Record<string, unknown> | null;
  spo2: Record<string, unknown> | null;
  sleep_detail: Record<string, unknown>[] | null;
  heartrate: Record<string, unknown>[] | null;
  workouts: Record<string, unknown>[] | null;
  sessions: Record<string, unknown>[] | null;
  scores: {
    sleep: number | null;
    readiness: number | null;
    activity: number | null;
    stress_high: number | null;
    recovery_high: number | null;
    hrv_average: number | null;
    resting_hr: number | null;
    spo2_average: number | null;
    steps: number | null;
    active_calories: number | null;
  };
}

interface RangeSnapshot {
  sleep_detail: Record<string, unknown>[] | null;
}

function format_duration(seconds: number | null | undefined): string {
  if (seconds == null) return '\u2014';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function format_hours(seconds: number | null | undefined): string {
  if (seconds == null) return '\u2014';
  const hours = seconds / 3600;
  return `${hours.toFixed(1)}h`;
}

function day_summary_label(summary: string | null | undefined): { label: string; color: string } {
  if (!summary) return { label: '\u2014', color: 'text-gray-400' };
  const s = summary.toLowerCase();
  if (s === 'restored') return { label: 'Restored', color: 'text-green-400' };
  if (s === 'normal') return { label: 'Normal', color: 'text-yellow-400' };
  if (s === 'stressful') return { label: 'Stressful', color: 'text-red-400' };
  return { label: summary, color: 'text-gray-400' };
}

function compute_sleep_debt(snapshots: RangeSnapshot[]): { hours: number; minutes: number; surplus: boolean } | null {
  let total_deficit_seconds = 0;
  let days_with_data = 0;

  for (const snap of snapshots) {
    const detail = primary_sleep(snap.sleep_detail);
    if (!detail) continue;
    const total_sleep = detail.total_sleep_duration as number | undefined;
    if (total_sleep == null) continue;
    days_with_data++;
    total_deficit_seconds += (28800 - total_sleep);
  }

  if (days_with_data === 0) return null;
  const surplus = total_deficit_seconds < 0;
  const abs_seconds = Math.abs(total_deficit_seconds);
  return {
    hours: Math.floor(abs_seconds / 3600),
    minutes: Math.floor((abs_seconds % 3600) / 60),
    surplus,
  };
}

function build_report_markdown(data: OuraData, sleep_period: Record<string, unknown> | null, sleep_debt: { hours: number; minutes: number; surplus: boolean } | null): string {
  const lines: string[] = [];
  const scores = data.scores;
  const stress = data.stress as Record<string, unknown> | null;
  const day_summary = stress?.day_summary as string | null | undefined;

  lines.push(`# Oura Report \u2014 ${data.date}`);
  lines.push('');
  lines.push('## Essentials');
  lines.push(`- Readiness Score: ${scores.readiness ?? '\u2014'}`);
  lines.push(`- HRV: ${scores.hrv_average != null ? scores.hrv_average + ' ms' : '\u2014'}`);
  lines.push(`- Sleep Score: ${scores.sleep ?? '\u2014'}`);

  if (sleep_period) {
    lines.push(`- Total Sleep: ${format_hours(sleep_period.total_sleep_duration as number)}`);
    lines.push(`- Deep Sleep: ${format_hours(sleep_period.deep_sleep_duration as number)}`);
  }

  lines.push(`- SpO2: ${scores.spo2_average != null ? scores.spo2_average + '%' : '\u2014'}`);
  lines.push(`- Lowest HR: ${scores.resting_hr != null ? scores.resting_hr + ' bpm' : '\u2014'}`);

  if (day_summary) {
    const stress_info = day_summary_label(day_summary);
    lines.push(`- Stress: ${stress_info.label}`);
    if (scores.stress_high != null) lines.push(`  - High Stress: ${format_duration(scores.stress_high)}`);
    if (scores.recovery_high != null) lines.push(`  - Recovery: ${format_duration(scores.recovery_high)}`);
  }

  if (sleep_debt) {
    const debt_str = sleep_debt.hours > 0 ? `${sleep_debt.hours}h ${sleep_debt.minutes}m` : `${sleep_debt.minutes}m`;
    lines.push(`- Sleep Debt: ${debt_str} ${sleep_debt.surplus ? 'surplus' : 'deficit'} (14d)`);
  }

  lines.push(`- Activity Score: ${scores.activity ?? '\u2014'}`);

  return lines.join('\n');
}

export default function OuraPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#1a1a2e] text-gray-200 p-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-center text-gray-400 py-12">Loading...</div>
        </div>
      </div>
    }>
      <OuraContent />
    </Suspense>
  );
}

function OuraContent() {
  const [connected, set_connected] = useState<boolean | null>(null);
  const [loading, set_loading] = useState(true);
  const [syncing, set_syncing] = useState(false);
  const [data, set_data] = useState<OuraData | null>(null);
  const [sleep_debt, set_sleep_debt] = useState<{ hours: number; minutes: number; surplus: boolean } | null>(null);
  const [selected_date, set_selected_date] = useState(new Date().toLocaleDateString('en-CA'));
  const [error, set_error] = useState<string | null>(null);
  const [toast, set_toast] = useState<string | null>(null);
  const [copied_section, set_copied_section] = useState<string | null>(null);

  const search_params = useSearchParams();

  useEffect(() => {
    document.title = '8i11 | Oura';
    const connected_param = search_params.get('connected');
    const error_param = search_params.get('error');
    if (connected_param === 'true') {
      set_toast('Oura Ring connected!');
      setTimeout(() => set_toast(null), 4000);
    }
    if (error_param) {
      set_error(`Connection failed: ${error_param}`);
    }
    fetch_data(new Date().toLocaleDateString('en-CA'));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch_data defined in component body, intentionally excluded
  }, [search_params]);

  async function fetch_data(date: string) {
    set_loading(true);
    set_error(null);
    try {
      const res = await fetch(`/api/oura/data?date=${date}`);
      const json = await res.json();
      if (json.connected === false) {
        set_connected(false);
        set_data(null);
      } else if (json.success) {
        set_connected(true);
        set_data(json);
        fetch_sleep_debt(date);
      } else {
        set_error(json.error || 'Unknown error');
      }
    } catch (err) {
      set_error('Failed to fetch Oura data');
      console.error(err);
    } finally {
      set_loading(false);
    }
  }

  async function fetch_sleep_debt(date: string) {
    try {
      const res = await fetch(`/api/oura/data?date=${date}&range=14`);
      const json = await res.json();
      if (json.success && json.snapshots) {
        const debt = compute_sleep_debt(json.snapshots as RangeSnapshot[]);
        set_sleep_debt(debt);
      }
    } catch {
      // Non-critical
    }
  }

  async function handle_sync(force = false) {
    set_syncing(true);
    try {
      const res = await fetch('/api/oura/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 7, force }),
      });
      const json = await res.json();
      if (json.success) {
        set_toast(`Synced ${json.synced} day${json.synced !== 1 ? 's' : ''}${json.skipped ? `, ${json.skipped} already cached` : ''}`);
        fetch_data(selected_date);
      } else {
        set_toast(`Sync error: ${json.error}`);
      }
    } catch {
      set_toast('Sync failed');
    } finally {
      set_syncing(false);
      setTimeout(() => set_toast(null), 4000);
    }
  }

  async function handle_disconnect() {
    if (!confirm('Disconnect your Oura Ring account?')) return;
    try {
      await fetch('/api/oura/disconnect', { method: 'DELETE' });
      set_connected(false);
      set_data(null);
      set_toast('Oura Ring disconnected');
      setTimeout(() => set_toast(null), 3000);
    } catch (err) {
      console.error('Disconnect failed:', err);
    }
  }

  function handle_date_change(date: string) {
    set_selected_date(date);
    fetch_data(date);
  }

  function copy_section(name: string, content: string) {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      navigator.clipboard.writeText(content);
      set_copied_section(name);
      setTimeout(() => set_copied_section(null), 1500);
    };
  }

  const scores = data?.scores;
  const sleep_period = data ? primary_sleep(data.sleep_detail) : null;
  const stress = data?.stress as Record<string, unknown> | null;
  const day_summary = stress?.day_summary as string | null | undefined;
  const summary_style = day_summary_label(day_summary);

  // Sleep debt display
  let sleep_debt_display: string | null = null;
  let sleep_debt_label: string | undefined;
  if (sleep_debt) {
    sleep_debt_display = sleep_debt.hours > 0 ? `${sleep_debt.hours}h ${sleep_debt.minutes}m` : `${sleep_debt.minutes}m`;
    sleep_debt_label = sleep_debt.surplus ? 'surplus (14d)' : 'deficit (14d)';
  }

  const report_md = data ? build_report_markdown(data, sleep_period, sleep_debt) : '';

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-gray-200 p-4">
      <NavTabs />
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-cyan-400">Oura</h1>
          {connected && (
            <button
              onClick={handle_disconnect}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-red-400 border border-white/10 hover:border-red-400/30 rounded transition-all"
            >
              Disconnect
            </button>
          )}
        </div>

        {toast && (
          <div className="mb-4 p-3 bg-green-500/20 border border-green-500/30 rounded text-sm text-green-400 text-center">
            {toast}
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded text-sm text-red-400 text-center">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-gray-400 text-sm">Loading...</p>
        ) : connected === false ? (
          <div className="text-center py-16 border border-white/10 rounded-lg">
            <h2 className="text-lg font-medium text-gray-200 mb-2">Connect Your Oura Ring</h2>
            <p className="text-gray-400 text-sm mb-6 max-w-md mx-auto">
              Link your Oura account to see sleep, readiness, activity, stress, HRV, and more.
            </p>
            <a
              href="/api/oura/authorize"
              className="inline-block px-6 py-3 bg-cyan-500 hover:bg-cyan-600 rounded-lg font-medium transition-all"
            >
              Connect Oura Ring
            </a>
          </div>
        ) : (
          <>
            {/* Date picker + Sync */}
            <div className="mb-4 flex items-center gap-3 flex-wrap">
              <label className="text-sm text-gray-400">Date:</label>
              <input
                type="date"
                value={selected_date}
                onChange={(e) => handle_date_change(e.target.value)}
                className="bg-[#0f0f1a] border border-white/20 rounded px-2 py-1 text-gray-200 text-sm [color-scheme:dark]"
              />
              <button
                onClick={() => handle_sync(false)}
                disabled={syncing}
                className="px-3 py-1 text-sm bg-white/5 border border-white/10 rounded hover:border-cyan-400/30 hover:text-cyan-400 disabled:opacity-50 transition-all"
              >
                {syncing ? 'Syncing...' : 'Sync 7 Days'}
              </button>
              <button
                onClick={() => handle_sync(true)}
                disabled={syncing}
                className="px-3 py-1 text-sm bg-white/5 border border-white/10 rounded hover:border-orange-400/30 hover:text-orange-400 disabled:opacity-50 transition-all"
                title="Re-fetch and overwrite cached data"
              >
                Force
              </button>
              {data?.cached && (
                <span className="text-xs text-gray-500">cached</span>
              )}
            </div>

            {/* Oura Essentials */}
            <div className="mb-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <Metric label="Readiness Score" value={scores?.readiness} />
                <Metric label="HRV" value={scores?.hrv_average != null ? `${scores.hrv_average} ms` : null} />
                <Metric label="Sleep Score" value={scores?.sleep} />
                <Metric label="Total Sleep" value={sleep_period ? format_hours(sleep_period.total_sleep_duration as number) : null} />
                <Metric label="Deep Sleep" value={sleep_period ? format_hours(sleep_period.deep_sleep_duration as number) : null} />
                <Metric label="SpO2" value={scores?.spo2_average != null ? `${scores.spo2_average}%` : null} />
                <Metric label="Lowest HR" value={scores?.resting_hr != null ? `${scores.resting_hr} bpm` : null} />
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-gray-400">Stress</span>
                  <span className={summary_style.color}>{summary_style.label}</span>
                </div>
                {scores?.stress_high != null && (
                  <Metric label="High Stress" value={format_duration(scores.stress_high)} />
                )}
                {scores?.recovery_high != null && (
                  <Metric label="Recovery Time" value={format_duration(scores.recovery_high)} />
                )}
                {sleep_debt_display && (
                  <Metric label="Sleep Debt" value={`${sleep_debt_display} ${sleep_debt_label}`} />
                )}
                <Metric label="Activity Score" value={scores?.activity} />
              </div>
            </div>

            {/* Report Markdown */}
            {report_md && (
              <details className="mb-3 bg-[#0f0f1a] border border-white/10 rounded">
                <summary className="cursor-pointer flex justify-between items-center px-3 py-2 text-sm text-cyan-400">
                  <span>Report Markdown</span>
                  <button
                    onClick={copy_section('report', report_md)}
                    className="text-xs text-cyan-400 hover:text-cyan-300 px-2 py-1 border border-white/10 rounded"
                  >
                    {copied_section === 'report' ? 'Copied!' : 'Copy'}
                  </button>
                </summary>
                <pre className="text-xs text-gray-300 p-3 overflow-x-auto whitespace-pre-wrap">
                  {report_md}
                </pre>
              </details>
            )}

            {/* Raw JSON */}
            <details className="mb-3 bg-[#0f0f1a] border border-white/10 rounded">
              <summary className="cursor-pointer flex justify-between items-center px-3 py-2 text-sm text-cyan-400">
                <span>Raw JSON</span>
                <button
                  onClick={copy_section('raw', JSON.stringify(data, null, 2))}
                  className="text-xs text-cyan-400 hover:text-cyan-300 px-2 py-1 border border-white/10 rounded"
                >
                  {copied_section === 'raw' ? 'Copied!' : 'Copy'}
                </button>
              </summary>
              <pre className="text-xs text-gray-300 p-3 overflow-x-auto">
                {JSON.stringify(data, null, 2)}
              </pre>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between py-1 border-b border-white/5">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-200">{value ?? '\u2014'}</span>
    </div>
  );
}
