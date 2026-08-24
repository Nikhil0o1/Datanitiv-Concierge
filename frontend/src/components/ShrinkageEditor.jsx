import { f2, reqOf } from '../utils/format';

export default function ShrinkageEditor({ weeks, billable, onChange, editSrc, netReq, onSubmit, doneShr }) {
  if (!weeks?.length) return null;

  const net = weeks.reduce((d, w) => d + reqOf(billable, w.cur) - reqOf(billable, w.base), 0);

  return (
    <div className="edit">
      <div className="enote">
        <b>Adjust forward weeks</b> · requirement = billable ÷ (1 − shrinkage) ·{' '}
        <span id="editSrc">{editSrc || 'plan values'}</span> · net requirement change{' '}
        <b id="netReq" style={{ color: net > 0 ? '#C4463C' : '#2E7D5B' }}>
          {netReq || `${net >= 0 ? '+' : ''}${f2(net)} FTE`}
        </b>
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
            <div className="erow" key={k} id={`er${k}`}>
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
        <div className="btn g">Reset</div>
      </div>
      <div className={`done ${doneShr ? 'on' : ''}`} id="doneShr">
        <span>✓</span>
        <span>Forward weeks submitted · requirement recalculated across 5 weeks</span>
      </div>
    </div>
  );
}
