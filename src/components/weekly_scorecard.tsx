'use client'

/**
 * This week against Bill's targets, from /api/coaching/scorecard.
 * Plain counting (src/lib/health/scorecard.ts); the coach reads the same rows.
 */

import { useEffect, useState } from 'react'
import type { Scorecard, ScoreStatus } from '@/lib/health/scorecard'

const STATUS: Record<ScoreStatus, { label: string; className: string }> = {
  done: { label: 'Done', className: 'text-green-300 bg-green-950 border-green-800' },
  on_track: { label: 'On track', className: 'text-emerald-300 bg-emerald-950/60 border-emerald-900' },
  behind: { label: 'Behind', className: 'text-amber-300 bg-amber-950 border-amber-800' },
  missed: { label: 'Missed', className: 'text-red-300 bg-red-950 border-red-800' },
  no_data: { label: 'No data', className: 'text-gray-400 bg-zinc-800 border-zinc-700' },
}

const short_date = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

export default function WeeklyScorecard() {
  const [card, setCard] = useState<Scorecard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/coaching/scorecard')
      .then(async res => {
        const json = await res.json()
        if (res.ok) setCard(json)
        else setError(json.error ?? `HTTP ${res.status}`)
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  if (error) return <p className="text-xs text-red-400 mb-4">Weekly scorecard: {error}</p>
  if (!card) return <p className="text-xs text-gray-500 mb-4">Loading this week...</p>

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg mb-5">
      <div className="px-4 py-2 border-b border-zinc-800 flex justify-between items-baseline gap-2">
        <span className="text-sm font-semibold text-white">This week</span>
        <span className="text-xs text-gray-500">{short_date(card.week_start)} to {short_date(card.week_end)}</span>
      </div>
      <ul className="divide-y divide-zinc-800">
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
    </div>
  )
}
