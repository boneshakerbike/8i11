'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import NavTabs from '@/components/nav_tabs';
import TrendChart from '@/components/trend_chart';

interface DataPoint {
  date: number;
  dateStr: string;
  value: number;
}

interface MetricData {
  slug: string;
  label: string;
  unit: string;
  higherIsBetter: boolean;
  range: number;
  average: number | null;
  dataPoints: DataPoint[];
}

export default function MetricDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<MetricData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(7);

  useEffect(() => {
    if (data) {
      document.title = `8i11 | ${data.label} Trend`;
    }
  }, [data]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/coaching/metrics/${slug}?range=${range}`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch {
        // best effort
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [slug, range]);

  const ranges = [
    { value: 7, label: 'Week' },
    { value: 30, label: 'Month' },
    { value: 90, label: '90 days' },
  ];

  return (
    <main className="min-h-screen bg-black text-white">
      <NavTabs />
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/health" className="text-gray-400 hover:text-white text-sm">&larr; Today</Link>
          <h1 className="text-xl font-bold">{data?.label || slug}</h1>
        </div>

        {/* Range selector */}
        <div className="flex gap-2 mb-4">
          {ranges.map(r => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1 text-sm rounded border transition-colors ${
                range === r.value
                  ? 'bg-zinc-700 border-zinc-600 text-white'
                  : 'bg-transparent border-zinc-800 text-gray-500 hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-gray-500 text-sm py-12 text-center">Loading...</div>
        ) : data ? (
          <div className="space-y-4">
            {/* Chart */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <TrendChart data={data.dataPoints} average={data.average} higherIsBetter={data.higherIsBetter} />
            </div>

            {/* Summary stats */}
            {data.dataPoints.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-500">Latest</div>
                  <div className="text-lg font-semibold text-white">
                    {data.dataPoints[data.dataPoints.length - 1].value}
                    <span className="text-sm text-gray-400 ml-0.5">{data.unit}</span>
                  </div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-500">Average</div>
                  <div className="text-lg font-semibold text-white">
                    {data.average}
                    <span className="text-sm text-gray-400 ml-0.5">{data.unit}</span>
                  </div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-500">Data points</div>
                  <div className="text-lg font-semibold text-white">{data.dataPoints.length}</div>
                </div>
              </div>
            )}

            {/* Raw values table */}
            {data.dataPoints.length > 0 && (
              <details className="text-sm">
                <summary className="text-gray-500 cursor-pointer text-xs">Raw values</summary>
                <div className="mt-2 space-y-1">
                  {[...data.dataPoints].reverse().map(d => (
                    <div key={d.date} className="flex justify-between text-gray-400 text-xs">
                      <span>{d.dateStr}</span>
                      <span>{d.value} {data.unit}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ) : (
          <div className="text-gray-500 text-sm py-12 text-center">Metric not found.</div>
        )}
      </div>
    </main>
  );
}
