import { f1 } from '../utils/format';

export default function OUChart({ plan, mark, lbl, editorWeeks }) {
  if (!plan) return null;
  const i0 = plan.curIdx;
  const n = Math.min(12, plan.sOU.length - i0);
  let v = plan.sOU.slice(i0, i0 + n);
  const wk = plan.weeks.slice(i0, i0 + n);

  if (editorWeeks?.length) {
    v = v.map((ou, i) => {
      const ew = editorWeeks[i];
      if (!ew) return ou;
      const req = plan.billable / (1 - ew.cur / 100);
      const proj = plan.sProj[i0 + i];
      return proj - req;
    });
  }

  const W = 600;
  const H = 168;
  const L = 44;
  const R = 10;
  const T = 12;
  const B = 24;
  const mn = Math.min(...v.concat([0]));
  const mx = Math.max(...v.concat([0]));
  const pad = (mx - mn) * 0.16 || 1;
  const lo = Math.floor((mn - pad) / 5) * 5;
  const hi = Math.ceil((mx + pad) / 5) * 5;
  const Y = (x) => T + ((H - T - B) * (1 - (x - lo) / (hi - lo)));
  const zy = Y(0);
  const bw = (W - L - R) / n;

  const grid = [];
  for (let t = 0; t <= 4; t++) {
    const vv = lo + ((hi - lo) * t) / 4;
    const yy = Y(vv);
    grid.push(
      <g key={t}>
        <line className="gl" x1={L} y1={yy} x2={W - R} y2={yy} />
        <text className="al" x={L - 7} y={yy + 3} textAnchor="end">
          {f1(vv)}
        </text>
      </g>,
    );
  }

  return (
    <div className="chart on">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {grid}
        <line className="zl" x1={L} y1={zy} x2={W - R} y2={zy} />
        {v.map((x, i) => {
          const bx = L + bw * i + bw * 0.24;
          const w = bw * 0.52;
          const y = x >= 0 ? Y(x) : zy;
          const h = Math.max(1.5, Math.abs(Y(x) - zy));
          return (
            <rect
              key={i}
              className={`bx ${x < 0 ? 'bxn' : ''}`}
              x={bx}
              y={y}
              width={w}
              height={h}
              rx="2.5"
              fill={x < 0 ? '#C4463C' : '#2E7D5B'}
              style={{ transitionDelay: `${i * 0.05}s` }}
            />
          );
        })}
        {mark != null && (
          <>
            <line
              className="mk"
              x1={L + bw * mark + bw * 0.5}
              y1={T}
              x2={L + bw * mark + bw * 0.5}
              y2={H - B}
              stroke="#F5B01A"
              strokeWidth="2"
              strokeDasharray="4 3"
            />
            <text
              className="mk al"
              x={L + bw * mark + bw * 0.5 + 5}
              y={T + 10}
              fill="#8A6100"
              style={{ fontWeight: 600 }}
            >
              {lbl}
            </text>
          </>
        )}
        {v.map((_, i) =>
          i % 2 === 0 || i === n - 1 ? (
            <text
              key={`xl${i}`}
              className="al"
              x={L + bw * i + bw * 0.24 + bw * 0.26}
              y={H - 7}
              textAnchor="middle"
            >
              {wk[i]}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
