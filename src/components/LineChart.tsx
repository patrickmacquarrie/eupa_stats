import { useEffect, useRef, useState } from "react";

export interface Series { name: string; values: number[] }

interface Props {
  xLabels: string[];
  series: Series[];
  /** A dashed ink line that isn't a data series (e.g. the salary cap). */
  reference?: Series;
  format: (n: number) => string;
  height?: number;
  /** Highlight this x index (e.g. the selected week). */
  marker?: number;
}

const PAD = { top: 12, right: 16, bottom: 28, left: 64 };

function niceTicks(min: number, max: number, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return ticks;
}

/**
 * Multi-series line chart: series colours follow a fixed slot order (by series position, which
 * callers keep stable per entity), one y-axis, crosshair + tooltip listing every series.
 */
export function LineChart({ xLabels, series, reference, format, height = 260, marker }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = [...series, ...(reference ? [reference] : [])].flatMap((s) => s.values).filter(Number.isFinite);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const iw = width - PAD.left - PAD.right, ih = height - PAD.top - PAD.bottom;
  const n = xLabels.length;
  const x = (i: number) => PAD.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.top + ih - ((v - y0) / (y1 - y0)) * ih;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const labelEvery = Math.ceil(n / Math.max(2, Math.floor(iw / 48)));

  const onMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const i = n <= 1 ? 0 : Math.round(((px - PAD.left) / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const rows = hover === null ? [] : [
    ...series.map((s, i) => ({ name: s.name, v: s.values[hover], color: `var(--series-${(i % 8) + 1})`, dashed: false })),
    ...(reference ? [{ name: reference.name, v: reference.values[hover], color: "var(--text-primary)", dashed: true }] : []),
  ].sort((a, b) => b.v - a.v);

  return (
    <div className="chart" ref={wrap}>
      {series.length > 1 || reference ? (
        <ul className="legend">
          {series.map((s, i) => (
            <li key={s.name}><span className="key-line" style={{ background: `var(--series-${(i % 8) + 1})` }} />{s.name}</li>
          ))}
          {reference && <li><span className="key-line dashed" />{reference.name}</li>}
        </ul>
      ) : null}
      <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(", ")}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? "axis-zero" : "grid"} />
            <text x={PAD.left - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">{format(t)}</text>
          </g>
        ))}
        {xLabels.map((l, i) => (i % labelEvery === 0 || i === n - 1) && (
          <text key={i} x={x(i)} y={height - 8} className="tick" textAnchor="middle">{l}</text>
        ))}
        {marker !== undefined && marker < n && <line className="marker" x1={x(marker)} x2={x(marker)} y1={PAD.top} y2={PAD.top + ih} />}
        {reference && <path d={path(reference.values)} className="ref-line" />}
        {series.map((s, i) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={`var(--series-${(i % 8) + 1})`} strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hover !== null && (
          <g>
            <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} />
            {series.map((s, i) => Number.isFinite(s.values[hover]) && (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r={4} fill={`var(--series-${(i % 8) + 1})`}
                stroke="var(--surface-1)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: Math.min(x(hover) + 12, width - 200), top: PAD.top }}>
          <div className="tooltip-title">{xLabels[hover]}</div>
          {rows.map((r) => (
            <div key={r.name} className="tooltip-row">
              <span className={"key-line" + (r.dashed ? " dashed" : "")} style={r.dashed ? undefined : { background: r.color }} />
              <strong>{format(r.v)}</strong><span className="muted">{r.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
