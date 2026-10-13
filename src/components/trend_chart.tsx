/** Line chart of one metric over time, with its average as a dashed line. */

export interface TrendChartPoint {
  dateStr: string;
  value: number;
}

export default function TrendChart({ data, average, higherIsBetter, xLabel = d => d.slice(5) }: {
  data: TrendChartPoint[];
  average: number | null;
  higherIsBetter: boolean;
  /** Axis label for a YYYY-MM-DD date; MM-DD by default. */
  xLabel?: (dateStr: string) => string;
}) {
  if (data.length === 0) {
    return <div className="text-gray-500 text-sm py-12 text-center">No data yet for this range.</div>;
  }

  const width = 600;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const values = data.map(d => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  const yMin = minVal - range * 0.1;
  const yMax = maxVal + range * 0.1;

  function x(i: number) {
    if (data.length === 1) return padding.left + chartW / 2;
    return padding.left + (i / (data.length - 1)) * chartW;
  }

  function y(val: number) {
    return padding.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH;
  }

  const points = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');

  // Y-axis labels (3 ticks)
  const yTicks = [yMin, (yMin + yMax) / 2, yMax].map(v => Math.round(v * 10) / 10);

  // X-axis labels (first, middle, last)
  const xLabels: { i: number; label: string }[] = [];
  if (data.length >= 1) xLabels.push({ i: 0, label: xLabel(data[0].dateStr) });
  if (data.length >= 3) xLabels.push({ i: Math.floor(data.length / 2), label: xLabel(data[Math.floor(data.length / 2)].dateStr) });
  if (data.length >= 2) xLabels.push({ i: data.length - 1, label: xLabel(data[data.length - 1].dateStr) });

  // Color the last point based on trend vs previous
  let lastPointColor = '#9ca3af'; // gray
  if (data.length >= 2) {
    const last = data[data.length - 1].value;
    const prev = data[data.length - 2].value;
    if (last > prev) lastPointColor = higherIsBetter ? '#4ade80' : '#f87171';
    else if (last < prev) lastPointColor = higherIsBetter ? '#f87171' : '#4ade80';
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-xl" preserveAspectRatio="xMidYMid meet">
      {/* Y-axis labels */}
      {yTicks.map((tick, i) => (
        <text key={i} x={padding.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle" className="fill-gray-500" fontSize="11">
          {tick}
        </text>
      ))}

      {/* X-axis labels */}
      {xLabels.map(({ i, label }) => (
        <text key={i} x={x(i)} y={height - 5} textAnchor="middle" className="fill-gray-500" fontSize="11">
          {label}
        </text>
      ))}

      {/* Average line */}
      {average != null && (
        <>
          <line x1={padding.left} y1={y(average)} x2={padding.left + chartW} y2={y(average)} stroke="#525252" strokeDasharray="4 4" strokeWidth="1" />
          <text x={padding.left + chartW + 4} y={y(average)} dominantBaseline="middle" className="fill-gray-500" fontSize="10">
            avg
          </text>
        </>
      )}

      {/* Line */}
      <polyline points={points} fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinejoin="round" />

      {/* Data points */}
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.value)} r={i === data.length - 1 ? 5 : 3} fill={i === data.length - 1 ? lastPointColor : '#60a5fa'} />
      ))}
    </svg>
  );
}
