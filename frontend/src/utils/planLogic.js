import { f2 } from './format';

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

export function shrRec(plan) {
  const past = (plan.sShrink || []).slice(Math.max(0, plan.curIdx - 8), plan.curIdx + 1).filter((v) => v != null);
  const actAvg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : 0;
  const planned = plan.shrink12 || 0;
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

/** Derive demo segment series from total shrinkage (planned vs unplanned + categories). */
export function segmentShrinkage(plan) {
  const actual = plan.sShrink || [];
  const plannedTot = plan.sShrinkPlan || [];
  const n = Math.max(actual.length, plannedTot.length, plan.weeks?.length || 0);
  const totalAt = (i) => {
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
  cats.forEach((cat, ci) => {
    byCat[cat] = Array.from({ length: n }, (_, i) => {
      const wobble = 1 + 0.07 * Math.sin(i * 0.65 + ci * 1.3);
      return Math.round(totalAt(i) * weights[cat] * wobble * 100) / 100;
    });
  });
  const planned = Array.from({ length: n }, (_, i) => Math.round(totalAt(i) * plannedShare * 100) / 100);
  const unplanned = Array.from({ length: n }, (_, i) => Math.round(totalAt(i) * (1 - plannedShare) * 100) / 100);
  return { byCat, planned, unplanned, cats, weights };
}
