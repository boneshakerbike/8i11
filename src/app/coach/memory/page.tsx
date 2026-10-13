'use client'

/**
 * /coach/memory: what the coach reads before every session.
 * - The framework and biomarker targets, copied from Bill's Google Drive
 *   (refreshed by the daily job, or now with the button).
 * - His profile: facts about him, edited here. Every save is a new version.
 * Stored in the database only, never in the public repo.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import NavTabs from '@/components/nav_tabs'

interface MemoryDocumentView {
  kind: string
  label: string
  name: string
  loaded: boolean
  chars: number
  updated_at: number | null
  versions: number
  drive_url: string | null
  body: string | null
}

interface MemoryView {
  drive_connected: boolean
  documents: MemoryDocumentView[]
  profile: { body: string; is_default: boolean; versions: number; updated_at: number | null; max_chars: number }
}

const when = (s: number | null) =>
  s == null ? '' : new Date(s * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' })

const btn = 'text-sm px-3 py-2 rounded border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed'

export default function CoachMemoryPage() {
  const [data, setData] = useState<MemoryView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshResult, setRefreshResult] = useState<{ ok: boolean; detail: string } | null>(null)
  const [profile, setProfile] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/coaching/memory')
    const json = await res.json()
    if (!res.ok) return setError(json.error ?? `HTTP ${res.status}`)
    setData(json)
    setProfile(json.profile.body)
    setError(null)
  }, [])

  useEffect(() => {
    document.title = '8i11 | Coach memory'
    load().catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [load])

  async function refresh() {
    setRefreshing(true)
    setRefreshResult(null)
    try {
      const res = await fetch('/api/coaching/memory/refresh', { method: 'POST' })
      const json = await res.json()
      setRefreshResult({ ok: res.ok && json.ok, detail: json.detail ?? json.error ?? `HTTP ${res.status}` })
      await load()
    } catch (err) {
      setRefreshResult({ ok: false, detail: err instanceof Error ? err.message : String(err) })
    } finally {
      setRefreshing(false)
    }
  }

  async function save() {
    setSaving(true)
    setSaveResult(null)
    try {
      const res = await fetch('/api/coaching/memory/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: profile }),
      })
      const json = await res.json()
      setSaveResult(res.ok ? (json.changed ? 'Saved. The coach uses it from the next session.' : 'No changes to save.') : (json.error ?? `HTTP ${res.status}`))
      if (res.ok) await load()
    } catch (err) {
      setSaveResult(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const not_connected = (data != null && !data.drive_connected) || (refreshResult != null && !refreshResult.ok && /not connected|revoked|expired/i.test(refreshResult.detail))
  const p = data?.profile

  return (
    <main className="min-h-screen bg-black text-white">
      <NavTabs />
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Coach memory</h1>
          <Link href="/coach" className="text-sm text-gray-400 hover:text-white border border-zinc-700 px-3 py-1 rounded">Back to Coach</Link>
        </div>
        <p className="text-sm text-gray-400">
          The coach reads these before every session, plus your last 7 sessions. Where your framework differs from what you ask for, the framework wins.
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">Framework, from your Google Drive</h2>
          {data?.documents.map(d => (
            <div key={d.kind} className="text-sm space-y-1">
              <div className="flex justify-between gap-2">
                <span className="text-gray-200">{d.label}</span>
                <span className={d.loaded ? 'text-emerald-300' : 'text-amber-300'}>{d.loaded ? 'Loaded' : 'Not loaded yet'}</span>
              </div>
              <div className="text-xs text-gray-500 break-all">
                {d.name}
                {d.loaded && ` · ${d.chars.toLocaleString('en-US')} characters · copied ${when(d.updated_at)}`}
                {d.drive_url && <> · <a href={d.drive_url} target="_blank" rel="noreferrer" className="underline">open in Drive</a></>}
              </div>
              {d.body && (
                <details className="text-xs">
                  <summary className="text-gray-500 cursor-pointer">Show the text the coach reads</summary>
                  <div className="mt-1 text-gray-400 whitespace-pre-wrap bg-zinc-950 rounded p-2 max-h-80 overflow-y-auto">{d.body}</div>
                </details>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={refresh} disabled={refreshing || !data} className={btn}>{refreshing ? 'Refreshing...' : 'Refresh from Drive'}</button>
            {not_connected && <a href="/api/google/authorize" className={`${btn} text-cyan-400`}>Connect Google Drive</a>}
          </div>
          {refreshResult && <p className={`text-xs break-words ${refreshResult.ok ? 'text-gray-400' : 'text-red-300'}`}>{refreshResult.detail}</p>}
          {not_connected && <p className="text-xs text-gray-500">Google Drive is not connected. After connecting, Google returns you to the Say What? page; come back here and press Refresh from Drive.</p>}
          <p className="text-xs text-gray-500">The daily sync copies these every day at midday, so edits you make in Drive reach the coach by the next day.</p>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
          <div className="flex justify-between items-baseline gap-2">
            <h2 className="text-sm font-semibold text-white">Your profile</h2>
            {p && <span className="text-xs text-gray-500">{p.is_default ? 'Starting text, not saved yet' : `Saved ${when(p.updated_at)} · ${p.versions} version${p.versions === 1 ? '' : 's'}`}</span>}
          </div>
          <p className="text-xs text-gray-500">
            Facts about you the coach should always know: routine, injuries, equipment, safety rules. {p?.is_default && 'This starting text is the rules the coach already followed. Edit it and save to make it yours.'}
          </p>
          <textarea
            value={profile}
            onChange={e => setProfile(e.target.value)}
            rows={16}
            className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-sm text-gray-200 font-mono"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={save} disabled={saving || !p || !profile.trim() || profile.length > (p?.max_chars ?? 0)} className={btn}>
              {saving ? 'Saving...' : 'Save profile'}
            </button>
            <span className={`text-xs ${p && profile.length > p.max_chars ? 'text-red-300' : 'text-gray-500'}`}>
              {profile.length.toLocaleString('en-US')} / {(p?.max_chars ?? 0).toLocaleString('en-US')} characters
            </span>
          </div>
          {saveResult && <p className="text-xs text-gray-400">{saveResult}</p>}
        </section>
      </div>
    </main>
  )
}
