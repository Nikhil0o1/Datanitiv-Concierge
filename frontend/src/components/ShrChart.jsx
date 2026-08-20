export default function ShrChart({ plan }) {
  if (!plan) return null;
  const i0 = plan.curIdx;
  const hist = plan.sShrink.slice(Math.max(0, i0 - 8), i0 + 1);
  const fwd = plan.sShrinkPlan.slice(i0 + 1, i0 + 12);
  const all = hist.concat(fwd);
  const wk = plan.weeks.slice(Math.max(0, i0 - 8), i0 + 12);

  const W = 600;
  const H = 160;
  const L = 42;
  const R = 10;
  const T = 12;
  const B = 22;
  const hi = Math.max(60, Math.ceil(Math.max(...all, 0) / 10) * 10);
  const lo = 0;
  const n = all.length;
  const bw = (W - L - R) / n;
  const Y = (x) => T + ((H - T - B) * (1 - (x - lo) / (hi - lo)));

  const actual8 = plan.shrink12 ?? 43.11;
  const planFwd =
    fwd.length > 0 ? fwd.reduce((a, b) => a + b, 0) / fwd.length : 20.58;

  const grid = [];
  for (let t = 0; t <= 3; t++) {
    const vv = lo + ((hi - lo) * t) / 3;
    const yy = Y(vv);
    grid.push(
      <g key={t}>
        <line className="gl" x1={L} y1={yy} x2={W - R} y2={yy} />
        <text className="al" x={L - 7} y={yy + 3} textAnchor="end">
          {Math.round(vv)}%
        </text>
      </g>,
    );
  }

  const cy = Y(actual8);
  const py = Y(planFwd);

  return (
    <div className="chart on" id="chShr">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {grid}
        {all.map((x, i) => {
          const bx = L + bw * i + bw * 0.2;
          const w = bw * 0.6;
          const y = Y(x);
          const h = Y(lo) - y;
          const isH = i < hist.length;
          return (
            <rect
              key={i}
              className="bx"
              x={bx}
              y={y}
              width={w}
              height={Math.max(1.5, h)}
              rx="2"
              fill={isH ? '#B57A11' : '#D2CDC1'}
              style={{ transitionDelay: `${i * 0.04}s` }}
            />
          );
        })}
        <line
          className="mk"
          x1={L}
          y1={cy}
          x2={W - R}
          y2={cy}
          stroke="#C4463C"
          strokeWidth="1.6"
          strokeDasharray="5 4"
        />
        <text className="mk al" x={W - R - 2} y={cy - 5} textAnchor="end" fill="#C4463C" style={{ fontWeight: 600 }}>
          8-wk actual {actual8.toFixed(2)}%
        </text>
        <line
          className="mk"
          x1={L + bw * hist.length}
          y1={py}
          x2={W - R}
          y2={py}
          stroke="#6B665D"
          strokeWidth="1.6"
          strokeDasharray="5 4"
        />
        <text className="mk al" x={W - R - 2} y={py + 12} textAnchor="end" fill="#6B665D" style={{ fontWeight: 600 }}>
          plan {planFwd.toFixed(2)}%
        </text>
        {all.map((_, i) =>
          i % 3 === 0 || i === n - 1 ? (
            <text key={`xl${i}`} className="al" x={L + bw * i + bw * 0.5} y={H - 6} textAnchor="middle">
              {wk[i] || ''}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
