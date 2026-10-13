'use client'

/**
 * This week against Bill's targets, from /api/coaching/scorecard.
 * Plain counting (src/lib/health/scorecard.ts); the coach reads the same rows.
 * Collapsed to one summary line by default, naming anything behind or missed;
 * tap to see every row. The open/closed choice is remembered on this device.
 */

import { useEffect, useState } from 'react'
import { scorecard_summary, type Scorecard, type ScoreStatus, type ScorecardSummary } from '@/lib/health/scorecard'

const STATUS: Record<ScoreStatus, { label: string; className: string }> = {
  done: { label: 'Done', className: 'text-green-300 bg-green-950 border-green-800' },
  on_track: { label: 'On track', className: 'text-emerald-300 bg-emerald-950/60 border-emerald-900' },
  behind: { label: 'Behind', className: 'text-amber-300 bg-amber-950 border-amber-800' },
  missed: { label: 'Not met', className: 'text-red-300 bg-red-950 border-red-800' },
  no_data: { label: 'No data', className: 'text-gray-400 bg-zinc-800 border-zinc-700' },
}

const LEVEL: Record<ScorecardSummary['level'], string> = {
  good: 'text-emerald-300',
  behind: 'text-amber-300',
  missed: 'text-red-300',
}

const OPEN_KEY = 'weekly_scorecard_open'

const short_date = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

/** `refresh`: bump it to reload, e.g. after a COROS sync saved new data. */
export default function WeeklyScorecard({ refresh = 0 }: { refresh?: number }) {
  const [card, setCard] = useState<Scorecard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetch('/api/coaching/scorecard')
      .then(async res => {
        const json = await res.json()
        if (!res.ok) return setError(json.error ?? `HTTP ${res.status}`)
        // The box shows once the data is here, so read the remembered choice now
        try {
          setOpen(localStorage.getItem(OPEN_KEY) === '1')
        } catch {
          // Storage blocked: stay collapsed
        }
        setCard(json)
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [refresh])

  function toggle() {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0')
    } catch {
      // Storage blocked: the choice lasts until the page reloads
    }
  }

  if (error) return <p className="text-xs text-red-400 mb-4">Weekly scorecard: {error}</p>
  if (!card) return <p className="text-xs text-gray-500 mb-4">Loading this week...</p>

  const summary = scorecard_summary(card.rows)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg mb-5">
      <button onClick={toggle} aria-expanded={open} className="w-full text-left px-4 py-2">
        <div className="flex justify-between items-center gap-2">
          <span className="text-sm">
            <span className="font-semibold text-white">This week</span>
            <span className={`ml-2 ${LEVEL[summary.level]}`}>{summary.ok} of {summary.judged} on track</span>
          </span>
          <span className={`text-xs text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        </div>
        {summary.missed.length > 0 && <div className="text-xs text-red-300">Not met: {summary.missed.join('; ')}</div>}
        {summary.behind.length > 0 && <div className="text-xs text-amber-300">Behind: {summary.behind.join('; ')}</div>}
      </button>

      {open && (
        <>
          <div className="px-4 py-1 border-t border-zinc-800 text-xs text-gray-500">
            {short_date(card.week_start)} to {short_date(card.week_end)}
          </div>
          <ul className="divide-y divide-zinc-800 border-t border-zinc-800">
            {card.rows.map(r => (
              <li key={r.key} className="px-4 py-2">
                <div className="flex justify-between items-center gap-3">
                  <span className="text-sm text-gray-200">{r.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-sm text-white text-right">{r.value}</span>
                    <span className={`text-xs px-2 py-0.5 rounded border whitespace-nowrap ${STATUS[r.status].className}`}>{STATUS[r.status].label}</span>
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  Target: {r.target}{r.note ? ` · ${r.note}` : ''}
                </div>
              </li>
            ))}
          </ul>
          <p className="px-4 py-2 border-t border-zinc-800 text-xs text-gray-500">
            Monday to Sunday. On track means at the pace needed through yesterday, so today never counts against you.
          </p>
        </>
      )}
    </div>
  )
}
