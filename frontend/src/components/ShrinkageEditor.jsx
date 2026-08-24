import { f2, reqOf } from '../utils/format';

export default function ShrinkageEditor({
  weeks,
  billable,
  onChange,
  editSrc,
  netReq,
  lastEditIdx,
  onSubmit,
  onReset,
  onApplyValue,
  onApplyPct,
  doneShr,
}) {
  if (!weeks?.length) return null;

  const net = weeks.reduce((d, w) => d + reqOf(billable, w.cur) - reqOf(billable, w.base), 0);
  const n = weeks.length;
  const srcIdx = lastEditIdx != null && weeks[lastEditIdx] ? lastEditIdx : 0;
  const src = weeks[srcIdx];
  const lastVal = src?.cur;
  const pct =
    src && src.base
      ? Math.round(((src.cur - src.base) / src.base) * 1000) / 10
      : null;

  return (
    <div className="edit">
      <div className="enote">
        <b>Adjust forward weeks</b> · next {n} wk from this week · requirement = billable ÷ (1 − shrinkage) ·{' '}
        <span id="editSrc">{editSrc || 'plan values'}</span> · net requirement change{' '}
        <b id="netReq" style={{ color: net > 0 ? '#C4463C' : '#2E7D5B' }}>
          {netReq || `${net >= 0 ? '+' : ''}${f2(net)} FTE`}
        </b>
      </div>
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
      <div
        className="erow"
        style={{ fontSize: '.55rem', letterSpacing: '.09em', textTransform: 'uppercase', color: '#9A948A' }}
      >
        <span>Week</span>
        <span>Shrinkage</span>
        <span style={{ textAlign: 'right' }}>%</span>
        <span style={{ textAlign: 'right' }}>FTE req</span>
        <span style={{ textAlign: 'right' }}>New O/U</span>
      </div>
      <div id="editRows">
        {weeks.map((w, k) => {
          const req = reqOf(billable, w.cur);
          const ou = w.proj - req;
          return (
            <div className={`erow ${k === srcIdx ? 'hl' : ''}`} key={w.weekIdx ?? k} id={`er${k}`}>
              <span className="wk">{w.wk}</span>
              <input
                type="range"
                min="0"
                max="70"
                step="0.5"
                value={w.cur}
                onChange={(e) => onChange(k, parseFloat(e.target.value), true)}
              />
              <input
                type="number"
                min="0"
                max="70"
                step="0.1"
                value={w.cur.toFixed(1)}
                onChange={(e) => onChange(k, parseFloat(e.target.value), true)}
              />
              <span className="rq" id={`rq${k}`}>
                {f2(req)}
              </span>
              <span className={`ou ${ou < 0 ? 'neg-t' : 'pos-t'}`} id={`ou${k}`}>
                {f2(ou)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="acts">
        <div className="btn p" data-act="go-shrink" onClick={onSubmit}>
          Submit to plan
        </div>
        <div className="btn g" data-act="shr-reset" onClick={() => onReset?.()}>
          Reset
        </div>
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
