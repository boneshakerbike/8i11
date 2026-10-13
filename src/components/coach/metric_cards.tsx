/** Today page metric tiles: value, trend arrow and sparkline, linking to the metric's history. */

import Link from 'next/link';

export interface TrendInfo {
  direction: 'up' | 'down' | 'stable';
  healthImpact: 'positive' | 'negative' | 'neutral';
  significant: boolean;
}

export function TrendArrow({ trend }: { trend?: TrendInfo }) {
  if (!trend) return null;
  if (!trend.significant || trend.direction === 'stable') {
    return <span className="text-xs ml-1 text-zinc-500">―</span>;
  }
  const arrow = trend.direction === 'up' ? '\u25B2' : '\u25BC';
  const color = trend.healthImpact === 'positive' ? 'text-green-400'
    : trend.healthImpact === 'negative' ? 'text-red-400'
    : 'text-gray-400';
  return <span className={`text-xs ml-1 ${color}`}>{arrow}</span>;
}

export function Sparkline({ data }: { data: (number | null)[] }) {
  const points = data.map((v, i) => ({ v, i })).filter(p => p.v != null) as { v: number; i: number }[];
  if (points.length < 2) return null;

  const W = 48, H = 16;
  const xs = points.map(p => p.i);
  const ys = points.map(p => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const toSVG = (i: number, v: number) => ({
    x: ((i - minX) / rangeX) * W,
    y: H - ((v - minY) / rangeY) * H,
  });

  const pts = points.map(p => {
    const { x, y } = toSVG(p.i, p.v);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg width={W} height={H} className="block mt-1" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function MetricCard({ label, value, unit, warn, trend, sparkline, href, className }: { label: string; value: unknown; unit?: string; warn?: boolean; trend?: TrendInfo; sparkline?: (number | null)[]; href?: string; className?: string }) {
  if (value === null || value === undefined) return null;
  const content = (
    <div className={`h-full flex flex-col bg-zinc-900 border ${warn ? 'border-yellow-600' : 'border-zinc-800'} rounded-lg px-3 py-2 ${href ? 'cursor-pointer hover:border-zinc-600 transition-colors' : ''}`}>
      <div className="text-xs text-gray-500 truncate">{label}</div>
      <div className="text-lg font-semibold text-white whitespace-nowrap">
        {String(value)}{unit && <span className="text-sm text-gray-400 ml-0.5">{unit}</span>}
        <TrendArrow trend={trend} />
      </div>
      {sparkline && <div className="mt-auto"><Sparkline data={sparkline} /></div>}
    </div>
  );
  if (href) {
    return <Link href={href} className={`h-full ${className ?? ''}`}>{content}</Link>;
  }
  return <div className={`h-full ${className ?? ''}`}>{content}</div>;
}
