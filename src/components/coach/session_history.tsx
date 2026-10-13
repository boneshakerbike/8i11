'use client';

/** Past coaching sessions, newest first, loaded the first time the list is opened. */

import { useEffect, useState } from 'react';
import { epoch_day_to_date_str } from '@/lib/coaching/day';
import { parseAdviceFull } from '@/lib/coaching/advice';

export interface HistorySession {
  date: number;
  advice_full: string;
  advice_summary: string | null;
  conversation_turns: number;
}

const PAGE = 10;

export default function SessionHistory({ open }: { open: boolean }) {
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    fetch(`/api/coaching/history?limit=${PAGE}&offset=0`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data) return;
        setHistory(data.sessions);
        setTotal(data.total);
        setLoaded(true);
      })
      .catch(() => { /* best effort */ });
  }, [open, loaded]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/coaching/history?limit=${PAGE}&offset=${history.length}`);
      if (res.ok) {
        const data = await res.json();
        setHistory(prev => [...prev, ...data.sessions]);
      }
    } catch { /* best effort */ }
    setLoadingMore(false);
  }

  if (!open || !loaded) return null;

  return (
    <div className="mb-6 space-y-2">
      {history.length === 0 && <p className="text-gray-500 text-sm">No past sessions.</p>}
      {history.map(s => {
        const { dataSnapshot, conversation } = parseAdviceFull(s.advice_full);
        return (
          <details key={s.date} className="bg-zinc-900 border border-zinc-800 rounded">
            <summary className="px-4 py-2 cursor-pointer text-sm text-gray-300 hover:text-white flex justify-between">
              <span>{epoch_day_to_date_str(s.date)}</span>
              <span className="text-gray-500">{s.conversation_turns} turn{s.conversation_turns !== 1 ? 's' : ''}</span>
            </summary>
            <div className="px-4 pb-3 space-y-2">
              {s.advice_summary && <p className="text-sm text-gray-300">{s.advice_summary}</p>}
              {dataSnapshot && (
                <details className="text-xs">
                  <summary className="text-gray-500 cursor-pointer">Metrics from this day</summary>
                  <div className="mt-1 text-gray-500 whitespace-pre-wrap bg-zinc-950 rounded p-2">{dataSnapshot}</div>
                </details>
              )}
              <details className="text-xs">
                <summary className="text-gray-500 cursor-pointer">Full conversation</summary>
                <div className="mt-1 text-gray-400 whitespace-pre-wrap">{conversation}</div>
              </details>
            </div>
          </details>
        );
      })}
      {history.length < total && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full text-sm text-gray-400 hover:text-white border border-zinc-700 px-3 py-2 rounded transition-colors disabled:opacity-50"
        >
          {loadingMore ? 'Loading...' : `Load more (${history.length} of ${total})`}
        </button>
      )}
    </div>
  );
}
