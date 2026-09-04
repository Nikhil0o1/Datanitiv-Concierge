import { f2, reqOf } from '../utils/format';

export default function ShrinkageEditor({
  weeks,
  billable,
  onChange,
  lastEditIdx,
  onSubmit,
  onReset,
  onApplyValue,
  onApplyPct,
  doneShr,
}) {
  if (!weeks?.length) return null;

  const n = weeks.length;
  const srcIdx = lastEditIdx != null && weeks[lastEditIdx] ? lastEditIdx : 0;
  const src = weeks[srcIdx];
  const lastVal = src?.cur;
  const pct =
    src && src.base
      ? Math.round(((src.cur - src.base) / src.base) * 1000) / 10
      : null;

  const bill = Number(billable) || 50;
  const rows = weeks.map((w, k) => {
    const oReq = reqOf(bill, w.base);
    const nReq = reqOf(bill, w.cur);
    const dReq = Math.round((nReq - oReq) * 100) / 100;
    const proj = Number(w.proj) || 0;
    const oOU = Math.round((proj - oReq) * 100) / 100;
    const nOU = Math.round((proj - nReq) * 100) / 100;
    return { w, k, oReq, nReq, dReq, oOU, nOU };
  });
  const tReq = rows.reduce((s, r) => s + (Number.isFinite(r.dReq) ? r.dReq : 0), 0);

  return (
    <div className="imp" data-act="shr-impact">
      <div className="ih">⚡ Live FTE impact — {n} week(s) adjusted</div>
      <div className="repbar">
        <span className="repk">
          Plan shrinkage · last edit {src?.wk || '—'} → <b>{f2(lastVal)}%</b>
          {pct != null ? ` (${pct > 0 ? '+' : ''}${f2(pct)}%)` : ''}
        </span>
        <button type="button" className="repbtn" data-act="shr-apply-val" onClick={() => onApplyValue?.()}>
          ↔ Apply value to all weeks
        </button>
        <button
          type="button"
          className="repbtn"
          data-act="shr-apply-pct"
          disabled={pct == null}
          onClick={() => onApplyPct?.()}
        >
          % Apply {pct != null ? `${pct > 0 ? '+' : ''}${f2(pct)}%` : 'change'} to all weeks
        </button>
      </div>
      <table className="imp-table">
        <thead>
          <tr>
            <th>Week</th>
            <th>Shrinkage %</th>
            <th>FTE req (w/ shrink)</th>
            <th>Δ Req</th>
            <th>New FTE O/U</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ w, k, oReq, nReq, dReq, oOU, nOU }) => (
            <tr key={w.weekIdx ?? k} className={k === srcIdx ? 'hl' : ''}>
              <td>{w.wk}</td>
              <td>
                <span className="imp-old">{f2(w.base)}%</span> <span className="arw">→</span>{' '}
                <input
                  className="cellinp"
                  type="number"
                  min="0"
                  max="95"
                  step="0.05"
                  value={Number(w.cur).toFixed(2)}
                  onChange={(e) => onChange(k, parseFloat(e.target.value), true)}
                />{' '}
                %
              </td>
              <td>
                <span className="imp-old">{f2(oReq)}</span> <span className="arw">→</span> <b>{f2(nReq)}</b>
              </td>
              <td className={dReq > 0 ? 'neg-t' : dReq < 0 ? 'pos-t' : ''}>
                {dReq > 0 ? '+' : ''}
                {f2(dReq)}
              </td>
              <td className={nOU < 0 ? 'neg-t' : 'pos-t'}>
                <b>{f2(nOU)}</b> <span className="arw was">(was {f2(oOU)})</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="imp-foot">
        Net FTE requirement change across adjusted weeks:{' '}
        <b style={{ color: tReq > 0 ? '#e0483f' : '#1a9e6a' }}>
          {tReq > 0 ? '+' : ''}
          {f2(tReq)} FTE
        </b>
        . Keep dragging to refine, then submit.
      </div>
      <div className="acts" style={{ marginTop: 10 }}>
        <button type="button" className="btn p" data-act="go-shrink" onClick={onSubmit}>
          ⬆ Submit shrinkage changes
        </button>
        <button type="button" className="btn g" data-act="shr-reset" onClick={() => onReset?.()}>
          ↺ Reset to original
        </button>
      </div>
      <div className={`done ${doneShr ? 'on' : ''}`} id="doneShr">
        <span>✓</span>
        <span>
          Forward weeks submitted · requirement recalculated across {n} week{n === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}
