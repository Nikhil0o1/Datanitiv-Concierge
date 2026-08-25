import { useCallback, useMemo, useRef, useState } from 'react';
import { f1, f2 } from '../utils/format';

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
  onDragPoint = null,
  snap = 0.5,
  minV = 0,
  maxV = 95,
  /** Hover tooltip — matches HTML Chart.js style (dark tip, week + values). */
  showTooltip = true,
  tooltipUnit = 'FTE',
}) {
  const svgRef = useRef(null);
  const dragIdxRef = useRef(null);
  const onDragRef = useRef(onDragPoint);
  onDragRef.current = onDragPoint;
  const [dragIdx, setDragIdx] = useState(null);
  const [hoverIdx, setHoverIdx] = useState(null);
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
    if (typeof e.button === 'number' && e.button !== 0) return;
    if (dragIdxRef.current != null) return;
    e.preventDefault();
    e.stopPropagation();
    dragIdxRef.current = i;
    setDragIdx(i);

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

  const tipLines = useMemo(() => {
    if (hoverIdx == null || hoverIdx < 0 || hoverIdx >= n) return [];
    const lines = [];
    bars.forEach((series) => {
      const v = series.data?.[hoverIdx];
      if (v == null) return;
      const label = series.label || 'Value';
      if (/o\/u/i.test(label) || zeroLine) {
        lines.push({ label, text: `O/U: ${f2(v)} ${tooltipUnit}` });
      } else if (/%/.test(label) || tooltipUnit === '%') {
        lines.push({ label, text: `${label}: ${f2(v)}%` });
      } else {
        lines.push({
          label,
          text: `${label}: ${f2(v)}${tooltipUnit ? ` ${tooltipUnit}` : ''}`,
        });
      }
    });
    if (lineData?.[hoverIdx] != null) {
      const label = line?.label || 'Plan';
      lines.push({
        label,
        text:
          tooltipUnit === '%'
            ? `${label}: ${f2(lineData[hoverIdx])}%`
            : `${label}: ${f2(lineData[hoverIdx])}${tooltipUnit ? ` ${tooltipUnit}` : ''}`,
      });
    }
    return lines;
  }, [hoverIdx, n, bars, lineData, line?.label, zeroLine, tooltipUnit]);

  const tipLinesUnique = useMemo(() => {
    const seen = new Set();
    return tipLines.filter((ln) => {
      if (seen.has(ln.text)) return false;
      seen.add(ln.text);
      return true;
    });
  }, [tipLines]);

  const updateHoverFromClientX = useCallback(
    (clientX) => {
      if (!showTooltip || !svgRef.current || !layoutRef.current) return;
      if (dragIdxRef.current != null) return;
      const lay = layoutRef.current;
      const rect = svgRef.current.getBoundingClientRect();
      const px = ((clientX - rect.left) / rect.width) * lay.W;
      const idx = Math.floor((px - lay.L) / lay.bw);
      const count = weeks.length || bars[0]?.data?.length || line?.data?.length || 0;
      if (idx < 0 || idx >= count) {
        setHoverIdx(null);
        return;
      }
      setHoverIdx(idx);
    },
    [showTooltip, weeks.length, bars, line?.data?.length],
  );

  if (!n || !layout) return null;
  const { W, H, L, R, T, B, lo, Y, bw, zy } = layout;
  const canDrag = dragFromIdx != null && typeof onDragPoint === 'function';

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

  const tipLeftPct = hoverIdx != null ? ((L + bw * hoverIdx + bw * 0.5) / W) * 100 : 0;

  return (
    <div
      className={`chart on ${canDrag ? 'draggable-chart' : ''}`}
      style={{ marginTop: 8, position: 'relative' }}
      onMouseLeave={() => setHoverIdx(null)}
    >
      {canDrag ? (
        <div className="dragnote" style={{ marginBottom: 4 }}>
          ↕ Drag the plan points for any future week (snaps to {snap})
        </div>
      ) : null}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ touchAction: canDrag ? 'none' : undefined, cursor: dragIdx != null ? 'ns-resize' : undefined }}
        onMouseMove={(e) => updateHoverFromClientX(e.clientX)}
      >
        {grid}
        {zeroLine ? <line className="zl" x1={L} y1={zy} x2={W - R} y2={zy} /> : null}
        {bars.map((series, si) =>
          (series.data || []).map((v, i) => {
            if (v == null) return null;
            const color = typeof series.color === 'function' ? series.color(v, i) : series.color || '#2a78d6';
            const bx = L + bw * i + bw * 0.22;
            const w = bw * 0.56;
            const dim = hoverIdx != null && hoverIdx !== i;
            if (zeroLine) {
              const y = v >= 0 ? Y(v) : zy;
              const h = Math.max(1.5, Math.abs(Y(v) - zy));
              return (
                <rect
                  key={`${si}-${i}`}
                  x={bx}
                  y={y}
                  width={w}
                  height={h}
                  rx="2.5"
                  fill={color}
                  opacity={dim ? 0.35 : 1}
                  pointerEvents="none"
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
                width={w}
                height={h}
                rx="2.5"
                fill={color}
                opacity={dim ? 0.35 : 1}
                pointerEvents="none"
              />
            );
          }),
        )}
        {linePath ? (
          <path
            d={linePath}
            fill="none"
            stroke={line.color || '#c98aa0'}
            strokeWidth="2"
            strokeDasharray={line.dash || undefined}
            pointerEvents="none"
          />
        ) : null}
        {lineData &&
          lineData.map((v, i) => {
            if (v == null) return null;
            const forward = i >= curIdx;
            if (!forward && dragFromIdx != null) return null;
            const draggable = canDrag && i >= dragFromIdx;
            return (
              <g key={`pt${i}`}>
                {draggable ? (
                  <circle
                    cx={L + bw * i + bw * 0.5}
                    cy={Y(v)}
                    r={14}
                    fill="transparent"
                    style={{ cursor: 'ns-resize' }}
                    onPointerDown={(e) => onDragStart(i, e)}
                    onMouseDown={(e) => onDragStart(i, e)}
                  />
                ) : null}
                <circle
                  cx={L + bw * i + bw * 0.5}
                  cy={Y(v)}
                  r={draggable ? (dragIdx === i ? 6 : 5) : 3.5}
                  fill={line.color || '#c98aa0'}
                  stroke="#fff"
                  strokeWidth="1.2"
                  style={{ cursor: draggable ? 'ns-resize' : 'default', pointerEvents: draggable ? 'none' : 'auto' }}
                  onPointerDown={(e) => onDragStart(i, e)}
                  onMouseDown={(e) => onDragStart(i, e)}
                />
              </g>
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
              pointerEvents="none"
            />
            <text
              x={L + bw * curIdx + bw * 0.5}
              y={T - 4}
              textAnchor="middle"
              fill="#f5a623"
              style={{ fontSize: 9, fontWeight: 700 }}
              pointerEvents="none"
            >
              THIS WK
            </text>
          </>
        ) : null}
        {weeks.map((wk, i) =>
          i % 2 === 0 || i === n - 1 ? (
            <text key={`x${i}`} className="al" x={L + bw * i + bw * 0.5} y={H - 7} textAnchor="middle" pointerEvents="none">
              {wk}
            </text>
          ) : null,
        )}
      </svg>
      {showTooltip && hoverIdx != null && tipLinesUnique.length ? (
        <div
          className="chart-tip"
          role="tooltip"
          data-testid="chart-tip"
          style={{
            left: `clamp(8px, calc(${tipLeftPct}% - 40px), calc(100% - 120px))`,
          }}
        >
          <div className="chart-tip-wk">{weeks[hoverIdx] || `Week ${hoverIdx + 1}`}</div>
          {tipLinesUnique.map((ln) => (
            <div key={ln.label + ln.text} className="chart-tip-row">
              {ln.text}
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

export function sparkMini({ values = [], color = '#2a78d6', width = 120, height = 28 }) {
  const vals = values.filter((v) => v != null);
  if (!vals.length) return null;
  const mn = Math.min(...vals, 0);
  const mx = Math.max(...vals, 0);
  const n = values.length;
  const bw = width / n;
  const Y = (v) => {
    const span = mx - mn || 1;
    return height - 2 - ((v - mn) / span) * (height - 4);
  };
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {values.map((v, i) =>
        v == null ? null : (
          <rect key={i} x={i * bw + 1} y={Math.min(Y(v), Y(0))} width={Math.max(1, bw - 2)} height={Math.max(1, Math.abs(Y(v) - Y(0)))} fill={color} rx="1" />
        ),
      )}
    </svg>
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
