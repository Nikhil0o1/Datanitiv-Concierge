import { f2, reqOf } from './format';

/** Overlay in-progress shrinkage editor weeks onto a plan so every tab sees live FTE/O/U. */
export function applyLiveShrinkage(plan, editorWeeks) {
  if (!plan || !editorWeeks?.length) return plan;
  const sShrinkPlan = [...(plan.sShrinkPlan || [])];
  const sReq = [...(plan.sReq || [])];
  const sOU = [...(plan.sOU || [])];
  const sProj = plan.sProj || [];
  const billable = Number(plan.billable) || 50;
  editorWeeks.forEach((w) => {
    if (w.weekIdx == null || !Number.isFinite(Number(w.cur))) return;
    const shrink = Number(w.cur);
    sShrinkPlan[w.weekIdx] = shrink;
    const req = reqOf(billable, shrink);
    sReq[w.weekIdx] = req;
    sOU[w.weekIdx] = Number(sProj[w.weekIdx] ?? w.proj ?? 0) - req;
  });
  const cur = plan.curIdx || 0;
  const fwdS = sShrinkPlan.slice(cur, cur + 12).filter((v) => v != null);
  const shrink12 = fwdS.length ? fwdS.reduce((a, b) => a + b, 0) / fwdS.length : plan.shrink12;
  const fwdOU = sOU.slice(cur, cur + 12).filter((v) => v != null && !Number.isNaN(v));
  const sustained = fwdOU.length
    ? Math.round((fwdOU.reduce((a, b) => a + b, 0) / fwdOU.length) * 100) / 100
    : plan.sustained;
  const minOUfwd = fwdOU.length ? Math.round(Math.min(...fwdOU) * 100) / 100 : plan.minOUfwd;
  const ou = sOU[cur] ?? plan.ou;
  return {
    ...plan,
    sShrinkPlan,
    sReq,
    sOU,
    shrink12,
    sustained,
    minOUfwd,
    ou,
    ouShrink: ou,
  };
}

/** Overlay in-progress attrition plan weeks onto projected FTE / O/U for every tab. */
export function applyLiveAttrition(plan, attrWeeks) {
  if (!plan || !attrWeeks?.length) return plan;
  const sAttrPlan = [...(plan.sAttrPlan || [])];
  const origProj = plan.sProj || [];
  const sReq = plan.sReq || [];
  const sProj = [...origProj];
  const sOU = [...(plan.sOU || [])];
  const cur = plan.curIdx || 0;
  const extraAt = {};
  attrWeeks.forEach((w) => {
    if (w.weekIdx == null || !Number.isFinite(Number(w.cur))) return;
    const next = Number(w.cur);
    sAttrPlan[w.weekIdx] = next;
    const base = Number(w.base) || 0;
    const stock = Number(w.stock ?? w.proj ?? origProj[w.weekIdx] ?? 0);
    extraAt[w.weekIdx] = (stock * (next - base)) / 100;
  });
  const n = Math.max(sProj.length, sAttrPlan.length, origProj.length);
  let cum = 0;
  for (let i = cur; i < n; i++) {
    cum += Number(extraAt[i]) || 0;
    const proj = Math.round(((Number(origProj[i]) || 0) - cum) * 100) / 100;
    sProj[i] = proj;
    sOU[i] = Math.round((proj - (Number(sReq[i]) || 0)) * 100) / 100;
  }
  const fwdA = sAttrPlan.slice(cur, cur + 12).filter((v) => v != null);
  const attr12 = fwdA.length ? fwdA.reduce((a, b) => a + b, 0) / fwdA.length : plan.attr12;
  const fwdOU = sOU.slice(cur, cur + 12).filter((v) => v != null && !Number.isNaN(v));
  const sustained = fwdOU.length
    ? Math.round((fwdOU.reduce((a, b) => a + b, 0) / fwdOU.length) * 100) / 100
    : plan.sustained;
  const minOUfwd = fwdOU.length ? Math.round(Math.min(...fwdOU) * 100) / 100 : plan.minOUfwd;
  const ou = sOU[cur] ?? plan.ou;
  return {
    ...plan,
    sAttrPlan,
    sProj,
    sOU,
    attr12,
    sustained,
    minOUfwd,
    ou,
    ouShrink: ou,
  };
}

export function computeClosing(hc = {}) {
  const opening = Number(hc.opening) || 0;
  const nest = Number(hc.nest) || 0;
  const tin = Number(hc.tin) || 0;
  const tout = Number(hc.tout) || 0;
  const loaOut = Number(hc.loaOut) || 0;
  const loaIn = Number(hc.loaIn) || 0;
  const attr = Number(hc.attr) || 0;
  const promo = Number(hc.promo) || 0;
  return Math.round((opening + nest + tin - tout + loaOut - loaIn - attr - promo) * 100) / 100;
}

export function statusOf(plan) {
  const s = plan.sustained;
  if (s <= -10) return 'critical';
  if (s < -1) return 'under';
  if (s > 1) return 'surplus';
  return 'balanced';
}

export function weeks12(plan) {
  const s = (plan.sOU || []).slice(plan.curIdx, plan.curIdx + 12);
  let under = 0;
  let over = 0;
  let ok = 0;
  s.forEach((v) => {
    if (v < -0.5) under += 1;
    else if (v > 0.5) over += 1;
    else ok += 1;
  });
  return { under, over, ok, n: s.length, s };
}

/** Shrinkage recommendation: 8-wk actual vs planned forward %.
 *  Pass `livePlan` (avg of edited forward weeks) so the banner updates live with sliders/drag.
 */
export function shrRec(plan, livePlan = null) {
  const past = (plan.sShrink || []).slice(Math.max(0, plan.curIdx - 8), plan.curIdx + 1).filter((v) => v != null);
  const actAvg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : 0;
  const planned = livePlan != null && !Number.isNaN(livePlan) ? livePlan : plan.shrink12 || 0;
  const gap = actAvg - planned;
  const dir = gap > 1 ? 'up' : gap < -1 ? 'down' : 'ok';
  const t =
    dir === 'up'
      ? `Raise plan shrinkage ▲ +${f2(gap)}pt → ~${f2(actAvg)}% (actual trending higher)`
      : dir === 'down'
        ? `Plan is conservative — can lower ▼ ${f2(Math.abs(gap))}pt toward ${f2(actAvg)}%`
        : `Plan aligned with recent actual (±${f2(Math.abs(gap))}pt)`;
  return { actAvg, plan: planned, gap, dir, t };
}

/** Portfolio cross-util allocation (HTML computeXutil, simplified). */
export function computeXutil(plans) {
  const donors = plans
    .filter((p) => p.minOUfwd > 1 && !/FE Test/i.test(p.plan || ''))
    .map((p) => ({ p, lend: Math.round((p.minOUfwd - 1) * 100) / 100 }));
  const recips = plans
    .filter((p) => p.sustained < -0.5)
    .map((p) => ({ p, need: Math.round(-p.sustained * 100) / 100, got: 0 }));
  recips.sort((a, b) => b.need - a.need);
  donors.sort((a, b) => b.lend - a.lend);

  for (const r of recips) {
    let rem = r.need;
    for (const pass of [0, 1]) {
      for (const d of donors) {
        if (d.lend <= 0.01 || rem <= 0.01) continue;
        const same = d.p.region === r.p.region;
        if (pass === 0 && !same) continue;
        if (pass === 1 && same) continue;
        const amt = Math.round(Math.min(d.lend, rem) * 100) / 100;
        if (amt <= 0.01) continue;
        d.lend = Math.round((d.lend - amt) * 100) / 100;
        rem = Math.round((rem - amt) * 100) / 100;
        r.got = Math.round((r.got + amt) * 100) / 100;
      }
    }
  }
  const gotBy = {};
  recips.forEach((r) => {
    gotBy[r.p.capId] = r.got;
  });
  return { gotBy };
}

export function planRec(plan, { otPct = 5, xr, starts, gotBy } = {}) {
  const gap = Math.max(0, -plan.sustained);
  const otFTE = Math.round(((otPct / 100) * (plan.closingFTE || 0)) * 100) / 100;
  const otHrs = Math.round(((otPct / 100) * (plan.closingFTE || 0) * (plan.availHrs || 40)) * 100) / 100;
  const cross = xr != null ? xr : gotBy?.[plan.capId] || 0;
  const residual = Math.round(Math.max(0, gap - cross - otFTE) * 100) / 100;
  const hireStarts = starts != null ? starts : residual > 0 ? Math.ceil(residual / (0.97 * 0.98 * 0.99)) : 0;
  return { gap, otPct, otFTE, otHrs, xr: cross, residual, starts: hireStarts };
}

export function fwdCount(plan) {
  return Math.max(1, Math.min(12, (plan.weeks?.length || 0) - plan.curIdx));
}

export function defaultOtWeekly(plan, otPct = 5) {
  return Math.round(((otPct / 100) * (plan.closingFTE || 0) * (plan.availHrs || 40)) * 100) / 100;
}

export function nfAlert(msg) {
  window.alert(`${msg}\n\nSimulated in Concierge — wired like the HTML prototype.`);
}

/** Actuals through this week, planned values from this week forward. */
export function mixActualPlan(actual = [], planned = [], curIdx = 0) {
  const n = Math.max(actual.length, planned.length);
  return Array.from({ length: n }, (_, i) => {
    if (i < curIdx) return actual[i] ?? planned[i] ?? 0;
    return planned[i] ?? actual[i] ?? 0;
  });
}

/** 16-week window: 8 back from this week + this week + 7 forward. */
export function windowSeries(weeks = [], series = [], curIdx = 0, { back = 8, ahead = 8 } = {}) {
  const start = Math.max(0, curIdx - back);
  const end = Math.min(series.length, start + back + ahead);
  return {
    values: series.slice(start, end),
    weeks: weeks.slice(start, end),
    mark: curIdx - start,
  };
}

export function ouColor(v, i, curIdx) {
  const future = i > curIdx;
  if (v < 0) return future ? '#f3b0ab' : '#e0483f';
  return future ? '#a9dcc6' : '#1a9e6a';
}

/** Shared 16-wk KPI sparkline payloads from a live plan row. */
export function kpiTrends(plan) {
  const weeks = plan.weeks || [];
  const cur = plan.curIdx || 0;
  const shrink = mixActualPlan(plan.sShrink, plan.sShrinkPlan, cur);
  const attr = mixActualPlan(plan.sAttr, plan.sAttrPlan, cur);
  const hire = (plan.sHire || []).map((v) => v || 0);
  const ou = (plan.sOU || []).map((v) => v || 0);
  return {
    shrink: windowSeries(weeks, shrink, cur),
    attr: windowSeries(weeks, attr, cur),
    hire: windowSeries(weeks, hire, cur),
    ou: windowSeries(weeks, ou, cur),
  };
}

/** Split total shrinkage into assumed operational shares. Source stores Total only. */
export function segmentShrinkage(plan) {
  const actual = plan.sShrink || [];
  const plannedTot = plan.sShrinkPlan || [];
  const n = Math.max(actual.length, plannedTot.length, plan.weeks?.length || 0);
  const totalAt = (i) => {
    if (i >= (plan.curIdx || 0) && plannedTot[i] != null) return plannedTot[i];
    if (actual[i] != null) return actual[i];
    if (plannedTot[i] != null) return plannedTot[i];
    return plan.shrink12 || 0;
  };
  const weights = {
    breaks: 0.22,
    training: 0.18,
    meetings: 0.12,
    coaching: 0.1,
    absence: 0.28,
    other: 0.1,
  };
  const plannedShare = 0.55;
  const cats = Object.keys(weights);
  const byCat = {};
  cats.forEach((cat) => {
    byCat[cat] = Array.from({ length: n }, (_, i) => Math.round(totalAt(i) * weights[cat] * 100) / 100);
  });
  const planned = Array.from({ length: n }, (_, i) => Math.round(totalAt(i) * plannedShare * 100) / 100);
  const unplanned = Array.from({ length: n }, (_, i) => Math.round(totalAt(i) * (1 - plannedShare) * 100) / 100);
  return { byCat, planned, unplanned, cats, weights };
}
