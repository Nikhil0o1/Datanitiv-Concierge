import { useEffect, useMemo, useState } from 'react';
import { f2 } from '../../utils/format';
import {
  computeXutil,
  defaultOtWeekly,
  fwdCount,
  planRec,
  segmentShrinkage,
  shrRec,
  statusOf,
  weeks12,
} from '../../utils/planLogic';
import SeriesChart, { DecisionBar, sparkMini } from '../SeriesChart';
import ShrinkageEditor from '../ShrinkageEditor';

const SEG_COLORS = {
  breaks: '#2a78d6',
  training: '#eb6834',
  meetings: '#8a95a3',
  coaching: '#7b6bb0',
  absence: '#e0483f',
  other: '#c98aa0',
};

const TAB_LABELS = {
  ov: 'Overview',
  fw: 'Forecast',
  hc: 'Headcount',
  nh: 'New Hire',
  shr: 'Shrinkage',
  att: 'Attrition',
  rec: 'Recommend',
  exe: 'Execute',
};

export { TAB_LABELS };

export function tabsForPlan(plan) {
  if (!plan) return Object.keys(TAB_LABELS).filter((k) => k !== 'fw');
  return plan.isVol ? Object.keys(TAB_LABELS) : Object.keys(TAB_LABELS).filter((k) => k !== 'fw');
}

function OverviewTab({ plan }) {
  const fut = (s) => (s || []).slice(plan.curIdx, plan.curIdx + 12);
  const shrF = fut(plan.sShrinkPlan);
  const attrF = fut(plan.sAttrPlan);
  const hireF = fut(plan.sHire);
  const past = (plan.sOU || []).map((v, i) => (i <= plan.curIdx ? v : null));
  const fu = (plan.sOU || []).map((v, i) => (i >= plan.curIdx ? v : null));

  return (
    <div className="tsec on" data-sec="ov">
      <div className="card in">
        <div className="ch">
          <b>Plan overview</b>
          <span className="tag">step 1</span>
        </div>
        <div className="kpis">
          <div className="kpi">
            <b>{f2(plan.shrink12)}%</b>
            <span>Shrinkage · 12wk</span>
            <div style={{ marginTop: 4 }}>{sparkMini({ values: shrF, color: '#2a78d6' })}</div>
          </div>
          <div className="kpi">
            <b>{f2(plan.attr12)}%</b>
            <span>Attrition · 12wk</span>
            <div style={{ marginTop: 4 }}>{sparkMini({ values: attrF, color: '#eb6834' })}</div>
          </div>
          <div className="kpi">
            <b>{f2(plan.hire12)}</b>
            <span>Hiring · 12wk</span>
            <div style={{ marginTop: 4 }}>{sparkMini({ values: hireF, color: '#1a9e6a' })}</div>
          </div>
          <div className={`kpi ${(plan.ouShrink ?? plan.ou) < 0 ? 'neg' : 'pos'}`}>
            <b>{f2(plan.ouShrink ?? plan.ou)}</b>
            <span>O/U with shrinkage</span>
            <div className="s" style={{ fontSize: '.65rem', color: 'var(--dim)', marginTop: 4 }}>
              vs billable {f2(plan.ou)}
            </div>
          </div>
        </div>
        <div className="slabel">FTE Over / Under — week on week (this week marked)</div>
        <SeriesChart
          weeks={plan.weeks}
          curIdx={plan.curIdx}
          zeroLine
          height={220}
          bars={[
            {
              label: 'Actual/plan O/U',
              data: past,
              color: (v) => (v < 0 ? '#e0483f' : '#1a9e6a'),
            },
            {
              label: 'Forecast O/U',
              data: fu,
              color: (v) => (v < 0 ? '#f3b0ab' : '#a9dcc6'),
            },
          ]}
        />
      </div>
    </div>
  );
}

function ForecastTab({ plan, decisions, onDecide }) {
  if (!plan.isVol) {
    return (
      <div className="tsec on" data-sec="fw">
        <div className="card in">
          <div className="ch">
            <b>Forecast &amp; Workload</b>
            <span className="tag">volume-based only</span>
          </div>
          <p>This plan is FTE-based — forecast accuracy doesn&apos;t drive FTE the same way. No forecast step.</p>
        </div>
      </div>
    );
  }

  const [fcst, setFcst] = useState(() => [...(plan.sFcst || [])]);
  const [ahtGoal, setAhtGoal] = useState(() => [...(plan.sAhtGoal || [])]);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    setFcst([...(plan.sFcst || [])]);
    setAhtGoal([...(plan.sAhtGoal || [])]);
    setSubmitted(false);
  }, [plan.capId]);

  const actVol = (plan.sActVol || []).map((v, i) => (i <= plan.curIdx ? v : null));
  const ahtAct = (plan.sAhtAct || []).map((v, i) => (i <= plan.curIdx ? v : null));
  const d = decisions?.fw || {};
  const volMax = Math.max(...(plan.sFcst || []).filter((v) => v != null), 1000) * 1.4;
  const volSnap = volMax > 20000 ? 250 : volMax > 5000 ? 50 : volMax > 1000 ? 10 : 5;

  return (
    <div className="tsec on" data-sec="fw">
      <div className="card in">
        <div className="ch">
          <b>Forecast &amp; AHT</b>
          <span className="tag">volume-based · drag to adjust</span>
        </div>
        <p className="muted-line">
          Accept the recommendation or drag forward weeks. Bias: forecast {plan.fBias == null ? '—' : `${plan.fBias > 0 ? '+' : ''}${f2(plan.fBias)}%`} · AHT{' '}
          {plan.aBias == null ? '—' : `${plan.aBias > 0 ? '+' : ''}${f2(plan.aBias)}%`}.
        </p>
        <div className="slabel">Forecast vs Actual volume</div>
        <div className="insight warn">
          <b>Recommendation:</b> review forward forecast against last 8 weeks of actuals
          {plan.fBias != null ? ` (bias ${plan.fBias > 0 ? '+' : ''}${f2(plan.fBias)}%).` : '.'}
        </div>
        <DecisionBar
          decision={d.vol}
          onAccept={() => onDecide?.('fw', 'vol', 'acc')}
          onModify={() => onDecide?.('fw', 'vol', 'mod')}
          onReject={() => onDecide?.('fw', 'vol', 'rej')}
        />
        <SeriesChart
          weeks={plan.weeks}
          curIdx={plan.curIdx}
          height={180}
          yFmt={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : f2(v))}
          bars={[{ label: 'Actual', data: actVol, color: '#2a78d6' }]}
          line={{ label: 'Forecast', data: fcst, color: '#eb6834' }}
          dragFromIdx={plan.curIdx}
          snap={volSnap}
          minV={0}
          maxV={volMax}
          onDragPoint={(i, v) => {
            setFcst((arr) => {
              const next = [...arr];
              next[i] = v;
              return next;
            });
            setSubmitted(false);
            onDecide?.('fw', 'vol', 'mod');
          }}
        />
        <div className="slabel" style={{ marginTop: 14 }}>
          AHT goal vs actual (sec)
        </div>
        <DecisionBar
          decision={d.aht}
          onAccept={() => onDecide?.('fw', 'aht', 'acc')}
          onModify={() => onDecide?.('fw', 'aht', 'mod')}
          onReject={() => onDecide?.('fw', 'aht', 'rej')}
        />
        <SeriesChart
          weeks={plan.weeks}
          curIdx={plan.curIdx}
          height={180}
          yFmt={(v) => `${f2(v)}s`}
          bars={[{ label: 'AHT actual', data: ahtAct, color: '#2a78d6' }]}
          line={{ label: 'AHT goal', data: ahtGoal, color: '#8a95a3', dash: '5 4' }}
          dragFromIdx={plan.curIdx}
          snap={5}
          minV={0}
          maxV={600}
          onDragPoint={(i, v) => {
            setAhtGoal((arr) => {
              const next = [...arr];
              next[i] = v;
              return next;
            });
            setSubmitted(false);
            onDecide?.('fw', 'aht', 'mod');
          }}
        />
        <div className="acts" style={{ marginTop: 10 }}>
          <div
            className="btn p"
            data-act="fw-submit"
            onClick={() => {
              setSubmitted(true);
              onDecide?.('fw', 'vol', d.vol === 'acc' ? 'acc' : 'mod');
            }}
          >
            ⬆ Submit forecast / AHT changes
          </div>
        </div>
        {submitted ? (
          <div className="insight pos" data-act="fw-submitted">
            <b>Submitted.</b> Adjusted forecast/AHT committed for edited weeks · FTE required / projected / Over-Under re-flow simulated.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HeadcountTab({ plan }) {
  const baseCur = plan.hcCur;
  const l = plan.hcLast || baseCur;
  const [editing, setEditing] = useState(false);
  const [cur, setCur] = useState(() => ({ ...(baseCur || {}) }));
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setCur({ ...(plan.hcCur || {}) });
    setEditing(false);
    setSaved(false);
  }, [plan.capId]);

  if (!baseCur) {
    return (
      <div className="tsec on" data-sec="hc">
        <div className="card in">
          <div className="ch">
            <b>Headcount snapshot</b>
            <span className="tag">step</span>
          </div>
          <p>No headcount snapshot for this plan.</p>
        </div>
      </div>
    );
  }

  const prevWk = plan.weeks[Math.max(0, plan.curIdx - 1)] || '';
  const curWk = plan.weeks[plan.curIdx] || '';
  const moveKeys = [
    ['nest', 'Nesting → Production'],
    ['tin', 'Transfer In'],
    ['tout', 'Transfer Out'],
    ['loaOut', 'Back from LOA'],
    ['loaIn', 'Move to LOA'],
    ['attr', 'Production Attrition'],
    ['promo', 'Promotion (out)'],
  ];
  const rows = [
    ['Opening FTE', 'opening', true],
    ['+ Nesting → Production', 'nest', false],
    ['+ Transfer In', 'tin', false],
    ['− Transfer Out', 'tout', false],
    ['+ Back from LOA', 'loaOut', false],
    ['− Move to LOA', 'loaIn', false],
    ['− Production Attrition', 'attr', false],
    ['− Promotion (out)', 'promo', false],
    ['Closing FTE', 'closing', true],
  ];

  const recomputeClosing = (hc) => {
    const opening = Number(hc.opening) || 0;
    const nest = Number(hc.nest) || 0;
    const tin = Number(hc.tin) || 0;
    const tout = Number(hc.tout) || 0;
    const loaOut = Number(hc.loaOut) || 0;
    const loaIn = Number(hc.loaIn) || 0;
    const attr = Number(hc.attr) || 0;
    const promo = Number(hc.promo) || 0;
    return Math.round((opening + nest + tin - tout + loaOut - loaIn - attr - promo) * 100) / 100;
  };

  const cell = (wk, key, grp) => {
    const v = wk?.[key] ?? 0;
    if (grp) return f2(v);
    if (v === 0) return '0.00';
    const neg = key === 'tout' || key === 'loaIn' || key === 'attr' || key === 'promo';
    return `${neg ? '−' : '+'}${f2(Math.abs(v))}`;
  };

  return (
    <div className="tsec on" data-sec="hc">
      <div className="card in">
        <div className="ch">
          <b>Headcount snapshot</b>
          <span className="tag">FTE flow</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div className="slabel" style={{ margin: 0 }}>
            FTE flow · {plan.plan}
          </div>
          <button
            type="button"
            className="btn g"
            data-act="hc-update"
            onClick={() => {
              setEditing((v) => !v);
              setSaved(false);
            }}
          >
            {editing ? 'Hide editor' : '✎ Update transfers / promotions'}
          </button>
        </div>
        {editing ? (
          <div className="hc-edit" data-act="hc-editor">
            {moveKeys.map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={cur[key] ?? 0}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    setCur((h) => {
                      const next = { ...h, [key]: val };
                      next.closing = recomputeClosing(next);
                      return next;
                    });
                    setSaved(false);
                  }}
                />
              </label>
            ))}
            <button
              type="button"
              className="btn p"
              data-act="hc-save"
              onClick={() => {
                setCur((h) => ({ ...h, closing: recomputeClosing(h) }));
                setSaved(true);
                setEditing(false);
              }}
            >
              Save movements
            </button>
          </div>
        ) : null}
        {saved ? (
          <div className="insight pos" data-act="hc-saved">
            <b>Movements updated.</b> Closing FTE now {f2(cur.closing)} · downstream staffing position re-flow simulated.
          </div>
        ) : null}
        <table className="fl">
          <thead>
            <tr>
              <th>Movement</th>
              <th>Previous wk · {prevWk}</th>
              <th>Current wk · {curWk}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, key, grp]) => (
              <tr key={label} className={grp ? 'grp-row' : ''}>
                <td>{label}</td>
                <td className={!grp && (l?.[key] || 0) > 0 ? (key.includes('out') || key === 'attr' || key === 'promo' || key === 'tout' || key === 'loaIn' ? 'neg-t' : 'pos-t') : ''}>
                  {cell(l, key, grp)}
                </td>
                <td className={!grp && (cur?.[key] || 0) > 0 ? (key === 'tout' || key === 'loaIn' || key === 'attr' || key === 'promo' ? 'neg-t' : 'pos-t') : ''}>
                  {cell(cur, key, grp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewHireTab({ plan, doneRoster, onMapRoster }) {
  const cls = plan.cls;
  const [uploadNote, setUploadNote] = useState('');
  useEffect(() => setUploadNote(''), [plan.capId]);

  if (!cls) {
    return (
      <div className="tsec on" data-sec="nh">
        <div className="card in">
          <div className="ch">
            <b>New-hire &amp; onboarding</b>
            <span className="tag">step</span>
          </div>
          <p>No class in the planning window for this plan.</p>
        </div>
      </div>
    );
  }

  const className = cls.name || cls.className || `TC_2026_${String(plan.capId || '').replace(/\D/g, '')}`;
  const gap = Math.abs(plan.sustained);
  const rosterFte = Math.max(0, (cls.plan || 0) - (cls.actual || 0));
  const mapped = doneRoster || cls.status === 'uploaded' || cls.status === 'mapped';
  const realGap = mapped ? Math.max(0, gap - rosterFte) : gap;
  const stLabel =
    mapped ? '✓ Uploaded' : cls.status === 'partial' ? '◑ Partial' : '✕ Not uploaded';

  const doUpload = () => {
    setUploadNote(`Mapped ${f2(cls.plan)} planned hires for ${className} against Class Reference.`);
    onMapRoster?.();
  };

  return (
    <div className="tsec on" data-sec="nh">
      <div className={`card ${mapped ? 'in' : 'warn in'}`}>
        <div className="ch">
          <b>{mapped ? 'New-hire class' : 'Roster gap — this one does matter'}</b>
          <span className="tag">new hire</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <div className="slabel" style={{ margin: 0 }}>
            Class {className} · {plan.plan}
          </div>
          {!mapped ? (
            <button type="button" className="btn g" data-act="nh-upload" onClick={doUpload}>
              ⬆ Upload roster
            </button>
          ) : (
            <span className="chiptag ok">{stLabel}</span>
          )}
        </div>
        <div className="kpis">
          <div className="kpi">
            <b style={{ fontSize: '.9rem' }}>{className}</b>
            <span>Class Reference</span>
          </div>
          <div className="kpi">
            <b>
              {cls.trainWk} / {cls.nestWk} wk
            </b>
            <span>Train / Nest</span>
          </div>
          <div className={`kpi ${mapped ? 'pos' : 'neg'}`}>
            <b>
              {f2(cls.actual)} / {f2(cls.plan)}
            </b>
            <span>Onboarded / plan</span>
          </div>
          <div className="kpi">
            <b>{plan.nClasses12 || 0}</b>
            <span>Classes · next 12 wk</span>
          </div>
        </div>
        <table className="fl" style={{ marginTop: 9 }}>
          <thead>
            <tr>
              <th>Class</th>
              <th>Date</th>
              <th>Plan HC</th>
              <th>Onboarded</th>
              <th>Roster</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{className}</td>
              <td>{cls.date}</td>
              <td>{f2(cls.plan)}</td>
              <td className={mapped ? '' : 'neg-t'}>{f2(cls.actual)}</td>
              <td className={mapped ? 'pos-t' : 'neg-t'}>{mapped ? 'Mapped' : 'Not uploaded'}</td>
            </tr>
          </tbody>
        </table>
        {!mapped ? (
          <div className="math">
            <div className="mline">
              <span>Reported 12-week gap</span>
              <span>{f2(gap)} FTE</span>
            </div>
            <div className="mline cut">
              <span>Onboarded, not on roster</span>
              <span>−{f2(rosterFte)} FTE</span>
            </div>
            <div className="mline">
              <span>Real gap after map</span>
              <span>{f2(realGap)} FTE</span>
            </div>
          </div>
        ) : null}
        <div className="acts">
          <div className="btn p" data-act="go-roster" onClick={doUpload}>
            Map the roster
          </div>
          <div className="btn g" data-act="nh-file" onClick={doUpload}>
            Upload file
          </div>
        </div>
        {uploadNote && !mapped ? (
          <div className="insight info">{uploadNote}</div>
        ) : null}
        <div className={`done ${doneRoster || mapped ? 'on' : ''}`} id="doneRoster">
          <span>✓</span>
          <span>
            {f2(rosterFte)} FTE mapped · projected FTE corrected · gap now {f2(realGap)}
          </span>
        </div>
      </div>
    </div>
  );
}

function ShrinkageTab({ plan, state, onEditorChange, onSubmitShrinkage, decisions, onDecide }) {
  const rec = shrRec(plan);
  const past = (plan.sShrink || []).map((v, i) => (i <= plan.curIdx ? v : null));
  const [planLine, setPlanLine] = useState(() =>
    (plan.sShrinkPlan || []).map((v, i) => (i < plan.curIdx ? null : v)),
  );
  const [showSeg, setShowSeg] = useState(false);
  useEffect(() => {
    setPlanLine((plan.sShrinkPlan || []).map((v, i) => (i < plan.curIdx ? null : v)));
    setShowSeg(false);
  }, [plan.capId, plan.curIdx]);

  const segs = useMemo(() => segmentShrinkage(plan), [plan]);

  // Prefer live editor values on the forward weeks when present
  const displayLine = useMemo(() => {
    const line = [...planLine];
    (state.editorWeeks || []).forEach((ew) => {
      if (ew?.weekIdx != null && ew.weekIdx >= plan.curIdx) line[ew.weekIdx] = ew.cur;
    });
    return line;
  }, [planLine, state.editorWeeks, plan.curIdx]);

  const fwdVals = displayLine.filter((v, i) => i >= plan.curIdx && v != null);
  const planFwd = fwdVals.length ? fwdVals.reduce((a, b) => a + b, 0) / fwdVals.length : rec.plan;
  const actual8 = rec.actAvg;
  const variance = actual8 - planFwd;
  const decision = decisions?.shr;

  const applyDrag = (weekIdx, value) => {
    setPlanLine((arr) => {
      const next = [...arr];
      next[weekIdx] = value;
      return next;
    });
    const editorIdx = (state.editorWeeks || []).findIndex((w) => w.weekIdx === weekIdx);
    if (editorIdx >= 0) onEditorChange?.(editorIdx, value, true);
    onDecide?.('shr', null, 'mod');
  };

  const fwdSlice = (arr) => (arr || []).slice(plan.curIdx, plan.curIdx + 12);

  return (
    <div className="tsec on" data-sec="shr">
      <div className="card in">
        <div className="ch">
          <b>Shrinkage trend</b>
          <span className="tag">drag plan points / accept rec</span>
        </div>
        <div className="kpis">
          <div className="kpi neg">
            <b>{actual8.toFixed(2)}%</b>
            <span>8-wk actual</span>
          </div>
          <div className="kpi">
            <b>{planFwd.toFixed(2)}%</b>
            <span>Planned fwd</span>
          </div>
          <div className={`kpi ${variance > 1 ? 'neg' : 'pos'}`}>
            <b>
              {variance >= 0 ? '+' : ''}
              {variance.toFixed(2)}pt
            </b>
            <span>Variance</span>
          </div>
        </div>
        <div className="insight warn" style={{ marginTop: 8 }}>
          <b>Recommendation:</b> {rec.t}.
          {rec.dir !== 'ok' ? (
            <>
              {' '}
              <b>Recommended:</b> set plan shrinkage to ~{f2(rec.actAvg)}% for the forward weeks.
            </>
          ) : null}
          <div style={{ fontSize: '.72rem', color: 'var(--dim)', marginTop: 4 }}>
            Recent 8-wk actual avg {f2(rec.actAvg)}% vs planned {f2(rec.plan)}% over next 12 wk.
          </div>
        </div>
        <DecisionBar
          decision={decision}
          onAccept={() => {
            const target = rec.actAvg;
            setPlanLine((arr) => arr.map((v, i) => (i >= plan.curIdx ? target : v)));
            (state.editorWeeks || []).forEach((ew, k) => onEditorChange?.(k, target, true));
            onDecide?.('shr', null, 'acc');
          }}
          onModify={() => onDecide?.('shr', null, 'mod')}
          onReject={() => onDecide?.('shr', null, 'rej')}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
          <button
            type="button"
            className="btn g"
            data-act="shr-segment"
            onClick={() => setShowSeg((v) => !v)}
          >
            {showSeg ? 'Hide segment trends' : '◱ Segment trends'}
          </button>
        </div>
        {showSeg ? (
          <div className="seg-panel" data-act="shr-seg-panel">
            <div className="slabel" style={{ marginTop: 0 }}>
              Planned vs unplanned · next 12 wk
            </div>
            <SeriesChart
              weeks={plan.weeks.slice(plan.curIdx, plan.curIdx + 12)}
              curIdx={0}
              markThisWeek={false}
              height={160}
              yFmt={(v) => `${f2(v)}%`}
              bars={[
                { label: 'Planned', data: fwdSlice(segs.planned), color: '#2a78d6' },
                { label: 'Unplanned', data: fwdSlice(segs.unplanned), color: '#e0483f' },
              ]}
            />
            <div className="slabel">By category (share of total)</div>
            <div className="seg-grid">
              {segs.cats.map((cat) => {
                const vals = fwdSlice(segs.byCat[cat]);
                const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                return (
                  <div key={cat} className="seg-card">
                    <b>
                      {cat} · {f2(avg)}%
                    </b>
                    <span>{Math.round((segs.weights[cat] || 0) * 100)}% of total · demo split</span>
                    <div style={{ marginTop: 6 }}>{sparkMini({ values: vals, color: SEG_COLORS[cat] || '#2a78d6' })}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        <SeriesChart
          weeks={plan.weeks}
          curIdx={plan.curIdx}
          height={200}
          yFmt={(v) => `${Math.round(v)}%`}
          bars={[{ label: 'Actual', data: past, color: '#2a78d6' }]}
          line={{ label: 'Plan', data: displayLine, color: '#c98aa0' }}
          dragFromIdx={plan.curIdx}
          snap={0.5}
          minV={0}
          maxV={95}
          onDragPoint={applyDrag}
        />
        {state.editorReady ? (
          <ShrinkageEditor
            weeks={state.editorWeeks}
            billable={plan.billable}
            onChange={onEditorChange}
            editSrc={state.editSrc}
            netReq={state.netReq}
            onSubmit={onSubmitShrinkage}
            doneShr={state.doneShr}
          />
        ) : null}
      </div>
    </div>
  );
}

function AttritionTab({ plan, onDecide }) {
  const past = (plan.sAttr || []).slice(Math.max(0, plan.curIdx - 8), plan.curIdx + 1).filter((v) => v != null);
  const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : plan.attr12 || 0;
  const [planLine, setPlanLine] = useState(() => [...(plan.sAttrPlan || [])]);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setPlanLine([...(plan.sAttrPlan || [])]);
    setEditing(false);
  }, [plan.capId]);

  const planned = planLine[plan.curIdx] || 0;
  const variance = planned - avg;
  const act = (plan.sAttr || []).map((v, i) => (i <= plan.curIdx ? v : null));
  const pln = planLine.map((v, i) => (i >= plan.curIdx ? v : null));

  return (
    <div className="tsec on" data-sec="att">
      <div className="card in">
        <div className="ch">
          <b>Attrition trend</b>
          <span className="tag">production</span>
        </div>
        <div className="kpis">
          <div className="kpi">
            <b>{f2(avg)}%</b>
            <span>Avg actual · 8wk</span>
          </div>
          <div className="kpi">
            <b>{f2(planned)}%</b>
            <span>Planned</span>
          </div>
          <div className="kpi">
            <b>
              {variance >= 0 ? '+' : ''}
              {f2(variance)}pt
            </b>
            <span>Variance</span>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6, gap: 8 }}>
          <button
            type="button"
            className="btn g"
            data-act="att-adjust"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? 'Done adjusting' : '✎ Adjust future weeks'}
          </button>
        </div>
        {editing ? (
          <div className="insight info" data-act="att-edit-hint">
            Drag forward plan points to flex attrition %. Snaps to 0.1pt.
          </div>
        ) : null}
        <SeriesChart
          weeks={plan.weeks}
          curIdx={plan.curIdx}
          height={200}
          yFmt={(v) => `${f2(v)}%`}
          bars={[{ label: 'Actual', data: act, color: '#2a78d6' }]}
          line={{ label: 'Plan', data: pln, color: '#2b2f36', dash: editing ? undefined : '5 4' }}
          dragFromIdx={editing ? plan.curIdx : null}
          snap={0.1}
          minV={0}
          maxV={40}
          onDragPoint={
            editing
              ? (i, v) => {
                  setPlanLine((arr) => {
                    const next = [...arr];
                    next[i] = v;
                    return next;
                  });
                  onDecide?.('att', null, 'mod');
                }
              : null
          }
        />
      </div>
    </div>
  );
}

function RecommendTab({
  plan,
  doneRoster,
  doneRec,
  onAccept,
  onReject,
  decisions,
  otWeeks,
  onOtWeekChange,
  gotBy,
  onRecOverride,
}) {
  const st = statusOf(plan);
  const w = weeks12(plan);
  const [showMod, setShowMod] = useState(false);
  const ovr = decisions?.recOvr || {};
  const rec = planRec(plan, { otPct: ovr.otPct ?? 5, xr: ovr.xr, starts: ovr.starts, gotBy });
  const decision = decisions?.rec;
  const n = fwdCount(plan);
  const weekly = otWeeks?.length === n ? otWeeks : Array(n).fill(defaultOtWeekly(plan, rec.otPct));
  const otTotal = weekly.reduce((a, b) => a + (Number(b) || 0), 0);
  const labels = plan.weeks.slice(plan.curIdx, plan.curIdx + n);

  let body;
  if (st === 'under' || st === 'critical') {
    body = (
      <>
        <div className="slabel">Recommended package — ① OT → ② cross-util → ③ hire</div>
        <div className="math">
          <div className="mline">
            <span>12-wk gap</span>
            <span>{f2(rec.gap)} FTE</span>
          </div>
          <div className="mline">
            <span>
              ① OT · {f2(rec.otHrs)} hrs/wk ({f2(rec.otPct)}% of avail)
            </span>
            <span>−{f2(rec.otFTE)} FTE</span>
          </div>
          <div className="mline add">
            <span>② Cross-util in</span>
            <span>−{f2(rec.xr)} FTE</span>
          </div>
          <div className="mline">
            <span>③ Hire starts</span>
            <span>{rec.starts}</span>
          </div>
          <div className="mline">
            <span>Residual</span>
            <span>{f2(rec.residual)} FTE</span>
          </div>
        </div>
        <div className="slabel" style={{ marginTop: 10 }}>
          ✎ Modify OT by week (hrs)
        </div>
        <div className="otgrid">
          {weekly.map((v, i) => (
            <label key={labels[i] || i} className="otwk">
              <span>{labels[i]}</span>
              <input
                type="number"
                min="0"
                step="5"
                value={Number(v).toFixed(2)}
                onChange={(e) => onOtWeekChange?.(i, parseFloat(e.target.value) || 0)}
              />
            </label>
          ))}
        </div>
        <div className="dragnote">
          Total OT: <b>{f2(otTotal)} hrs</b> across {n} week(s)
        </div>
      </>
    );
  } else if (w.under >= 2) {
    const peak = Math.min(0, ...w.s);
    body = (
      <div className="insight warn">
        <b>
          {w.under} of 12 weeks are understaffed
        </b>{' '}
        (peak {f2(peak)} FTE) even though the 12-week average is {f2(plan.sustained)}. Cover short weeks with overtime /
        redistribution.
      </div>
    );
  } else if (st === 'surplus') {
    const lend = Math.max(0, plan.minOUfwd - 1);
    body = (
      <div className="insight pos">
        <b>Net surplus — donor.</b> Can lend up to <b>{f2(lend)} FTE</b> across the next {w.n} weeks (keeps ≥1 FTE buffer).
      </div>
    );
  } else {
    body = (
      <div className="insight pos">
        <b>No staffing action needed</b> — tracks requirement across the next {w.n} weeks.
      </div>
    );
  }

  const showDecide = st === 'under' || st === 'critical' || w.under >= 2 || st === 'surplus';

  return (
    <div className="tsec on" data-sec="rec">
      <div className="card good in">
        <div className="ch">
          <b>Staffing recommendation</b>
          <span className="tag">OT → cross-util → hire</span>
        </div>
        {doneRoster ? <p style={{ fontSize: '.78rem', color: 'var(--dim)' }}>Roster mapped — gap adjusted before packaging.</p> : null}
        {body}
        {showMod ? (
          <div className="rec-mod" data-act="rec-mod-panel">
            <label>
              OT %
              <input
                type="number"
                min="0"
                max="20"
                step="0.5"
                value={ovr.otPct ?? 5}
                onChange={(e) => onRecOverride?.({ otPct: parseFloat(e.target.value) || 0 })}
              />
            </label>
            <label>
              Cross-util FTE
              <input
                type="number"
                min="0"
                step="0.1"
                value={ovr.xr ?? rec.xr}
                onChange={(e) => onRecOverride?.({ xr: parseFloat(e.target.value) || 0 })}
              />
            </label>
            <label>
              Hire starts
              <input
                type="number"
                min="0"
                step="1"
                value={ovr.starts ?? rec.starts}
                onChange={(e) => onRecOverride?.({ starts: parseInt(e.target.value, 10) || 0 })}
              />
            </label>
          </div>
        ) : null}
        {showDecide ? (
          <div className="acts" style={{ marginTop: 12 }}>
            <div className="btn p" data-act="go-accept" onClick={onAccept}>
              ✓ Accept &amp; add to execution
            </div>
            <div
              className="btn g"
              data-act="rec-mod"
              onClick={() => setShowMod((v) => !v)}
            >
              {showMod ? 'Hide modify' : '✎ Modify'}
            </div>
            <div className="btn g" data-act="rec-rej" onClick={onReject}>
              ✕ Reject
            </div>
          </div>
        ) : null}
        <div className={`done ${doneRec ? 'on' : ''}`} id="doneRec">
          <span>✓</span>
          <span>
            Package accepted · OT {f2(otTotal)} hrs · cross-util {f2(rec.xr)} · hire {rec.starts} · queued
          </span>
        </div>
      </div>
    </div>
  );
}

function ExecuteTab({ plan, doneRec, otWeeks, gotBy, onOpenQueue, onExecutePlan, execDone, execMsg }) {
  const rec = planRec(plan, { gotBy });
  const n = fwdCount(plan);
  const weekly = otWeeks?.length === n ? otWeeks : Array(n).fill(defaultOtWeekly(plan));
  const otTotal = doneRec ? weekly.reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  const [localMsg, setLocalMsg] = useState('');

  useEffect(() => {
    setLocalMsg('');
  }, [plan.capId]);

  return (
    <div className="tsec on" data-sec="exe">
      <div className="card in">
        <div className="ch">
          <b>Review &amp; execute</b>
          <span className="tag">post to CAP-ABILITY</span>
        </div>
        <div className="kpis">
          <div className="kpi">
            <b>{f2(otTotal)} hrs</b>
            <span>Overtime auth</span>
          </div>
          <div className="kpi">
            <b>{f2(doneRec ? rec.xr : 0)} FTE</b>
            <span>Cross-util / loans</span>
          </div>
          <div className="kpi">
            <b>{doneRec ? rec.starts : 0}</b>
            <span>New hire reqs</span>
          </div>
        </div>
        {!doneRec ? (
          <p>Accept a recommendation first, then tick packages in the portfolio queue — or execute this plan&apos;s package here.</p>
        ) : (
          <div className="insight info">
            <b>{plan.capId}</b> {plan.plan} · OT {f2(otTotal)} hrs · cross-util +{f2(rec.xr)} · hire {rec.starts} ·{' '}
            <span className="pos-t">accepted</span>
          </div>
        )}
        <div className="acts">
          <div className="btn p" data-view="queue" onClick={onOpenQueue}>
            Open action queue
          </div>
          <div
            className="btn g"
            data-act="exec-sim"
            onClick={async () => {
              if (!doneRec) {
                setLocalMsg('No approved package yet — accept a recommendation first.');
                return;
              }
              const res = await onExecutePlan?.();
              setLocalMsg(res?.message || 'Posted package to CAP-ABILITY.');
            }}
          >
            Execute selected →
          </div>
        </div>
        {(execDone || localMsg || execMsg) ? (
          <div className={`insight ${doneRec && (execDone || execMsg) ? 'pos' : 'warn'}`} data-act="exec-result">
            <b>{execDone ? 'Posted.' : ''}</b> {execMsg || localMsg || 'Package posted to CAP-ABILITY (demo store).'}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function PlanTabs({
  activeTab,
  plan,
  state,
  allPlans = [],
  decisions = {},
  otWeeks = [],
  onEditorChange,
  onSubmitShrinkage,
  onMapRoster,
  onAcceptRec,
  onRejectRec,
  onOpenQueue,
  onDecide,
  onOtWeekChange,
  onExecutePlan,
  onRecOverride,
}) {
  if (!plan) return null;

  const gotBy = computeXutil(allPlans.length ? allPlans : [plan]).gotBy;

  return (
    <>
      {activeTab === 'ov' && <OverviewTab plan={plan} />}
      {activeTab === 'fw' && <ForecastTab plan={plan} decisions={decisions} onDecide={onDecide} />}
      {activeTab === 'hc' && <HeadcountTab plan={plan} />}
      {activeTab === 'nh' && <NewHireTab plan={plan} doneRoster={state.doneRoster} onMapRoster={onMapRoster} />}
      {activeTab === 'shr' && (
        <ShrinkageTab
          plan={plan}
          state={state}
          onEditorChange={onEditorChange}
          onSubmitShrinkage={onSubmitShrinkage}
          decisions={decisions}
          onDecide={onDecide}
        />
      )}
      {activeTab === 'att' && <AttritionTab plan={plan} onDecide={onDecide} />}
      {activeTab === 'rec' && (
        <RecommendTab
          plan={plan}
          doneRoster={state.doneRoster}
          doneRec={state.doneRec}
          onAccept={onAcceptRec}
          onReject={onRejectRec}
          decisions={decisions}
          otWeeks={otWeeks}
          onOtWeekChange={onOtWeekChange}
          gotBy={gotBy}
          onRecOverride={onRecOverride}
        />
      )}
      {activeTab === 'exe' && (
        <ExecuteTab
          plan={plan}
          doneRec={state.doneRec}
          otWeeks={otWeeks}
          gotBy={gotBy}
          onOpenQueue={onOpenQueue}
          onExecutePlan={onExecutePlan}
          execDone={state.execDone}
          execMsg={state.execMsg}
        />
      )}
    </>
  );
}
