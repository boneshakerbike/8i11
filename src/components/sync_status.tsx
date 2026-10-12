'use client'

/**
 * One line saying whether the daily health sync ran. Shown on the pages Bill
 * opens anyway, so a stopped job is noticed without checking Vercel logs.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Status {
  health: { level: 'ok' | 'problem' | 'late' | 'never'; message: string }
  coros_connected: boolean
}

export default function SyncStatus() {
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    fetch('/api/coaching/sync-status')
      .then(r => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  if (!status) return null
  const { health, coros_connected } = status
  const ok = health.level === 'ok' && coros_connected

  if (ok) {
    return (
      <p className="text-xs text-gray-500 mb-3 flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden="true" />
        {health.message}
      </p>
    )
  }

  return (
    <div role="status" className="mb-3 px-3 py-2 rounded border border-red-500/40 bg-red-500/10 text-xs text-red-300 space-y-1">
      {health.level !== 'ok' && <p>{health.message}</p>}
      {!coros_connected && (
        <p>
          COROS is not connected, so training data is not syncing.{' '}
          <Link href="/health/coros" className="underline hover:text-red-200">Connect COROS</Link>
        </p>
      )}
    </div>
  )
}
