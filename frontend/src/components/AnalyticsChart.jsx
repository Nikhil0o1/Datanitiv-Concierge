import { useCallback, useId, useMemo, useRef, useState } from 'react';

const VB_W = 560;
const VB_H = 200;

function scaleSeries(values, padTop, padBottom) {
  const inner = VB_H - padTop - padBottom;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  return values.map((v) => padTop + inner - ((v - min) / span) * inner);
}

function fmtAxis(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1 && n > 0) return n.toFixed(2);
  return String(Math.round(n));
}

function fmtVal(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  if (Number.isInteger(n) || n >= 100) return n.toLocaleString();
  if (n < 0.01 && n > 0) return n.toFixed(4);
  if (n < 1) return n.toFixed(2);
  return String(Math.round(n * 10) / 10);
}

function fmtTime(iso, range) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (range === '7d' || range === '30d' || range === '90d') {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function linePath(yScaled, padX, count) {
  if (!count) return '';
  const step = count > 1 ? (VB_W - padX * 2) / (count - 1) : 0;
  return yScaled.map((y, i) => `${i === 0 ? 'M' : 'L'} ${padX + i * step} ${y}`).join(' ');
}

function areaPath(yScaled, padX, count) {
  if (!count) return '';
  const line = linePath(yScaled, padX, count);
  const step = count > 1 ? (VB_W - padX * 2) / (count - 1) : 0;
  const lastX = padX + (count - 1) * step;
  const baseY = VB_H - 32;
  return `${line} L ${lastX} ${baseY} L ${padX} ${baseY} Z`;
}

function xAtIndex(idx, padX, count) {
  if (count <= 1) return padX;
  const step = (VB_W - padX * 2) / (count - 1);
  return padX + idx * step;
}

export function LineChart({ title, series, range, points }) {
  const uid = useId().replace(/:/g, '');
  const padX = 44;
  const padTop = 16;
  const padBottom = 32;
  const count = series[0]?.values?.length || 0;
  const bodyRef = useRef(null);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });

  const xLabels = useMemo(() => {
    if (!count) return [];
    const fmt = (iso) => {
      const d = new Date(iso);
      if (range === '7d' || range === '30d' || range === '90d') {
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    };
    const indices = count <= 6 ? [...Array(count).keys()] : [0, Math.floor(count / 3), Math.floor((2 * count) / 3), count - 1];
    return indices.map((i) => ({ i, label: series[0]?.labels?.[i] ? fmt(series[0].labels[i]) : '' }));
  }, [count, range, series]);

  const allVals = series.flatMap((s) => s.values);
  const yMax = Math.max(...allVals, 1);
  const yTicks = [0, yMax * 0.5, yMax];

  const pickIndex = useCallback(
    (clientX) => {
      const el = bodyRef.current;
      if (!el || count < 1) return null;
      const rect = el.getBoundingClientRect();
      const relX = clientX - rect.left;
      const padPx = (padX / VB_W) * rect.width;
      const innerW = rect.width - padPx - (8 / VB_W) * rect.width;
      if (innerW <= 0) return 0;
      const ratio = Math.max(0, Math.min(1, (relX - padPx) / innerW));
      return Math.round(ratio * (count - 1));
    },
    [count],
  );

  const onMove = useCallback(
    (e) => {
      const idx = pickIndex(e.clientX);
      if (idx == null) return;
      setHoverIdx(idx);
      const rect = bodyRef.current?.getBoundingClientRect();
      if (rect) {
        setTipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
    },
    [pickIndex],
  );

  const onLeave = useCallback(() => setHoverIdx(null), []);

  const hoverX = hoverIdx != null ? xAtIndex(hoverIdx, padX, count) : null;
  const pt = hoverIdx != null && points?.[hoverIdx] ? points[hoverIdx] : null;

  return (
    <div className="ax-chart">
      <div className="ax-chart-head">
        <div className="ax-chart-title">{title}</div>
        {series.length > 1 && (
          <div className="ax-legend">
            {series.map((s) => (
              <span key={s.name} className="ax-legend-item">
                <span className="ax-legend-dot" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div
        className="ax-chart-body ax-chart-interactive"
        ref={bodyRef}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="ax-chart-svg" preserveAspectRatio="none">
          <defs>
            {series.map((s) => (
              <linearGradient key={s.name} id={`grad-${uid}-${s.name.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.32" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {yTicks.map((tick, ti) => {
            const y = scaleSeries([tick], padTop, padBottom)[0];
            return (
              <g key={ti}>
                <line x1={padX} x2={VB_W - 8} y1={y} y2={y} className="ax-grid-line" />
                <text x={6} y={y + 4} className="ax-axis-label">
                  {fmtAxis(tick)}
                </text>
              </g>
            );
          })}
          {series.map((s, si) => {
            const ys = scaleSeries(s.values, padTop, padBottom);
            const path = linePath(ys, padX, count);
            const area = areaPath(ys, padX, count);
            const gradId = `grad-${uid}-${s.name.replace(/\s/g, '')}`;
            if (!path) return null;
            return (
              <g key={s.name}>
                {si === 0 && area && <path d={area} fill={`url(#${gradId})`} stroke="none" />}
                <path d={path} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" className="ax-line" />
                {hoverIdx != null && (
                  <circle
                    cx={xAtIndex(hoverIdx, padX, count)}
                    cy={ys[hoverIdx]}
                    r="4.5"
                    fill={s.color}
                    stroke="#09090b"
                    strokeWidth="2"
                  />
                )}
              </g>
            );
          })}
          {hoverX != null && (
            <line x1={hoverX} x2={hoverX} y1={padTop} y2={VB_H - padBottom} className="ax-crosshair" />
          )}
          {xLabels.map(({ i, label }) => (
            <text key={i} x={xAtIndex(i, padX, count)} y={VB_H - 8} className="ax-axis-label ax-axis-x" textAnchor="middle">
              {label}
            </text>
          ))}
        </svg>

        {hoverIdx != null && (
          <div
            className="ax-tooltip"
            style={{
              left: Math.min(Math.max(tipPos.x, 8), (bodyRef.current?.clientWidth || 300) - 168),
              top: Math.max(tipPos.y - 8, 8),
              transform: tipPos.x > (bodyRef.current?.clientWidth || 0) * 0.55 ? 'translate(-100%, -100%)' : 'translate(12px, -100%)',
            }}
          >
            <div className="ax-tooltip-time">
              {fmtTime(series[0]?.labels?.[hoverIdx] || pt?.ts, range)}
            </div>
            {series.map((s) => (
              <div key={s.name} className="ax-tooltip-row">
                <span className="ax-tooltip-dot" style={{ background: s.color }} />
                <span className="ax-tooltip-name">{s.name}</span>
                <span className="ax-tooltip-val">{fmtVal(s.values[hoverIdx] ?? 0)}</span>
              </div>
            ))}
            {pt && (
              <div className="ax-tooltip-extra">
                {pt.cost_usd > 0 && <span>Cost {fmtUsdSmall(pt.cost_usd)}</span>}
                {pt.avg_latency_ms > 0 && <span>{Math.round(pt.avg_latency_ms)}ms latency</span>}
                {pt.errors > 0 && <span className="ax-tooltip-err">{pt.errors} error(s)</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function fmtUsdSmall(n) {
  const v = Number(n || 0);
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function BreakdownPanel({ title, groups, formatUsd }) {
  const maxReq = Math.max(...(groups?.map((g) => g.requests) || [1]), 1);
  const [hoverKey, setHoverKey] = useState(null);
  const hovered = groups?.find((g) => g.key === hoverKey);

  return (
    <div className="ax-chart ax-breakdown">
      <div className="ax-chart-head">
        <div className="ax-chart-title">{title}</div>
        {hovered && (
          <div className="ax-breakdown-hover">
            {hovered.requests} req · {formatUsd(hovered.cost_usd)} · {Math.round(hovered.avg_latency_ms)}ms
          </div>
        )}
      </div>
      <div className="ax-breakdown-body">
        {!groups?.length ? (
          <div className="ax-chart-empty">No breakdown in this range.</div>
        ) : (
          groups.slice(0, 6).map((row) => (
            <div
              key={row.key}
              className={`ax-breakdown-row ${hoverKey === row.key ? 'hover' : ''}`}
              onMouseEnter={() => setHoverKey(row.key)}
              onMouseLeave={() => setHoverKey(null)}
            >
              <span className="ax-breakdown-name" title={row.key}>{row.key}</span>
              <div className="ax-breakdown-track">
                <div className="ax-breakdown-fill" style={{ width: `${(row.requests / maxReq) * 100}%` }} />
              </div>
              <span className="ax-breakdown-stat">{row.requests} · {formatUsd(row.cost_usd)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
