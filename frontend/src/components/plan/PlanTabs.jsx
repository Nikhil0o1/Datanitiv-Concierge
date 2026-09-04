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
  planRec,
  planRecWithWeekly,
  recBaseline,
  recBenefitSummary,
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

export const PEEK_TAGS = {
  ov: 'Overview · KPI signals',
  fw: 'Forecast · volume & AHT',
  hc: 'Headcount · snapshot',
  nh: 'New Hire · roster & class',
  shr: 'Shrinkage · planned vs actual',
  att: 'Attrition · planned vs actual',
  rec: 'Recommend · the package',
  exe: 'Execute · nothing posts until you say so',
};

function TabPeek({ tab }) {
  const text = PEEK_TAGS[tab];
  if (!text) return null;
  return <span className="peektag">{text}</span>;
}

export { TAB_LABELS };

/** Core 7 steps match HTML; Forecast inserts after Overview for volume-based plans. */
export function tabsForPlan(plan) {
  const core = ['ov', 'hc', 'nh', 'shr', 'att', 'rec', 'exe'];
  if (plan?.isVol) return ['ov', 'fw', ...core.slice(1)];
  return core;
}

function OverviewTab({
  plan,
  decisions = {},
  gotBy = {},
  packages = [],
  editorWeeks = [],
  onGoTab,
  onDecide,
  onEditorChange,
  onAcceptRec,
  onRejectRec,
  onMapRoster,
  onOpenQueue,
  onBackPortfolio,
}) {
  const hc = plan.hcCur;
  const hcLast = plan.hcLast || hc;
  const cls = plan.cls;
  const clsName = cls?.name || cls?.className || '—';
  const clsMapped = cls && ['mapped', 'uploaded', 'partial', 'planned'].includes(String(cls.status || '').toLowerCase());
  const rec = planRec(plan, { gotBy });
  const shr = shrRec(plan);
  const attrPast = (plan.sAttr || []).slice(Math.max(0, plan.curIdx - 8), plan.curIdx + 1).filter((v) => v != null);
  const attrAct = attrPast.length ? attrPast.reduce((a, b) => a + b, 0) / attrPast.length : plan.attr12 || 0;
  const attrPlan = plan.attr12 || 0;
  const attrVar = attrAct - attrPlan;
  const shrDecision = decisions?.shr;
  const recDecision = decisions?.rec;
  const planQueued = packages.filter((p) => p.cap_id === plan.capId && !p.done && p.status !== 'rejected').length;
  const portQueued = packages.filter((p) => !p.done && p.status !== 'rejected').length;
  const netHc = hc && hcLast ? (Number(hc.closing) || 0) - (Number(hcLast.closing) || 0) : 0;

  const recChip = () => {
    const st = statusOf(plan);
    if (st === 'under' || st === 'critical') {
      return { cls: 'neg', t: `Short ~${f2(rec.gap)} FTE · OT ${f2(rec.otFTE)} + cross-util ${f2(rec.xr)} + hire ${rec.starts}` };
    }
    if (weeks12(plan).under >= 2) {
      return { cls: 'warn', t: `${weeks12(plan).under} of 12 wks short — OT / redistribute` };
    }
    if (st === 'surplus') {
      return { cls: 'good', t: `Surplus — lend up to ${f2(Math.max(0, plan.minOUfwd - 1))} FTE` };
    }
    return { cls: '', t: 'On plan — no shortfall weeks' };
  };
  const rc = recChip();
  const shrChip =
    shr.dir === 'up'
      ? { cls: 'neg', t: `▲ Raise ${f2(Math.abs(shr.gap))}pt` }
      : shr.dir === 'down'
        ? { cls: 'good', t: `▼ Lower ${f2(Math.abs(shr.gap))}pt` }
        : { cls: '', t: '✓ On plan' };

  return (
    <div className="tsec on" data-sec="ov">
      <div className="seclist">
        <div className="secrow" data-sec="hc" onClick={() => onGoTab?.('hc')} role="button" tabIndex={0}>
          <div className="sec-ic" style={{ background: '#EAF1FA' }}>👥</div>
          <div className="sec-main">
            <div className="sec-label">Headcount</div>
            <div className="sec-body">
              <span className="mstat"><i>Close · last</i><b>{f2(hcLast?.closing)}</b></span>
              <span className="mstat"><i>Open · this</i><b>{f2(hc?.opening)}</b></span>
              <span className="mstat"><i>Close · this</i><b>{f2(hc?.closing)}</b></span>
              <span className="mstat"><i>Net Δ</i><b className={netHc >= 0 ? 'pos' : 'neg'}>{netHc >= 0 ? '+' : ''}{f2(netHc)}</b></span>
              <span className="mstat"><i>Attr</i><b>{f2(hc?.attr)}</b></span>
            </div>
          </div>
          <div className="sec-actions">
            <button type="button" className="arrowbtn" data-step="hc" onClick={(e) => { e.stopPropagation(); onGoTab?.('hc'); }}>→</button>
          </div>
        </div>

        <div className="secrow" data-sec="nh" onClick={() => onGoTab?.('nh')} role="button" tabIndex={0}>
          <div className="sec-ic" style={{ background: '#FDF3E0' }}>🎓</div>
          <div className="sec-main">
            <div className="sec-label">New Hire</div>
            <div className="sec-body">
              <span className="mstat"><i>Class ref</i><b>{clsName}</b></span>
              <span className="mstat"><i>Start</i><b>{cls?.date || '—'}</b></span>
              <span className="mstat"><i>Plan HC</i><b>{f2(cls?.plan)}</b></span>
              {!clsMapped ? <span className="recchip neg">✕ not uploaded</span> : <span className="recchip good">✓ mapped</span>}
            </div>
          </div>
          <div className="sec-actions">
            {!clsMapped ? (
              <button type="button" className="qbtn adj" title="Upload roster" onClick={(e) => { e.stopPropagation(); onMapRoster?.(); }}>⬆</button>
            ) : null}
            <button type="button" className="arrowbtn" data-step="nh" onClick={(e) => { e.stopPropagation(); onGoTab?.('nh'); }}>→</button>
          </div>
        </div>

        <div className={`secrow ${shrDecision === 'acc' ? 'acc' : ''} ${shrDecision === 'rej' ? 'rej' : ''}`} data-sec="shr">
          <div className="sec-ic" style={{ background: '#EAF6F1' }}>📉</div>
          <div className="sec-main">
            <div className="sec-label">Shrinkage</div>
            <div className="sec-body">
              <span className="mstat"><i>Actual · 8wk</i><b>{f2(shr.actAvg)}%</b></span>
              <span className="mstat"><i>Planned</i><b>{f2(shr.plan)}%</b></span>
              <span className="mstat"><i>Variance</i><b className={shr.gap > 0 ? 'neg' : 'pos'}>{shr.gap >= 0 ? '+' : ''}{f2(shr.gap)}pt</b></span>
              <span className={`recchip ${shrChip.cls}`}>{shrChip.t}</span>
            </div>
          </div>
          <div className="sec-actions">
            <button
              type="button"
              className={`qbtn acc ${shrDecision === 'acc' ? 'on' : ''}`}
              title="Accept — apply actual avg to forward plan"
              onClick={(e) => {
                e.stopPropagation();
                const target = shr.actAvg;
                if (editorWeeks.length) {
                  editorWeeks.forEach((ew, k) => onEditorChange?.(k, target, true));
                }
                onDecide?.('shr', null, 'acc');
              }}
            >
              ✓
            </button>
            <button
              type="button"
              className={`qbtn rej ${shrDecision === 'rej' ? 'on' : ''}`}
              title="Reject — keep current planned shrinkage"
              onClick={(e) => {
                e.stopPropagation();
                onDecide?.('shr', null, 'rej');
              }}
            >
              ✕
            </button>
            <button type="button" className="qbtn adj" title="Adjust" onClick={(e) => { e.stopPropagation(); onGoTab?.('shr'); }}>✎</button>
            <button type="button" className="arrowbtn" data-step="shr" onClick={(e) => { e.stopPropagation(); onGoTab?.('shr'); }}>→</button>
          </div>
        </div>

        <div className="secrow" data-sec="att" onClick={() => onGoTab?.('att')} role="button" tabIndex={0}>
          <div className="sec-ic" style={{ background: '#F2F0EA' }}>📊</div>
          <div className="sec-main">
            <div className="sec-label">Attrition</div>
            <div className="sec-body">
              <span className="mstat"><i>Actual · 8wk</i><b>{f2(attrAct)}%</b></span>
              <span className="mstat"><i>Planned</i><b>{f2(attrPlan)}%</b></span>
              <span className="mstat"><i>Variance</i><b className={attrVar > 0 ? 'neg' : 'pos'}>{attrVar >= 0 ? '+' : ''}{f2(attrVar)}pt</b></span>
              <span className="recchip">{attrVar <= 0 ? '✓ On/below plan' : '▲ Above plan'}</span>
            </div>
          </div>
          <div className="sec-actions">
            <button type="button" className="arrowbtn" data-step="att" onClick={(e) => { e.stopPropagation(); onGoTab?.('att'); }}>→</button>
          </div>
        </div>

        <div className={`secrow ${recDecision === 'acc' ? 'acc' : ''} ${recDecision === 'rej' ? 'rej' : ''}`} data-sec="rec">
          <div className="sec-ic" style={{ background: '#FEF4DC' }}>⚡</div>
          <div className="sec-main">
            <div className="sec-label">Staffing Recommendation</div>
            <div className="sec-body">
              <span className={`recchip ${rc.cls}`}>{rc.t}</span>
            </div>
          </div>
          <div className="sec-actions">
            <button type="button" className={`qbtn acc ${recDecision === 'acc' ? 'on' : ''}`} title="Accept" onClick={() => onAcceptRec?.()}>✓</button>
            <button type="button" className={`qbtn rej ${recDecision === 'rej' ? 'on' : ''}`} title="Reject" onClick={() => onRejectRec?.()}>✕</button>
            <button type="button" className="qbtn adj" title="Modify" onClick={() => onGoTab?.('rec')}>✎</button>
            <button type="button" className="arrowbtn" data-step="rec" onClick={() => onGoTab?.('rec')}>→</button>
          </div>
        </div>

        <div className="secrow" data-sec="exec">
          <div className="sec-ic" style={{ background: '#FDF3E0' }}>🚀</div>
          <div className="sec-main">
            <div className="sec-label">Review &amp; execute</div>
            <div className="sec-body">
              <span className="mstat"><i>Queued · this plan</i><b>{planQueued}</b></span>
              <span className="mstat"><i>Queued · portfolio</i><b>{portQueued}</b></span>
              <span className="recchip">
                {planQueued ? `${planQueued} package(s) ready` : 'Accept a recommendation above to queue it'}
              </span>
            </div>
          </div>
          <div className="sec-actions">
            <button type="button" className="arrowbtn" data-view="port" onClick={() => (portQueued ? onOpenQueue?.() : onBackPortfolio?.())}>→</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ForecastTab({ plan, decisions, onDecide, onSubmitForecast }) {
  if (!plan.isVol) {
    return (
      <div className="tsec on" data-sec="fw">
        <TabPeek tab="fw" />
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
      <TabPeek tab="fw" />
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
        <TabPeek tab="hc" />
        <div className="card in">
          <div className="ch">
            <b>Headcount snapshot</b>
            <span className="tag">last week vs this week</span>
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
      <TabPeek tab="hc" />
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
          <b>Headcount snapshot</b>
          <span className="tag">last week vs this week</span>
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
        <TabPeek tab="nh" />
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
      <TabPeek tab="nh" />
      <div className={`card ${mapped ? 'good in' : 'warn in'}`}>
        <div className="ch">
          <b>{mapped ? 'New-hire class' : 'Roster gap — fix the input first'}</b>
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
  const [adjusting, setAdjusting] = useState(false);
  useEffect(() => {
    setShowSeg(false);
    setAdjusting(false);
  }, [plan.capId]);

  const segs = useMemo(() => segmentShrinkage(plan), [plan]);
  const editorWeeks = state.editorWeeks || [];
  const dragUntilIdx = editorWeeks.length
    ? Math.max(...editorWeeks.map((w) => w.weekIdx))
    : plan.curIdx;

  const displayLine = useMemo(() => {
    // Keep full plan series (incl. past) so hover shows Actual + Plan like the HTML chart.
    const line = [...(plan.sShrinkPlan || [])];
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
  const canEdit = adjusting || decision === 'mod';

  useEffect(() => {
    if (decision === 'mod') setAdjusting(true);
    if (decision === 'acc' || decision === 'rej') setAdjusting(false);
  }, [decision]);

  const applyDrag = (weekIdx, value) => {
    if (!canEdit) return;
    const editorIdx = editorWeeks.findIndex((w) => w.weekIdx === weekIdx);
    if (editorIdx < 0) return;
    onEditorChange?.(editorIdx, value, true);
    onDecide?.('shr', null, 'mod');
  };

  const openModify = () => {
    setAdjusting(true);
    onDecide?.('shr', null, 'mod');
  };

  const fwdSlice = (arr) => (arr || []).slice(plan.curIdx, plan.curIdx + 12);

  return (
    <div className="tsec on" data-sec="shr">
      <TabPeek tab="shr" />
      <div className="card in">
        <div className="ch">
          <b>Shrinkage trend</b>
          <span className="tag" style={{ marginLeft: 0 }}>8-wk actual vs forward plan</span>
          <button
            type="button"
            className="btn-adjust"
            data-act="shr-adjust"
            onClick={() => {
              if (canEdit) {
                setAdjusting(false);
              } else {
                openModify();
              }
            }}
          >
            ✎ {canEdit ? 'Hide editor' : 'Adjust future weeks'}
          </button>
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
            {canEdit ? (
              <>
                Recent 8-wk actual avg {f2(rec.actAvg)}% vs planned {f2(rec.plan)}% over next 12 wk. Graph and sliders
                are the same 12 weeks. Your edits stay when you Accept; <b>Submit writes the plan</b> to the backend.
              </>
            ) : (
              <>
                Recent 8-wk actual avg {f2(rec.actAvg)}% vs planned {f2(rec.plan)}% over next 12 wk. Accept applies the
                recommendation (~{f2(rec.actAvg)}%), or <b>✎ Modify</b> to set your own value (e.g. 41%), then Submit.
              </>
            )}
          </div>
        </div>
        <DecisionBar
          decision={decision}
          onAccept={() => {
            // If already editing / customized, keep those values (e.g. 41%).
            // Only apply the ~actual recommendation when Accepting from a clean state.
            const customized = editorWeeks.some(
              (w) => w && Number.isFinite(Number(w.cur)) && Number(w.cur) !== Number(w.base),
            );
            if (!canEdit && !customized) {
              const target = rec.actAvg;
              editorWeeks.forEach((ew, k) => onEditorChange?.(k, target, true));
            }
            setAdjusting(false);
            onDecide?.('shr', null, 'acc');
          }}
          onModify={openModify}
          onReject={() => {
            setAdjusting(false);
            onDecide?.('shr', null, 'rej');
          }}
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
          dragFromIdx={canEdit ? plan.curIdx : null}
          dragUntilIdx={canEdit ? dragUntilIdx : null}
          snap={0.05}
          minV={0}
          maxV={70}
          dragHint={
            canEdit
              ? '↕ Drag plan points for this week through the next 12 (same weeks as the sliders)'
              : null
          }
          onDragPoint={canEdit ? applyDrag : null}
        />
        {canEdit && editorWeeks.length ? (
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
  const [adjusting, setAdjusting] = useState(false);
  useEffect(() => {
    setAdjusting(false);
  }, [plan.capId]);

  const past = (plan.sAttr || []).slice(Math.max(0, plan.curIdx - 8), plan.curIdx + 1).filter((v) => v != null);
  const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : plan.attr12 || 0;
  const attrWeeks = state.attrWeeks || [];
  const dragUntilIdx = attrWeeks.length
    ? Math.max(...attrWeeks.map((w) => w.weekIdx))
    : plan.curIdx;

  const displayLine = useMemo(() => {
    // Keep full plan series (incl. past) so hover shows Actual + Plan like the HTML chart.
    const line = [...(plan.sAttrPlan || [])];
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
    if (!adjusting) return;
    const editorIdx = attrWeeks.findIndex((w) => w.weekIdx === weekIdx);
    if (editorIdx < 0) return;
    onEditorChange?.(editorIdx, value);
    onDecide?.('att', null, 'mod');
  };

  return (
    <div className="tsec on" data-sec="att">
      <TabPeek tab="att" />
      <div className="card in">
        <div className="ch">
          <b>Attrition trend</b>
          <span className="tag" style={{ marginLeft: 0 }}>production attrition</span>
          <button
            type="button"
            className="btn-adjust"
            data-act="att-adjust"
            onClick={() => setAdjusting((v) => !v)}
          >
            ✎ {adjusting ? 'Hide editor' : 'Adjust future weeks'}
          </button>
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
          {adjusting ? (
            <>
              This week plan {f2(plannedThis)}%. Attrition % × stock FTE leaves the projection; later weeks inherit that
              loss. Graph and sliders are the same 12 weeks. Overview / Recommend / New Hire update live; Submit writes
              the plan.
            </>
          ) : (
            <>
              Production attrition — last 8 weeks actual vs next 12 weeks plan. Click{' '}
              <b>✎ Adjust future weeks</b> to drag the plan line or edit week-by-week rates.
            </>
          )}
        </div>
        <SeriesChart
          weeks={plan.weeks}
          curIdx={plan.curIdx}
          height={200}
          yFmt={(v) => `${f2(v)}%`}
          bars={[{ label: 'Actual', tipLabel: 'Actual', data: act, color: '#2a78d6' }]}
          line={{
            label: 'Plan',
            tipLabel: 'Plan trend',
            data: displayLine,
            color: '#2b2f36',
            dash: '5 4',
          }}
          dragFromIdx={adjusting ? plan.curIdx : null}
          dragUntilIdx={adjusting ? dragUntilIdx : null}
          snap={0.1}
          minV={0}
          maxV={40}
          dragHint={
            adjusting
              ? '↕ Drag plan points for this week through the next 12 (same weeks as the sliders)'
              : null
          }
          onDragPoint={adjusting ? applyDrag : null}
        />
        {adjusting && attrWeeks.length ? (
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

function RecDiffRow({ label, before, after, unit = '', decimals = 2, emphasize = false }) {
  const fmt = (v) => (decimals === 0 ? String(Math.round(Number(v) || 0)) : f2(v));
  const bNum = Number(before) || 0;
  const aNum = Number(after) || 0;
  const changed = Math.abs(bNum - aNum) > (decimals === 0 ? 0.5 : 0.01);
  return (
    <div className={`rec-diff-row ${changed ? 'changed' : ''} ${emphasize ? 'emph' : ''}`}>
      <span className="rec-diff-label">{label}</span>
      <span className="rec-diff-before">{changed ? `${fmt(bNum)}${unit}` : '—'}</span>
      <span className="rec-diff-arrow" aria-hidden>
        →
      </span>
      <span className="rec-diff-after">{`${fmt(aNum)}${unit}`}</span>
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
  const decision = decisions?.rec;
  const n = fwdCount(plan);
  const baseline = recBaseline(plan);
  const rec = planRecWithWeekly(
    plan,
    {
      otPct: ovr.otPct ?? 5,
      xr: ovr.xr,
      starts: ovr.starts,
      trainWk: ovr.trainWk,
      nestWk: ovr.nestWk,
      gotBy,
    },
    otWeeks?.length === n ? otWeeks : null,
  );
  const weekly = otWeeks?.length === n ? otWeeks : Array(n).fill(defaultOtWeekly(plan, rec.otPct));
  const otTotal = weekly.reduce((a, b) => a + (Number(b) || 0), 0);
  const labels = plan.weeks.slice(plan.curIdx, plan.curIdx + n);
  const benefit = recBenefitSummary(plan, rec, baseline);
  const dismissed = decision === 'rej';

  let body;
  if (st === 'under' || st === 'critical') {
    body = (
      <>
        <div className="rec-diff-head">
          <span className="rec-diff-col">Current</span>
          <span className="rec-diff-col rec-diff-col-after">Recommended</span>
        </div>
        <div className="rec-diff">
          <RecDiffRow label="12-wk staffing gap" before={baseline.gap} after={rec.residual} unit=" FTE" emphasize />
          <RecDiffRow
            label="OT (avg weekly)"
            before={baseline.otHrs}
            after={rec.otHrs}
            unit=" hrs/wk"
          />
          <RecDiffRow label="OT capacity" before={baseline.otFTE} after={rec.otFTE} unit=" FTE" />
          <RecDiffRow label="Cross-util in" before={baseline.xr} after={rec.xr} unit=" FTE" />
          <RecDiffRow
            label="New hire starts"
            before={baseline.starts}
            after={rec.starts}
            unit=""
            decimals={0}
          />
          {rec.starts > 0 ? (
            <div className="rec-diff-note">
              Hires productive in <b>+{rec.productiveIn} wk</b> (train {rec.trainWk} + nest {rec.nestWk})
            </div>
          ) : null}
        </div>
        <div className="insight info rec-benefit">
          <b>Why accept:</b> {benefit}
        </div>
        {showMod ? (
          <div className="rec-mod-panel" data-act="rec-mod-panel">
            <div className="slabel">Adjust package levers</div>
            <div className="rec-mod">
              <label>
                OT %
                <input
                  type="number"
                  min="0"
                  max="20"
                  step="0.5"
                  value={ovr.otPct ?? 5}
                  onChange={(e) => {
                    const pct = parseFloat(e.target.value) || 0;
                    onRecOverride?.({ otPct: pct });
                    const hrs = defaultOtWeekly(plan, pct);
                    for (let i = 0; i < n; i += 1) onOtWeekChange?.(i, hrs);
                  }}
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
            <div className="slabel" style={{ marginTop: 10 }}>
              OT by week (hrs)
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
              Total OT: <b>{f2(otTotal)} hrs</b> across {n} week(s) · avg{' '}
              <b>{f2(rec.otHrs)} hrs/wk</b> ({f2(rec.otPct)}% of avail)
            </div>
          </div>
        ) : null}
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

  const showDecide = (st === 'under' || st === 'critical' || w.under >= 2 || st === 'surplus') && !dismissed;

  if (dismissed && (st === 'under' || st === 'critical')) {
    return (
      <div className="tsec on" data-sec="rec">
        <TabPeek tab="rec" />
        <div className="card in">
          <div className="ch">
            <b>Staffing recommendation</b>
            <span className="tag">dismissed</span>
          </div>
          <div className="insight warn">
            Recommendation dismissed for this cycle. Re-open by refreshing the plan or asking Vera to re-run staffing.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tsec on" data-sec="rec">
      <TabPeek tab="rec" />
      <div className="card good in">
        <div className="ch">
          <b>Staffing recommendation</b>
          <span className="tag">sequenced by cost</span>
        </div>
        {doneRoster ? <p style={{ fontSize: '.78rem', color: 'var(--dim)' }}>Roster mapped — gap adjusted before packaging.</p> : null}
        {body}
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
              ✕ Dismiss
            </div>
          </div>
        ) : null}
        <div className={`done ${doneRec ? 'on' : ''}`} id="doneRec">
          <span>✓</span>
          <span>
            Package accepted · OT {f2(otTotal)} hrs ({f2(rec.otHrs)}/wk) · cross-util {f2(rec.xr)} · hire {rec.starts}
            {rec.starts > 0 ? ` (prod +${rec.productiveIn}wk)` : ''} · queued for Execute
          </span>
        </div>
      </div>
    </div>
  );
}

function ExecuteTab({ plan, doneRec, otWeeks, gotBy, decisions, onOpenQueue, onExecutePlan, execDone, execMsg }) {
  const ovr = decisions?.recOvr || {};
  const n = fwdCount(plan);
  const weekly = otWeeks?.length === n ? otWeeks : Array(n).fill(defaultOtWeekly(plan));
  const rec = planRecWithWeekly(
    plan,
    {
      otPct: ovr.otPct ?? 5,
      xr: ovr.xr,
      starts: ovr.starts,
      trainWk: ovr.trainWk,
      nestWk: ovr.nestWk,
      gotBy,
    },
    doneRec ? weekly : null,
  );
  const otTotal = doneRec ? weekly.reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  const [localMsg, setLocalMsg] = useState('');
  const [execBusy, setExecBusy] = useState(false);

  useEffect(() => {
    setLocalMsg('');
  }, [plan.capId]);

  const resultMsg = execMsg || localMsg;
  const resultOk = execDone || (resultMsg && /posted|applied|\+.*fte/i.test(resultMsg));

  return (
    <div className="tsec on" data-sec="exe">
      <TabPeek tab="exe" />
      <div className="card in">
        <div className="ch">
          <b>Review &amp; execute</b>
          <span className="tag">this plan</span>
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
            <b>{plan.capId}</b> {plan.plan} · OT {f2(rec.otHrs)} hrs/wk ({f2(otTotal)} total) · cross-util +{f2(rec.xr)} · hire{' '}
            {rec.starts} · <span className="pos-t">accepted</span>
          </div>
        )}
        <div className="acts">
          <div className="btn p" data-view="queue" onClick={onOpenQueue}>
            Open action queue
          </div>
          <div
            className={`btn g ${execBusy ? 'busy' : ''}`}
            data-act="exec-sim"
            onClick={async () => {
              if (!doneRec) {
                setLocalMsg('No approved package yet — accept a recommendation first.');
                return;
              }
              setExecBusy(true);
              try {
                const res = await onExecutePlan?.();
                setLocalMsg(res?.message || 'Staffing applied to this CAP plan.');
              } finally {
                setExecBusy(false);
              }
            }}
          >
            {execBusy ? 'Executing…' : 'Execute → post to plan'}
          </div>
        </div>
        {resultMsg ? (
          <div className={`insight exec-result ${resultOk ? 'pos' : 'warn'}`} data-act="exec-result">
            <b>{resultOk ? 'Executed.' : 'Could not execute.'}</b> {resultMsg}
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
  onGoTab,
  onBackPortfolio,
  packages = [],
}) {
  if (!plan) return null;

  const livePlan = applyLiveShrinkage(applyLiveAttrition(plan, state?.attrWeeks), state?.editorWeeks);
  const plansForXutil = (allPlans.length ? allPlans : [livePlan]).map((p) =>
    p.capId === livePlan.capId ? livePlan : p,
  );
  const gotBy = computeXutil(plansForXutil).gotBy;

  return (
    <>
      {activeTab === 'ov' && (
        <OverviewTab
          plan={livePlan}
          decisions={decisions}
          gotBy={gotBy}
          packages={packages}
          editorWeeks={state?.editorWeeks || []}
          onGoTab={onGoTab}
          onDecide={onDecide}
          onEditorChange={onEditorChange}
          onAcceptRec={onAcceptRec}
          onRejectRec={onRejectRec}
          onMapRoster={() => onGoTab?.('nh')}
          onOpenQueue={onOpenQueue}
          onBackPortfolio={onBackPortfolio}
        />
      )}
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
          decisions={decisions}
          onOpenQueue={onOpenQueue}
          onExecutePlan={onExecutePlan}
          execDone={state.execDone}
          execMsg={state.execMsg}
        />
      )}
    </>
  );
}
