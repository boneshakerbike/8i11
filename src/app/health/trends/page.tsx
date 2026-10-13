'use client';

/**
 * /health/trends: every metric the coach tracks over 90 days (daily) or a
 * year (weekly averages). Tap a chart for that metric's detail page.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import NavTabs from '@/components/nav_tabs';
import TrendChart from '@/components/trend_chart';
import type { TrendRange, TrendSeries } from '@/lib/health/trends-range';

const RANGES: { value: TrendRange; label: string }[] = [
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month_year = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`;

/** Sleep is stored in minutes; show hours and minutes. */
const show = (v: number, unit: string) =>
  unit === 'min' ? `${Math.floor(v / 60)}h ${Math.round(v % 60)}m` : `${v}${unit === '%' ? '%' : ` ${unit}`}`;

export default function TrendsPage() {
  const [range, setRange] = useState<TrendRange>(90);
  const [series, setSeries] = useState<TrendSeries[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { document.title = '8i11 | Trends'; }, []);

  useEffect(() => {
    fetch(`/api/coaching/trends/range?days=${range}`)
      .then(async res => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setSeries(json.series);
        setError(null);
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [range]);

  return (
    <main className="min-h-screen bg-black text-white">
      <NavTabs />
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Trends</h1>
          <Link href="/health" className="text-sm text-gray-400 hover:text-white border border-zinc-700 px-3 py-1 rounded">Today</Link>
        </div>

        <div className="flex gap-2">
          {RANGES.map(r => (
            <button
              key={r.value}
              onClick={() => { if (r.value !== range) { setSeries(null); setRange(r.value); } }}
              className={`px-3 py-1 text-sm rounded border transition-colors ${
                range === r.value ? 'bg-zinc-700 border-zinc-600 text-white' : 'bg-transparent border-zinc-800 text-gray-500 hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {range === 365 && <p className="text-xs text-gray-500">Each point is one week&apos;s average.</p>}

        {error && <p className="text-sm text-red-400">{error}</p>}
        {!series && !error && <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>}

        {series?.map(s => (
          <Link key={s.slug} href={`/coach/metric/${s.slug}`} className="block bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-lg p-4 transition-colors">
            <div className="flex justify-between items-baseline gap-2 mb-2">
              <span className="text-sm font-semibold text-white">{s.label}</span>
              {s.start != null && s.end != null && (
                <span className="text-xs text-gray-400">
                  {show(s.start, s.unit)} to {show(s.end, s.unit)} · avg {show(s.average!, s.unit)}
                </span>
              )}
            </div>
            <TrendChart data={s.points} average={s.average} higherIsBetter={s.higherIsBetter} xLabel={range === 365 ? month_year : undefined} />
          </Link>
        ))}
      </div>
    </main>
  );
}
