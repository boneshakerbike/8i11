'use client'

/**
 * COROS: training data synced through the official COROS MCP server.
 * The daily job syncs the last 7 days; "Sync now" does the same on demand.
 * Raw drill-down only: the coach reads COROS for training, Oura for recovery.
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import NavTabs from '@/components/nav_tabs'
import SyncStatus from '@/components/sync_status'

interface CorosDay {
  date: string
  steps: number | null
  stress_avg: number | null
  sleep_total_min: number | null
  hrv_avg: number | null
  hrv_status: string | null
  resting_hr: number | null
  load_short: number | null
  load_long: number | null
  load_ratio: number | null
  load_comment: string | null
  recovery_pct: number | null
  recovery_level: string | null
  vo2max: number | null
}

interface CorosActivity {
  label_id: string
  sport_name: string
  sport_type: number
  date: string
  duration_s: number | null
  distance_m: number | null
  sets: number | null
  avg_hr: number | null
  ascent_m: number | null
  descent_m: number | null
  location: string | null
  training_focus: string | null
}

interface CorosData {
  connected: boolean
  days: CorosDay[]
  activities: CorosActivity[]
}

const hm = (min: number | null) => (min == null ? '-' : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`)
const clock = (s: number | null) => {
  if (s == null) return ''
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}
const miles = (m: number | null) => (m == null ? '' : `${(m / 1609.34).toFixed(1)} mi`)
const feet = (m: number | null) => (m == null ? null : `${Math.round(m * 3.281)} ft`)
const short_date = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

/** COROS names custom sports "Sport(9806)"; the location label Bill gave it reads better. */
const activity_name = (a: CorosActivity) =>
  /^Sport\(\d+\)$/.test(a.sport_name) && a.location ? a.location : a.sport_name

const btn = 'text-sm px-3 py-2 rounded border border-white/15 hover:border-cyan-400/40 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed'

function CorosContent() {
  const params = useSearchParams()
  const url_error = params.get('error')
  const just_connected = params.get('connected') === '1'

  const [data, setData] = useState<CorosData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [sync_result, setSyncResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/coros/data?days=14')
    const json = await res.json()
    if (!res.ok) setError(json.error ?? `HTTP ${res.status}`)
    else { setData(json); setError(null) }
  }, [])

  useEffect(() => {
    document.title = '8i11 | COROS'
    load()
  }, [load])

  async function sync_now() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/coros/sync', { method: 'POST' })
      const json = await res.json()
      setSyncResult(json.detail ?? json.error ?? `HTTP ${res.status}`)
      await load()
    } catch (err) {
      setSyncResult(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  const today = data?.days.find(d => d.recovery_pct != null || d.vo2max != null)
  const latest_load = data?.days.find(d => d.load_ratio != null)

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-gray-200 p-4">
      <NavTabs />
      <div className="max-w-2xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold text-cyan-400">COROS</h1>
        <SyncStatus />

        {url_error && (
          <div className="p-3 rounded border border-red-400/40 bg-red-400/10 text-sm text-red-300 break-words">
            <div className="font-medium mb-1">COROS sign-in failed</div>
            {url_error}
          </div>
        )}
        {just_connected && !sync_result && (
          <div className="p-3 rounded border border-green-400/40 bg-green-400/10 text-sm text-green-300">
            Connected to COROS. Press Sync now to pull the last 7 days.
          </div>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="p-4 bg-[#0f0f1a] border border-white/10 rounded text-sm space-y-3">
          <div>
            <span className="text-gray-400">Connection: </span>
            <span className={data?.connected ? 'text-green-400' : 'text-yellow-400'}>
              {data ? (data.connected ? 'Connected' : 'Not connected') : 'Loading...'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/api/coros/authorize" className={`${btn} text-cyan-400`}>{data?.connected ? 'Reconnect COROS' : 'Connect COROS'}</a>
            <button onClick={sync_now} disabled={!data?.connected || syncing} className={btn}>{syncing ? 'Syncing...' : 'Sync now'}</button>
            <Link href="/health/coros/mcp" className={`${btn} text-gray-400`}>Connection test</Link>
          </div>
          {sync_result && <p className="text-xs text-gray-400 break-words">{sync_result}</p>}
        </div>

        {today && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {today.recovery_pct != null && (
              <span><span className="text-gray-400">Recovery: </span>{today.recovery_pct}%{today.recovery_level ? ` (${today.recovery_level})` : ''}</span>
            )}
            {today.vo2max != null && <span><span className="text-gray-400">VO2max: </span>{today.vo2max}</span>}
          </div>
        )}

        {data && data.days.length > 0 && (
          <div className="bg-[#0f0f1a] border border-white/10 rounded">
            <div className="px-3 py-2 text-sm text-cyan-400 border-b border-white/10">Last 14 days</div>
            <p className="px-3 pt-2 text-xs text-gray-500">Sleep is filed under the morning you woke up.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-400">
                  <tr>
                    <th className="text-left font-normal px-3 py-2">Day</th>
                    <th className="text-right font-normal px-2 py-2">Sleep</th>
                    <th className="text-right font-normal px-2 py-2">HRV</th>
                    <th className="text-right font-normal px-2 py-2">RHR</th>
                    <th className="text-right font-normal px-2 py-2">Steps</th>
                    <th className="text-right font-normal px-3 py-2">Stress</th>
                  </tr>
                </thead>
                <tbody>
                  {data.days.map(d => (
                    <tr key={d.date} className="border-t border-white/5">
                      <td className="px-3 py-1.5 whitespace-nowrap">{short_date(d.date)}</td>
                      <td className="text-right px-2 py-1.5 whitespace-nowrap">{hm(d.sleep_total_min)}</td>
                      <td className="text-right px-2 py-1.5" title={d.hrv_status ?? undefined}>{d.hrv_avg ?? '-'}</td>
                      <td className="text-right px-2 py-1.5">{d.resting_hr ?? '-'}</td>
                      <td className="text-right px-2 py-1.5">{d.steps?.toLocaleString() ?? '-'}</td>
                      <td className="text-right px-3 py-1.5">{d.stress_avg ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data && data.activities.length > 0 && (
          <div className="bg-[#0f0f1a] border border-white/10 rounded">
            <div className="px-3 py-2 text-sm text-cyan-400 border-b border-white/10">Activities</div>
            <ul className="divide-y divide-white/5 text-sm">
              {data.activities.map(a => {
                const parts = [
                  clock(a.duration_s),
                  miles(a.distance_m),
                  a.sets != null ? `${a.sets} sets` : '',
                  a.avg_hr != null ? `HR ${a.avg_hr}` : '',
                  feet(a.ascent_m) && `up ${feet(a.ascent_m)}`,
                  feet(a.descent_m) && `down ${feet(a.descent_m)}`,
                  a.training_focus ? `focus ${a.training_focus}` : '',
                ].filter(Boolean)
                return (
                  <li key={a.label_id} className="px-3 py-2">
                    <div className="flex justify-between gap-2">
                      <span className="text-white">{activity_name(a)}</span>
                      <span className="text-xs text-gray-500 whitespace-nowrap">{short_date(a.date)}</span>
                    </div>
                    <div className="text-xs text-gray-400">{parts.join(' · ')}</div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {latest_load && (
          <p className="text-xs text-gray-500">
            COROS training load ({short_date(latest_load.date)}): {latest_load.load_comment ?? '-'}, short {latest_load.load_short ?? '-'}, long {latest_load.load_long ?? '-'}, ratio {latest_load.load_ratio ?? '-'}. Shown for reference; the coach does not use device load scores.
          </p>
        )}

        {data && data.connected && data.days.length === 0 && (
          <p className="text-sm text-gray-500">No COROS data yet. Press Sync now.</p>
        )}
      </div>
    </div>
  )
}

export default function CorosPage() {
  return (
    <Suspense>
      <CorosContent />
    </Suspense>
  )
}
