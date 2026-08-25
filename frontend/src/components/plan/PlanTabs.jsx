import { useEffect, useMemo, useRef, useState } from 'react';
import { f2 } from '../../utils/format';
import {
  computeXutil,
  defaultOtWeekly,
  fwdCount,
  computeClosing,
  applyLiveShrinkage,
  applyLiveAttrition,
  kpiTrends,
  ouColor,
  planRec,
  segmentShrinkage,
  shrRec,
  statusOf,
  weeks12,
} from '../../utils/planLogic';
import { readRosterFile } from '../../utils/rosterCsv';
import SeriesChart, { DecisionBar, KpiTrendCard, sparkMini } from '../SeriesChart';
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
  const trends = kpiTrends(plan);
  const ouNow = plan.ouShrink ?? plan.sOU?.[plan.curIdx] ?? plan.ou ?? 0;

  return (
    <div className="tsec on" data-sec="ov">
      <div className="card in">
        <div className="ch">
          <b>Plan overview</b>
          <span className="tag">step 1</span>
        </div>
        <div className="kpis trend-kpis">
          <KpiTrendCard
            heading="Shrinkage · 12wk"
            value={plan.shrink12}
            suffix="%"
            caption="planned trend"
            color="#2a78d6"
            values={trends.shrink.values}
            weeks={trends.shrink.weeks}
            markIdx={trends.shrink.mark}
            unit="%"
          />
          <KpiTrendCard
            heading="Attrition · 12wk"
            value={plan.attr12}
            suffix="%"
            caption="production, planned"
            color="#eb6834"
            values={trends.attr.values}
            weeks={trends.attr.weeks}
            markIdx={trends.attr.mark}
            unit="%"
          />
          <KpiTrendCard
            heading="Hiring · 12wk"
            value={plan.hire12}
            caption="planned new-hire HC"
            color="#1a9e6a"
            values={trends.hire.values}
            weeks={trends.hire.weeks}
            markIdx={trends.hire.mark}
            unit="HC"
          />
          <KpiTrendCard
            heading="O/U with shrinkage"
            value={ouNow}
            caption={`vs billable ${f2(plan.ou)}`}
            color={ouNow < 0 ? '#e0483f' : '#1a9e6a'}
            tone={ouNow < 0 ? 'neg' : 'pos'}
            values={trends.ou.values}
            weeks={trends.ou.weeks}
            markIdx={trends.ou.mark}
            unit="FTE"
          />
        </div>
        <div className="slabel">FTE over / under — week on week (this week marked)</div>
        <SeriesChart
          weeks={plan.weeks}
          curIdx={plan.curIdx}
          zeroLine
          height={220}
          valueUnit="FTE"
          bars={[
            {
              label: 'O/U',
              tipLabel: 'O/U',
              data: plan.sOU,
              color: (v, i) => ouColor(v, i, plan.curIdx),
            },
          ]}
        />
      </div>
    </div>
  );
}

function ForecastTab({ plan, decisions, onDecide, onSubmitForecast }) {
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
  const [lastEdit, setLastEdit] = useState({ kind: 'vol', idx: plan.curIdx });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setFcst([...(plan.sFcst || [])]);
    setAhtGoal([...(plan.sAhtGoal || [])]);
    setSubmitted(false);
    setLastEdit({ kind: 'vol', idx: plan.curIdx });
  }, [plan.capId]);

  const actVol = (plan.sActVol || []).map((v, i) => (i <= plan.curIdx ? v : null));
  const ahtAct = (plan.sAhtAct || []).map((v, i) => (i <= plan.curIdx ? v : null));
  const d = decisions?.fw || {};
  const volMax = Math.max(...(plan.sFcst || []).filter((v) => v != null), 1000) * 1.4;
  const volSnap = volMax > 20000 ? 250 : volMax > 5000 ? 50 : volMax > 1000 ? 10 : 5;

  const applyFcstValue = () => {
    const idx = lastEdit.kind === 'vol' ? lastEdit.idx : plan.curIdx;
    const val = fcst[idx];
    if (val == null) return;
    setFcst((arr) => arr.map((v, i) => (i >= plan.curIdx ? val : v)));
    setSubmitted(false);
    onDecide?.('fw', 'vol', 'mod');
  };
  const applyAhtValue = () => {
    const idx = lastEdit.kind === 'aht' ? lastEdit.idx : plan.curIdx;
    const val = ahtGoal[idx];
    if (val == null) return;
    setAhtGoal((arr) => arr.map((v, i) => (i >= plan.curIdx ? val : v)));
    setSubmitted(false);
    onDecide?.('fw', 'aht', 'mod');
  };

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
        <div className="repbar" style={{ marginBottom: 8 }}>
          <button type="button" className="repbtn" data-act="fw-apply-vol" onClick={applyFcstValue}>
            ↔ Apply forecast value to all weeks
          </button>
        </div>
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
            setLastEdit({ kind: 'vol', idx: i });
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
        <div className="repbar" style={{ marginBottom: 8 }}>
          <button type="button" className="repbtn" data-act="fw-apply-aht" onClick={applyAhtValue}>
            ↔ Apply AHT value to all weeks
          </button>
        </div>
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
            setLastEdit({ kind: 'aht', idx: i });
            setSubmitted(false);
            onDecide?.('fw', 'aht', 'mod');
          }}
        />
        <div className="acts" style={{ marginTop: 10 }}>
          <div
            className="btn p"
            data-act="fw-submit"
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmitForecast?.({ fcst, aht_goal: ahtGoal });
                setSubmitted(true);
                onDecide?.('fw', 'vol', d.vol === 'acc' ? 'acc' : 'mod');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Submitting…' : '⬆ Submit forecast / AHT changes'}
          </div>
        </div>
        {submitted ? (
          <div className="insight pos" data-act="fw-submitted">
            <b>Submitted.</b> Forecast / AHT saved for this plan.
          </div>
        ) : null}
      </div>
    </div>
  );
}

const HC_NEG = new Set(['tout', 'loaIn', 'attr', 'promo']);
const HC_ROWS = [
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
const HC_MOVE_KEYS = [
  ['nest', 'Nesting → Production'],
  ['tin', 'Transfer In'],
  ['tout', 'Transfer Out'],
  ['loaOut', 'Back from LOA'],
  ['loaIn', 'Move to LOA'],
  ['attr', 'Production Attrition'],
  ['promo', 'Promotion (out)'],
];

function hcSnapshot(src) {
  const hc = { ...(src || {}) };
  hc.closing = computeClosing(hc);
  return hc;
}

function moveCell(hc, key, grp) {
  const v = Number(hc?.[key]) || 0;
  if (grp) return f2(v);
  if (v === 0) return '0.00';
  return `${HC_NEG.has(key) ? '−' : '+'}${f2(Math.abs(v))}`;
}

function moveClass(key, grp) {
  if (grp) return '';
  return HC_NEG.has(key) ? 'neg-t' : 'pos-t';
}

function signedDelta(v) {
  const n = Number(v) || 0;
  return {
    txt: `${n < 0 ? '−' : '+'}${f2(Math.abs(n))}`,
    cls: n < 0 ? 'neg-t' : 'pos-t',
  };
}

function HeadcountTab({ plan, onSaveHeadcount }) {
  const baseCur = plan.hcCur;
  const [editing, setEditing] = useState(false);
  const [cur, setCur] = useState(() => hcSnapshot(baseCur));
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const tableRef = useRef(null);

  useEffect(() => {
    setCur(hcSnapshot(plan.hcCur));
    setEditing(false);
    setSaved(false);
  }, [plan.capId]);

  useEffect(() => {
    if (editing) return;
    setCur(hcSnapshot(plan.hcCur));
  }, [editing, plan.hcCur]);

  if (!baseCur) {
    return (
      <div className="tsec on" data-sec="hc">
        <div className="card in">
          <div className="ch">
            <b>FTE FLOW</b>
          </div>
          <p>No headcount snapshot for this plan.</p>
        </div>
      </div>
    );
  }

  const last = hcSnapshot(plan.hcLast || { opening: baseCur.opening });
  const live = hcSnapshot(cur);
  const prevWk = plan.weeks[Math.max(0, plan.curIdx - 1)] || '';
  const curWk = plan.weeks[plan.curIdx] || '';
  const net = signedDelta(live.closing - last.closing);

  return (
    <div className="tsec on" data-sec="hc">
      <div className="hc-strip">
        <div>
          <div className="hc-k">Plan</div>
          <div className="hc-plan">
            <span className="hc-cap">
              {plan.capId} <span className="hc-caret">▾</span>
            </span>
            <b>{plan.plan}</b>
          </div>
          <div className="hc-sub">
            {plan.program} · {plan.region} · {plan.site}
          </div>
        </div>
        <div>
          <div className="hc-k">Close — last wk</div>
          <div className="hc-v">{f2(last.closing)}</div>
        </div>
        <div>
          <div className="hc-k">Open — this wk</div>
          <div className="hc-v">{f2(live.opening)}</div>
        </div>
        <div>
          <div className="hc-k">Close — this wk</div>
          <div className="hc-v">{f2(live.closing)}</div>
        </div>
        <div>
          <div className="hc-k">Net Δ</div>
          <div className={`hc-v ${net.cls}`}>{net.txt}</div>
        </div>
        <div>
          <div className="hc-k">Tfr in/out</div>
          <div className="hc-v">
            {f2(live.tin)} / {f2(live.tout)}
          </div>
        </div>
        <div>
          <div className="hc-k">Attr</div>
          <div className="hc-v">{f2(live.attr)}</div>
        </div>
        <div>
          <div className="hc-k">Detail</div>
          <button
            type="button"
            className="hc-chip"
            onClick={() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
          >
            ☰ FTE flow
          </button>
        </div>
      </div>

      <div className="card in" ref={tableRef}>
        <div className="ch">
          <b>FTE FLOW — {plan.plan}</b>
          <button
            type="button"
            className="btn hc-upd"
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
            {HC_MOVE_KEYS.map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={cur[key] ?? 0}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    setCur((h) => hcSnapshot({ ...h, [key]: val }));
                    setSaved(false);
                  }}
                />
              </label>
            ))}
            <button
              type="button"
              className="btn p"
              data-act="hc-save"
              disabled={busy}
              onClick={async () => {
                const next = hcSnapshot(cur);
                setCur(next);
                setBusy(true);
                try {
                  await onSaveHeadcount?.({
                    opening: next.opening,
                    nest: next.nest,
                    tin: next.tin,
                    tout: next.tout,
                    loa_in: next.loaIn,
                    loa_out: next.loaOut,
                    attr: next.attr,
                    promo: next.promo,
                    closing: next.closing,
                  });
                  setSaved(true);
                  setEditing(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Saving…' : 'Save movements'}
            </button>
          </div>
        ) : null}
        {saved ? (
          <div className="insight pos" data-act="hc-saved">
            <b>Movements saved.</b> Closing FTE is now {f2(live.closing)}. Projected FTE, O/U, attrition
            this week, and recommended OT all use this closing.
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
            {HC_ROWS.map(([label, key, grp]) => (
              <tr key={label} className={grp ? 'grp-row' : ''}>
                <td>{label}</td>
                <td className={moveClass(key, grp)}>{moveCell(last, key, grp)}</td>
                <td className={moveClass(key, grp)}>{moveCell(live, key, grp)}</td>
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
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => {
    setUploadNote('');
    setBusy(false);
  }, [plan.capId]);

  if (!cls) {
    return (
      <div className="tsec on" data-sec="nh">
        <div className="card in">
          <div className="ch">
            <b>New-hire &amp; onboarding</b>
            <span className="tag">new hire</span>
          </div>
          <p>No class in the planning window for this plan.</p>
        </div>
      </div>
    );
  }

  const className = cls.name || cls.className || `TC_2026_${String(plan.capId || '').replace(/\D/g, '')}`;
  const status = String(cls.status || 'missing').toLowerCase();
  const mapped = status === 'mapped' || status === 'uploaded' || status === 'partial' || status === 'planned';
  const uploaded = status === 'uploaded' && (cls.rosterFile || cls.employeeCount > 0);
  const planHc = Number(cls.plan) || 0;
  const trainHc = Number(cls.trainHC) || planHc;
  const onboarded = mapped ? Number(cls.actual) || 0 : 0;
  const coverageGap = Math.abs(plan.sustained || 0);
  const previewGap = Math.max(0, coverageGap - trainHc);
  const liveGap = coverageGap;
  const stLabel =
    status === 'planned'
      ? '◷ Planned (from Execute)'
      : uploaded
        ? '✓ Uploaded'
        : mapped
          ? '✓ Mapped'
          : status === 'partial'
            ? '◑ Partial'
            : '✕ Not uploaded';

  const mapPayload = (extra = {}) => ({
    cap_id: plan.capId,
    class_id: cls.id,
    train_hc: extra.train_hc ?? trainHc,
    ...extra,
  });

  const doQuickMap = async () => {
    setBusy(true);
    setUploadNote(`Mapping ${f2(trainHc)} trained FTE for ${className} to Class Reference…`);
    try {
      await onMapRoster?.(mapPayload());
      setUploadNote(`Mapped ${f2(trainHc)} FTE for ${className} against Class Reference.`);
    } catch (err) {
      setUploadNote(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const doUploadFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const parsed = await readRosterFile(file);
      if (!parsed.rows.length) {
        setUploadNote(parsed.errors.join(' ') || 'Empty CSV');
        return;
      }
      setUploadNote(`Reading ${parsed.filename} · ${parsed.rows.length} employees…`);
      await onMapRoster?.(
        mapPayload({
          train_hc: parsed.totalFte,
          employees: parsed.rows,
          source_filename: parsed.filename,
        }),
      );
      setUploadNote(
        `Uploaded ${parsed.filename} · ${parsed.rows.length} employees · ${f2(parsed.totalFte)} FTE mapped`,
      );
    } catch (err) {
      setUploadNote(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tsec on" data-sec="nh">
      <div className={`card ${mapped ? 'good in' : 'warn in'}`}>
        <div className="ch">
          <b>{mapped ? 'New-hire class' : 'Roster gap — this one does matter'}</b>
          <span className={`chiptag ${mapped ? 'ok' : 'miss'}`}>{stLabel}</span>
        </div>
        {!mapped ? (
          <p>
            Class <b>{className}</b> ran on <b>{cls.date || '—'}</b>.{' '}
            <b>{f2(trainHc)} FTE</b> of trained heads are onboarded but not on the employee roster, so
            projected FTE excludes them and the shortfall reads worse than it is.
          </p>
        ) : (
          <p>
            {uploaded
              ? `${cls.employeeCount || 0} employees from ${cls.rosterFile} are on the roster.`
              : `${f2(onboarded)} FTE mapped to class reference ${className}.`}{' '}
            Projected FTE includes them.
          </p>
        )}
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
              {f2(onboarded)} / {f2(planHc)}
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
              <td>{cls.date || '—'}</td>
              <td>{f2(planHc)}</td>
              <td className={mapped ? 'pos-t' : 'neg-t'}>{f2(onboarded)}</td>
              <td className={mapped ? 'pos-t' : 'neg-t'}>
                {uploaded ? 'Uploaded' : mapped ? 'Mapped' : 'Not uploaded'}
              </td>
            </tr>
          </tbody>
        </table>
        {!mapped ? (
          <div className="math">
            <div className="mline">
              <span>Reported 12-week gap</span>
              <span>{f2(coverageGap)} FTE</span>
            </div>
            <div className="mline cut">
              <span>Onboarded, not on roster</span>
              <span>−{f2(trainHc)} FTE</span>
            </div>
            <div className="mline">
              <span>Real gap after map</span>
              <span>{f2(previewGap)} FTE</span>
            </div>
          </div>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={doUploadFile}
        />
        <div className="acts">
          <button type="button" className="btn p" data-act="go-roster" disabled={busy} onClick={doQuickMap}>
            {busy ? 'Mapping…' : mapped ? 'Remap the roster' : 'Map the roster'}
          </button>
          <button
            type="button"
            className="btn g"
            data-act="nh-file"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Upload file
          </button>
        </div>
        {uploadNote ? <div className="insight info">{uploadNote}</div> : null}
        <div className={`done ${mapped ? 'on' : ''}`} id="doneRoster">
          <span>✓</span>
          <span>
            {f2(onboarded)} FTE mapped · projected FTE corrected · gap now {f2(liveGap)}
          </span>
        </div>
      </div>
    </div>
  );
}

function ShrinkageTab({
  plan,
  state,
  onEditorChange,
  onSubmitShrinkage,
  onResetShrinkage,
  onApplyShrinkageValue,
  onApplyShrinkagePct,
  decisions,
  onDecide,
}) {
  const past = (plan.sShrink || []).map((v, i) => (i <= plan.curIdx ? v : null));
  const [showSeg, setShowSeg] = useState(false);
  useEffect(() => {
    setShowSeg(false);
  }, [plan.capId]);

  const segs = useMemo(() => segmentShrinkage(plan), [plan]);
  const editorWeeks = state.editorWeeks || [];
  const dragUntilIdx = editorWeeks.length
    ? Math.max(...editorWeeks.map((w) => w.weekIdx))
    : plan.curIdx;

  const displayLine = useMemo(() => {
    const line = (plan.sShrinkPlan || []).map((v, i) => (i < plan.curIdx ? null : v));
    editorWeeks.forEach((ew) => {
      if (ew?.weekIdx != null && ew.weekIdx >= plan.curIdx) line[ew.weekIdx] = ew.cur;
    });
    return line;
  }, [plan.sShrinkPlan, editorWeeks, plan.curIdx]);

  const fwdVals = displayLine.slice(plan.curIdx, plan.curIdx + 12).filter((v) => v != null);
  const planFwd = fwdVals.length
    ? fwdVals.reduce((a, b) => a + b, 0) / fwdVals.length
    : plan.shrink12 || 0;
  const rec = shrRec(plan, planFwd);
  const actual8 = rec.actAvg;
  const variance = actual8 - planFwd;
  const decision = decisions?.shr;

  const applyDrag = (weekIdx, value) => {
    const editorIdx = editorWeeks.findIndex((w) => w.weekIdx === weekIdx);
    if (editorIdx < 0) return;
    onEditorChange?.(editorIdx, value, true);
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
        <div className={`insight ${rec.dir === 'ok' ? 'pos' : 'warn'}`} style={{ marginTop: 8 }}>
          <b>Recommendation:</b> {rec.t}.
          {rec.dir !== 'ok' ? (
            <>
              {' '}
              <b>Recommended:</b> set plan shrinkage to ~{f2(rec.actAvg)}% for the forward weeks.
            </>
          ) : null}
          <div style={{ fontSize: '.72rem', color: 'var(--dim)', marginTop: 4 }}>
            Recent 8-wk actual avg {f2(rec.actAvg)}% vs planned {f2(rec.plan)}% over next 12 wk.
            Graph and sliders are the same 12 weeks. Other tabs update live; Submit writes the plan.
          </div>
        </div>
        <DecisionBar
          decision={decision}
          onAccept={() => {
            const target = rec.actAvg;
            editorWeeks.forEach((ew, k) => onEditorChange?.(k, target, true));
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
              Planned vs unplanned · next 12 wk · 55/45 split of Total (source has no segment rows)
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
                    <span>{Math.round((segs.weights[cat] || 0) * 100)}% of live total · assumed mix</span>
                    <div style={{ marginTop: 6 }}>
                      {sparkMini({
                        values: vals,
                        weeks: plan.weeks.slice(plan.curIdx, plan.curIdx + 12),
                        color: SEG_COLORS[cat] || '#2a78d6',
                        unit: '%',
                        label: cat,
                      })}
                    </div>
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
          tooltipUnit="%"
          bars={[{ label: 'Actual', data: past, color: '#2a78d6' }]}
          line={{ label: 'Plan', data: displayLine, color: '#c98aa0' }}
          dragFromIdx={plan.curIdx}
          dragUntilIdx={dragUntilIdx}
          snap={0.05}
          minV={0}
          maxV={70}
          dragHint="↕ Drag plan points for this week through the next 12 (same weeks as the sliders)"
          onDragPoint={applyDrag}
        />
        {editorWeeks.length ? (
          <ShrinkageEditor
            weeks={editorWeeks}
            billable={plan.billable}
            onChange={onEditorChange}
            editSrc={state.editSrc}
            netReq={state.netReq}
            lastEditIdx={state.shrLastEdit}
            onSubmit={onSubmitShrinkage}
            onReset={onResetShrinkage}
            onApplyValue={onApplyShrinkageValue}
            onApplyPct={onApplyShrinkagePct}
            doneShr={state.doneShr}
          />
        ) : null}
      </div>
    </div>
  );
}

function AttritionTab({
  plan,
  state,
  onEditorChange,
  onSubmitAttrition,
  onResetAttrition,
  onApplyValue,
  onApplyPct,
  onDecide,
}) {
  const past = (plan.sAttr || []).slice(Math.max(0, plan.curIdx - 8), plan.curIdx + 1).filter((v) => v != null);
  const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : plan.attr12 || 0;
  const attrWeeks = state.attrWeeks || [];
  const dragUntilIdx = attrWeeks.length
    ? Math.max(...attrWeeks.map((w) => w.weekIdx))
    : plan.curIdx;

  const displayLine = useMemo(() => {
    const line = (plan.sAttrPlan || []).map((v, i) => (i < plan.curIdx ? null : v));
    attrWeeks.forEach((ew) => {
      if (ew?.weekIdx != null && ew.weekIdx >= plan.curIdx) line[ew.weekIdx] = ew.cur;
    });
    return line;
  }, [plan.sAttrPlan, attrWeeks, plan.curIdx]);

  const fwdVals = displayLine.slice(plan.curIdx, plan.curIdx + 12).filter((v) => v != null);
  const planFwd = fwdVals.length
    ? fwdVals.reduce((a, b) => a + b, 0) / fwdVals.length
    : plan.attr12 || 0;
  const plannedThis = displayLine[plan.curIdx] ?? planFwd;
  const variance = planFwd - avg;
  const act = (plan.sAttr || []).map((v, i) => (i <= plan.curIdx ? v : null));
  const srcIdx = state.attrLastEdit != null && attrWeeks[state.attrLastEdit] ? state.attrLastEdit : 0;
  const src = attrWeeks[srcIdx];
  const lastVal = src?.cur;
  const lastBase = src?.base;
  const pct =
    lastBase != null && lastBase !== 0 && lastVal != null
      ? Math.round(((lastVal - lastBase) / lastBase) * 1000) / 10
      : null;

  const applyDrag = (weekIdx, value) => {
    const editorIdx = attrWeeks.findIndex((w) => w.weekIdx === weekIdx);
    if (editorIdx < 0) return;
    onEditorChange?.(editorIdx, value);
    onDecide?.('att', null, 'mod');
  };

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
            <b>{f2(planFwd)}%</b>
            <span>Planned fwd · 12wk</span>
          </div>
          <div className={`kpi ${variance > 0.2 ? 'neg' : variance < -0.2 ? 'pos' : ''}`}>
            <b>
              {variance >= 0 ? '+' : ''}
              {f2(variance)}pt
            </b>
            <span>Variance vs actual</span>
          </div>
        </div>
        <div className="insight info" style={{ marginTop: 8 }}>
          This week plan {f2(plannedThis)}%. Attrition % × stock FTE leaves the projection; later weeks inherit that loss.
          Graph and sliders are the same 12 weeks. Overview / Recommend / New Hire update live; Submit writes the plan.
        </div>
        <SeriesChart
          weeks={plan.weeks}
          curIdx={plan.curIdx}
          height={200}
          yFmt={(v) => `${f2(v)}%`}
          bars={[{ label: 'Actual', data: act, color: '#2a78d6' }]}
          line={{ label: 'Plan', data: displayLine, color: '#2b2f36' }}
          dragFromIdx={plan.curIdx}
          dragUntilIdx={dragUntilIdx}
          snap={0.1}
          minV={0}
          maxV={40}
          dragHint="↕ Drag plan points for this week through the next 12 (same weeks as the sliders)"
          onDragPoint={applyDrag}
        />
        {attrWeeks.length ? (
          <div className="edit">
            <div className="enote">
              <b>Adjust forward weeks</b> · next {attrWeeks.length} wk · attr FTE = stock × rate · New O/U uses live
              projected FTE
            </div>
            <div className="repbar">
              <span className="repk">
                Last edit {src?.wk || '—'} → <b>{f2(lastVal)}%</b>
                {pct != null ? ` (${pct > 0 ? '+' : ''}${f2(pct)}%)` : ''}
              </span>
              <button type="button" className="repbtn" data-act="att-apply-val" onClick={() => onApplyValue?.()}>
                ↔ Apply value to all weeks
              </button>
              <button
                type="button"
                className="repbtn"
                data-act="att-apply-pct"
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
              <span>Attrition</span>
              <span style={{ textAlign: 'right' }}>%</span>
              <span style={{ textAlign: 'right' }}>Attr FTE</span>
              <span style={{ textAlign: 'right' }}>New O/U</span>
            </div>
            <div>
              {attrWeeks.map((w, k) => {
                const attrFte = ((Number(w.stock) || 0) * (Number(w.cur) || 0)) / 100;
                const ou = Number(plan.sOU?.[w.weekIdx]);
                return (
                  <div className={`erow ${k === srcIdx ? 'hl' : ''}`} key={w.weekIdx ?? k}>
                    <span className="wk">{w.wk}</span>
                    <input
                      type="range"
                      min="0"
                      max="40"
                      step="0.1"
                      value={w.cur}
                      onChange={(e) => {
                        onEditorChange?.(k, parseFloat(e.target.value));
                        onDecide?.('att', null, 'mod');
                      }}
                    />
                    <input
                      type="number"
                      min="0"
                      max="40"
                      step="0.1"
                      value={Number(w.cur).toFixed(2)}
                      onChange={(e) => {
                        onEditorChange?.(k, parseFloat(e.target.value));
                        onDecide?.('att', null, 'mod');
                      }}
                    />
                    <span className="rq">{f2(attrFte)}</span>
                    <span className={`ou ${ou < 0 ? 'neg-t' : 'pos-t'}`}>{f2(ou)}</span>
                  </div>
                );
              })}
            </div>
            <div className="acts">
              <div className="btn p" data-act="att-submit" onClick={() => onSubmitAttrition?.()}>
                Submit attrition plan
              </div>
              <div className="btn g" data-act="att-reset" onClick={() => onResetAttrition?.()}>
                Reset
              </div>
            </div>
            <div className={`done ${state.doneAttr ? 'on' : ''}`}>
              <span>✓</span>
              <span>Forward weeks submitted · projected FTE and O/U recalculated</span>
            </div>
          </div>
        ) : null}
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
  const rec = planRec(plan, {
    otPct: ovr.otPct ?? 5,
    xr: ovr.xr,
    starts: ovr.starts,
    trainWk: ovr.trainWk,
    nestWk: ovr.nestWk,
    gotBy,
  });
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
            <span>
              ③ Hire starts
              {rec.starts > 0
                ? ` · productive in +${rec.productiveIn} wk (train ${rec.trainWk} + nest ${rec.nestWk})`
                : ''}
            </span>
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
            <label>
              Train wk
              <input
                type="number"
                min="0"
                step="1"
                value={ovr.trainWk ?? rec.trainWk}
                onChange={(e) => onRecOverride?.({ trainWk: parseInt(e.target.value, 10) || 0 })}
              />
            </label>
            <label>
              Nest wk
              <input
                type="number"
                min="0"
                step="1"
                value={ovr.nestWk ?? rec.nestWk}
                onChange={(e) => onRecOverride?.({ nestWk: parseInt(e.target.value, 10) || 0 })}
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
            Package accepted · OT {f2(otTotal)} hrs · cross-util {f2(rec.xr)} · hire {rec.starts}
            {rec.starts > 0 ? ` (prod +${rec.productiveIn}wk)` : ''} · queued
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
  onResetShrinkage,
  onApplyShrinkageValue,
  onApplyShrinkagePct,
  onSubmitAttrition,
  onResetAttrition,
  onApplyAttritionValue,
  onApplyAttritionPct,
  onAttritionChange,
  onSubmitForecast,
  onSaveHeadcount,
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

  const livePlan = applyLiveShrinkage(applyLiveAttrition(plan, state?.attrWeeks), state?.editorWeeks);
  const plansForXutil = (allPlans.length ? allPlans : [livePlan]).map((p) =>
    p.capId === livePlan.capId ? livePlan : p,
  );
  const gotBy = computeXutil(plansForXutil).gotBy;

  return (
    <>
      {activeTab === 'ov' && <OverviewTab plan={livePlan} />}
      {activeTab === 'fw' && (
        <ForecastTab plan={livePlan} decisions={decisions} onDecide={onDecide} onSubmitForecast={onSubmitForecast} />
      )}
      {activeTab === 'hc' && <HeadcountTab plan={livePlan} onSaveHeadcount={onSaveHeadcount} />}
      {activeTab === 'nh' && <NewHireTab plan={livePlan} doneRoster={state.doneRoster} onMapRoster={onMapRoster} />}
      {activeTab === 'shr' && (
        <ShrinkageTab
          plan={livePlan}
          state={state}
          onEditorChange={onEditorChange}
          onSubmitShrinkage={onSubmitShrinkage}
          onResetShrinkage={onResetShrinkage}
          onApplyShrinkageValue={onApplyShrinkageValue}
          onApplyShrinkagePct={onApplyShrinkagePct}
          decisions={decisions}
          onDecide={onDecide}
        />
      )}
      {activeTab === 'att' && (
        <AttritionTab
          plan={livePlan}
          state={state}
          onEditorChange={onAttritionChange}
          onSubmitAttrition={onSubmitAttrition}
          onResetAttrition={onResetAttrition}
          onApplyValue={onApplyAttritionValue}
          onApplyPct={onApplyAttritionPct}
          onDecide={onDecide}
        />
      )}
      {activeTab === 'rec' && (
        <RecommendTab
          plan={livePlan}
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
          plan={livePlan}
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
