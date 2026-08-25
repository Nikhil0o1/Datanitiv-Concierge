import { useCallback, useMemo, useRef, useState } from 'react';
import { f1, f2 } from '../utils/format';

function seriesColor(series, v, i) {
  if (!series) return '#2a78d6';
  return typeof series.color === 'function' ? series.color(v, i) : series.color || '#2a78d6';
}

function hoverItems(bars, line, i, yFmt, valueUnit) {
  const unit = valueUnit ? ` ${valueUnit}` : '';
  const items = [];
  (bars || []).forEach((series) => {
    const v = series.data?.[i];
    if (v == null) return;
    items.push({
      label: series.tipLabel || series.label || 'O/U',
      text: `${yFmt(v)}${unit}`,
      color: seriesColor(series, v, i),
    });
  });
  const lv = line?.data?.[i];
  if (lv != null) {
    items.push({
      label: line.tipLabel || line.label || 'Plan',
      text: `${yFmt(lv)}${unit}`,
      color: line.color || '#c98aa0',
    });
  }
  return items;
}

/** Generic SVG bar (+ optional draggable line) series chart. */
export default function SeriesChart({
  weeks = [],
  curIdx = 0,
  bars = [],
  line = null,
  yFmt = (v) => f1(v),
  height = 200,
  markThisWeek = true,
  zeroLine = false,
  /** Allow dragging line points from this index (usually curIdx). */
  dragFromIdx = null,
  dragUntilIdx = null,
  onDragPoint = null,
  snap = 0.5,
  minV = 0,
  maxV = 95,
  valueUnit = '',
  thinBars = true,
  dragHint = null,
}) {
  const svgRef = useRef(null);
  const dragIdxRef = useRef(null);
  const onDragRef = useRef(onDragPoint);
  onDragRef.current = onDragPoint;
  const [dragIdx, setDragIdx] = useState(null);
  const lineData = line?.data || null;

  const n = weeks.length || bars[0]?.data?.length || lineData?.length || 0;
  const layout = useMemo(() => {
    if (!n) return null;
    const W = 640;
    const H = height;
    const L = 44;
    const R = 12;
    const T = 18;
    const B = 26;
    const vals = [];
    bars.forEach((b) => (b.data || []).forEach((v) => v != null && vals.push(v)));
    if (lineData) lineData.forEach((v) => v != null && vals.push(v));
    if (!vals.length) vals.push(0);
    if (zeroLine) vals.push(0);
    // keep headroom while dragging
    if (dragFromIdx != null) {
      vals.push(minV, maxV);
    }
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    const pad = (mx - mn) * 0.12 || 1;
    const lo = mn - pad;
    const hi = mx + pad;
    const Y = (x) => T + ((H - T - B) * (1 - (x - lo) / (hi - lo || 1)));
    const fromY = (py) => {
      const t = (py - T) / (H - T - B || 1);
      return hi - t * (hi - lo);
    };
    const bw = (W - L - R) / n;
    return { W, H, L, R, T, B, lo, hi, Y, fromY, bw, zy: Y(0) };
  }, [n, height, bars, lineData, zeroLine, dragFromIdx, minV, maxV]);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const valueFromClientY = useCallback(
    (clientY) => {
      const lay = layoutRef.current;
      if (!svgRef.current || !lay) return null;
      const rect = svgRef.current.getBoundingClientRect();
      const py = ((clientY - rect.top) / rect.height) * lay.H;
      let v = lay.fromY(py);
      if (v < minV) v = minV;
      if (v > maxV) v = maxV;
      v = Math.round(v / snap) * snap;
      return Math.round(v * 100) / 100;
    },
    [minV, maxV, snap],
  );

  const endDrag = useCallback(() => {
    dragIdxRef.current = null;
    setDragIdx(null);
  }, []);

  const onDragStart = (i, e) => {
    if (dragFromIdx == null || i < dragFromIdx || !onDragRef.current) return;
    if (dragUntilIdx != null && i > dragUntilIdx) return;
    if (typeof e.button === 'number' && e.button !== 0) return;
    // pointerdown + mousedown both fire in some browsers — only start once
    if (dragIdxRef.current != null) return;
    e.preventDefault();
    e.stopPropagation();
    dragIdxRef.current = i;
    setDragIdx(i);

    // Listen for both pointer + mouse moves (Playwright / some browsers only emit one)
    const move = (ev) => {
      if (dragIdxRef.current == null) return;
      const v = valueFromClientY(ev.clientY);
      if (v != null) onDragRef.current?.(dragIdxRef.current, v);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('pointercancel', up);
      endDrag();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('mousemove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('mouseup', up);
    window.addEventListener('pointercancel', up);
  };

  const [hoverI, setHoverI] = useState(null);

  if (!n || !layout) return null;
  const { W, H, L, R, T, B, lo, Y, bw, zy } = layout;
  const canDrag = dragFromIdx != null && typeof onDragPoint === 'function';
  const barW = thinBars ? Math.max(2.2, Math.min(4.2, bw * 0.18)) : bw * 0.56;
  const hoverTips = hoverI == null ? [] : hoverItems(bars, line, hoverI, yFmt, valueUnit);

  const grid = [];
  for (let t = 0; t <= 4; t++) {
    const vv = lo + ((layout.hi - lo) * t) / 4;
    const yy = Y(vv);
    grid.push(
      <g key={t}>
        <line className="gl" x1={L} y1={yy} x2={W - R} y2={yy} />
        <text className="al" x={L - 6} y={yy + 3} textAnchor="end">
          {yFmt(vv)}
        </text>
      </g>,
    );
  }

  let linePath = '';
  if (lineData) {
    const pts = lineData
      .map((v, i) => (v == null ? null : `${L + bw * i + bw * 0.5},${Y(v)}`))
      .filter(Boolean);
    linePath = pts.length ? `M ${pts.join(' L ')}` : '';
  }

  return (
    <div className={`chart on ${canDrag ? 'draggable-chart' : ''}`} style={{ marginTop: 8, position: 'relative' }}>
      {canDrag ? (
        <div className="dragnote" style={{ marginBottom: 4 }}>
          {dragHint || `↕ Drag the plan points for any future week (snaps to ${snap})`}
        </div>
      ) : null}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ touchAction: canDrag ? 'none' : undefined, cursor: dragIdx != null ? 'ns-resize' : undefined }}
        onMouseLeave={() => setHoverI(null)}
      >
        {grid}
        {zeroLine ? <line className="zl" x1={L} y1={zy} x2={W - R} y2={zy} /> : null}
        {bars.map((series, si) =>
          (series.data || []).map((v, i) => {
            if (v == null) return null;
            const color = typeof series.color === 'function' ? series.color(v, i) : series.color || '#2a78d6';
            const bx = L + bw * i + bw * 0.5 - barW / 2;
            const dim = hoverI != null && hoverI !== i;
            if (zeroLine) {
              const y = v >= 0 ? Y(v) : zy;
              const h = Math.max(1.5, Math.abs(Y(v) - zy));
              return (
                <rect
                  key={`${si}-${i}`}
                  x={bx}
                  y={y}
                  width={barW}
                  height={h}
                  rx={barW / 2}
                  fill={color}
                  opacity={dim ? 0.38 : hoverI === i ? 1 : 0.92}
                />
              );
            }
            const y = Y(v);
            const h = Math.max(1.5, Y(lo) - y);
            return (
              <rect
                key={`${si}-${i}`}
                x={bx}
                y={y}
                width={barW}
                height={h}
                rx={barW / 2}
                fill={color}
                opacity={dim ? 0.38 : hoverI === i ? 1 : 0.92}
              />
            );
          }),
        )}
        {linePath ? (
          <path d={linePath} fill="none" stroke={line.color || '#c98aa0'} strokeWidth="2" strokeDasharray={line.dash || undefined} />
        ) : null}
        {lineData &&
          lineData.map((v, i) => {
            if (v == null) return null;
            const forward = i >= curIdx;
            if (!forward && dragFromIdx != null) return null;
            const draggable = canDrag && i >= dragFromIdx && (dragUntilIdx == null || i <= dragUntilIdx);
            return (
              <circle
                key={`pt${i}`}
                cx={L + bw * i + bw * 0.5}
                cy={Y(v)}
                r={draggable ? (dragIdx === i ? 6 : 5) : 3.5}
                fill={line.color || '#c98aa0'}
                stroke="#fff"
                strokeWidth="1.2"
                style={{ cursor: draggable ? 'ns-resize' : 'default' }}
                onPointerDown={(e) => onDragStart(i, e)}
                onMouseDown={(e) => onDragStart(i, e)}
              />
            );
          })}
        {markThisWeek && curIdx >= 0 && curIdx < n ? (
          <>
            <line
              x1={L + bw * curIdx + bw * 0.5}
              y1={T}
              x2={L + bw * curIdx + bw * 0.5}
              y2={H - B}
              stroke="#f5a623"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
            <text x={L + bw * curIdx + bw * 0.5} y={T - 4} textAnchor="middle" fill="#f5a623" style={{ fontSize: 9, fontWeight: 700 }}>
              THIS WK
            </text>
          </>
        ) : null}
        {weeks.map((wk, i) =>
          i % 2 === 0 || i === n - 1 ? (
            <text key={`x${i}`} className="al" x={L + bw * i + bw * 0.5} y={H - 7} textAnchor="middle">
              {wk}
            </text>
          ) : null,
        )}
        {Array.from({ length: n }, (_, i) => (
          <rect
            key={`hit${i}`}
            x={L + bw * i}
            y={T}
            width={bw}
            height={Math.max(1, H - T - B)}
            fill="transparent"
            style={{ pointerEvents: canDrag ? 'none' : 'all' }}
            onMouseEnter={() => setHoverI(i)}
          />
        ))}
      </svg>
      {hoverTips.length ? (
        <div
          className="chart-tip"
          style={{ left: `${((L + bw * hoverI + bw * 0.5) / W) * 100}%` }}
        >
          <div className="chart-tip-wk">{weeks[hoverI] || ''}</div>
          {hoverTips.map((t, ti) => (
            <div key={`${t.label}-${ti}`} className="chart-tip-row">
              <i style={{ background: t.color }} />
              {t.label}: {t.text}
            </div>
          ))}
        </div>
      ) : null}
      {bars.some((b) => b.label) || line?.label ? (
        <div className="lgd" style={{ marginTop: 6 }}>
          {bars.map((b) =>
            b.label ? (
              <span key={b.label}>
                <i style={{ background: typeof b.color === 'string' ? b.color : '#2a78d6' }} />
                {b.label}
              </span>
            ) : null,
          )}
          {line?.label ? (
            <span>
              <i style={{ background: line.color || '#c98aa0' }} />
              {line.label}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SparkMini({
  values = [],
  weeks = [],
  color = '#2a78d6',
  width = 148,
  height = 36,
  markIdx = 0,
  unit = '',
  format = f2,
  label = '',
}) {
  const [hoverI, setHoverI] = useState(null);
  const n = values.length;
  if (!n) return null;
  const nums = values.map((v) => (v == null ? 0 : v));
  const mn = Math.min(...nums, 0);
  const mx = Math.max(...nums, 0);
  const pad = 3;
  const span = mx - mn || 1;
  const step = n > 1 ? (width - 2) / (n - 1) : width;
  const X = (i) => 1 + i * step;
  const Y = (v) => height - pad - ((v - mn) / span) * (height - pad * 2);
  const pts = nums.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
  const path = pts.length ? `M ${pts.join(' L ')}` : '';
  const hi = hoverI != null ? hoverI : null;
  const tipVal = hi != null ? values[hi] : null;

  return (
    <div className="spark-wrap">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="spark-svg"
        onMouseLeave={() => setHoverI(null)}
      >
        {markIdx >= 0 && markIdx < n ? (
          <line
            x1={X(markIdx)}
            y1={1}
            x2={X(markIdx)}
            y2={height - 1}
            stroke="#f5a623"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
        ) : null}
        {path ? (
          <path d={path} fill="none" stroke={color} strokeWidth="1.35" strokeLinejoin="round" strokeLinecap="round" />
        ) : null}
        {hi != null && tipVal != null ? (
          <circle cx={X(hi)} cy={Y(tipVal)} r="2.6" fill={color} stroke="#fff" strokeWidth="1" />
        ) : null}
        {nums.map((_, i) => (
          <rect
            key={i}
            x={Math.max(0, X(i) - step / 2)}
            y={0}
            width={Math.max(step, 6)}
            height={height}
            fill="transparent"
            onMouseEnter={() => setHoverI(i)}
          />
        ))}
      </svg>
      {hi != null && tipVal != null ? (
        <div className="chart-tip spark-tip" style={{ left: `${(X(hi) / width) * 100}%` }}>
          <div className="chart-tip-wk">{weeks[hi] || `W${hi + 1}`}</div>
          <div className="chart-tip-row">
            <i style={{ background: color }} />
            {label ? `${label}: ` : ''}
            {format(tipVal)}
            {unit ? ` ${unit}` : ''}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated call SparkMini as a component; kept for existing `{sparkMini({...})}` sites. */
export function sparkMini(props) {
  return <SparkMini {...props} />;
}

export function KpiTrendCard({
  heading,
  value,
  suffix = '',
  caption,
  color = '#2a78d6',
  values = [],
  weeks = [],
  markIdx = 0,
  unit = '',
  tone = '',
  format = f2,
}) {
  return (
    <div className={`kpi-trend ${tone}`} style={{ '--kpi-accent': color }}>
      {heading ? <span className="kpi-trend-h">{heading}</span> : null}
      <b>
        {format(value)}
        {suffix}
      </b>
      <SparkMini
        values={values}
        weeks={weeks}
        color={color}
        markIdx={markIdx}
        unit={unit}
        format={format}
        label={heading || caption}
      />
      {caption ? <span>{caption}</span> : null}
    </div>
  );
}

export function DecisionBar({ decision, onAccept, onModify, onReject }) {
  return (
    <div className="rec-actions" data-act="decision-bar">
      <button type="button" className={`abtn acc ${decision === 'acc' ? 'on' : ''}`} data-act="dec-acc" onClick={onAccept}>
        ✓ Accept
      </button>
      {onModify ? (
        <button type="button" className={`abtn mod ${decision === 'mod' ? 'on' : ''}`} data-act="dec-mod" onClick={onModify}>
          ✎ Modify
        </button>
      ) : null}
      <button type="button" className={`abtn rej ${decision === 'rej' ? 'on' : ''}`} data-act="dec-rej" onClick={onReject}>
        ✕ Reject
      </button>
      <span className="rec-badge">
        {decision === 'acc' ? '✓ Accepted' : decision === 'mod' ? '✎ Modified' : decision === 'rej' ? '✕ Rejected' : ''}
      </span>
    </div>
  );
}
