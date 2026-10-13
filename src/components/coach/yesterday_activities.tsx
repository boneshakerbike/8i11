'use client';

/**
 * Yesterday's activities from COROS, the same source and wording the coach
 * reads in the daily brief (was Ride with GPS, which misses strength and
 * custom-sport rides). Reloads when `refresh` changes, after a COROS sync.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { mt_date_str, shift_date } from '@/lib/coaching/day';
import type { StoredCorosActivity } from '@/lib/coros/data';
import { activity_summary, type ActivitySummary } from '@/lib/health/daily-brief';

export default function YesterdayActivities({ refresh = 0 }: { refresh?: number }) {
  const [items, setItems] = useState<ActivitySummary[] | null>(null);

  useEffect(() => {
    const yesterday = shift_date(mt_date_str(), 1);
    fetch('/api/coros/data?days=2')
      .then(res => (res.ok ? res.json() : null))
      .then((data: { activities?: StoredCorosActivity[] } | null) => {
        if (!data) return;
        setItems((data.activities ?? []).filter(a => a.date === yesterday).map(activity_summary));
      })
      .catch(() => { /* best effort: the card stays as it was */ });
  }, [refresh]);

  if (items == null) return null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>Yesterday&apos;s Activities</span>
        <Link href="/health/coros" className="hover:text-white">COROS</Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">No activities in COROS for yesterday.</p>
      ) : (
        <div className="space-y-1">
          {items.map((a, i) => (
            <div key={i} className="text-sm">
              <span className="text-white">{a.name}</span>
              {a.parts.length > 0 && <span className="text-gray-400 ml-2">{a.parts.join(' · ')}</span>}
              {a.flags.map(f => <div key={f} className="text-xs text-amber-300">{f}</div>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
