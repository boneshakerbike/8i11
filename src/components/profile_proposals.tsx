'use client'

/**
 * Profile edits the coach proposed after a session. Each one is accepted
 * (saved to the profile as a new version) or rejected; nothing changes the
 * profile until Bill accepts. After each answer the list is replaced with the
 * server's, which leaves out suggestions the answer made stale. Hidden when
 * there is nothing to answer or report.
 */

import { useEffect, useState } from 'react'
import type { ProfileProposal } from '@/lib/coaching/memory'

const ACTION_LABEL = { add: 'Add', change: 'Change', remove: 'Remove' } as const

const btn = 'text-xs px-3 py-1.5 rounded border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed'

export default function ProfileProposals({ initial, onDecided }: {
  /** Proposals just returned by a save; fetched when absent. */
  initial?: ProfileProposal[]
  /** Called after an accepted edit changed the profile. */
  onDecided?: () => void
}) {
  const [items, setItems] = useState<ProfileProposal[]>(initial ?? [])
  const [busy, setBusy] = useState<number | null>(null)
  // One line for the box: the item it was about may have just left the list
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (initial) { setItems(initial); return }
    fetch('/api/coaching/memory/proposals')
      .then(r => (r.ok ? r.json() : { proposals: [] }))
      .then(j => setItems(j.proposals ?? []))
      .catch(() => setItems([]))
  }, [initial])

  async function decide(p: ProfileProposal, accept: boolean) {
    setBusy(p.id)
    setNotice(null)
    try {
      const res = await fetch(`/api/coaching/memory/proposals/${p.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept }),
      })
      const json = await res.json().catch(() => ({}))
      if (Array.isArray(json.proposals)) setItems(json.proposals)
      else if (res.ok) setItems(list => list.filter(x => x.id !== p.id))
      if (!res.ok) {
        setNotice(json.error ?? `HTTP ${res.status}`)
        return
      }
      if (accept && json.profile_saved) onDecided?.()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  if (items.length === 0 && !notice) return null

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3 text-left">
      <h2 className="text-sm font-semibold text-white">Suggested profile changes</h2>
      <p className="text-xs text-gray-500">The coach suggests these from your sessions. Nothing changes until you accept.</p>
      {notice && <p className="text-xs text-red-300">{notice}</p>}
      {items.length === 0 && <p className="text-xs text-gray-500">No suggestions left to answer.</p>}
      {items.map(p => (
        <div key={p.id} className="border-t border-zinc-800 pt-3 space-y-1 text-sm">
          <div className="text-xs text-gray-500">{ACTION_LABEL[p.action]} · from {p.session_date}</div>
          {p.old_text && <div className={p.action === 'remove' ? 'text-red-300 line-through' : 'text-gray-500 line-through'}>{p.old_text}</div>}
          {p.new_text && <div className="text-emerald-300">{p.new_text}</div>}
          <div className="text-xs text-gray-400">Why: {p.reason}</div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => decide(p, true)} disabled={busy != null} className={`${btn} text-emerald-300`}>Accept</button>
            <button onClick={() => decide(p, false)} disabled={busy != null} className={btn}>Reject</button>
          </div>
        </div>
      ))}
    </section>
  )
}
