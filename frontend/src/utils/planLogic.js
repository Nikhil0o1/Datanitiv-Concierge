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

/** Portfolio cross-util allocation (HTML computeXutil, simplified).
 *  Returns gotBy[capId], donorsBy[recipCapId]=[{cap_id, fte, plan}], and transfers[].
 */
export function computeXutil(plans) {
  const donors = plans
    .filter((p) => p.minOUfwd > 1 && !/FE Test/i.test(p.plan || ''))
    .map((p) => ({ p, lend: Math.round((p.minOUfwd - 1) * 100) / 100 }));
  const recips = plans
    .filter((p) => p.sustained < -0.5)
    .map((p) => ({ p, need: Math.round(-p.sustained * 100) / 100, got: 0, donors: [] }));
  recips.sort((a, b) => b.need - a.need);
  donors.sort((a, b) => b.lend - a.lend);

  const transfers = [];
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
        const entry = { cap_id: d.p.capId, fte: amt, plan: d.p.plan || d.p.capId };
        r.donors.push(entry);
        transfers.push({
          from: d.p.capId,
          to: r.p.capId,
          fte: amt,
        });
      }
    }
  }
  const gotBy = {};
  const donorsBy = {};
  recips.forEach((r) => {
    gotBy[r.p.capId] = r.got;
    donorsBy[r.p.capId] = r.donors;
  });
  return { gotBy, donorsBy, transfers };
}

/** Scale (or trim) donor list so FTE sums to targetXu. */
export function scaleDonorsToXu(donors, targetXu) {
  const xu = Math.round((Number(targetXu) || 0) * 100) / 100;
  if (xu <= 0.01 || !donors?.length) return [];
  const sum = donors.reduce((a, d) => a + (Number(d.fte) || 0), 0);
  if (sum <= 0.01) return [];
  const scale = xu / sum;
  const out = donors
    .map((d) => ({
      cap_id: d.cap_id,
      fte: Math.round((Number(d.fte) || 0) * scale * 100) / 100,
      plan: d.plan || d.cap_id,
    }))
    .filter((d) => d.fte > 0.01);
  // Fix rounding drift on the largest donor
  const got = out.reduce((a, d) => a + d.fte, 0);
  const drift = Math.round((xu - got) * 100) / 100;
  if (out.length && Math.abs(drift) >= 0.01) {
    out[0].fte = Math.round((out[0].fte + drift) * 100) / 100;
  }
  return out;
}

/** Dynamic hire train/nest timing from plan class / defaults. */
export function hireTiming(plan, ovr = {}) {
  const trainWk = Math.max(
    0,
    parseInt(ovr.trainWk ?? plan?.cls?.trainWk ?? plan?.trainWk ?? 2, 10) || 0,
  );
  const nestWk = Math.max(
    0,
    parseInt(ovr.nestWk ?? plan?.cls?.nestWk ?? plan?.nestWk ?? 1, 10) || 0,
  );
  return { trainWk, nestWk, productiveIn: trainWk + nestWk };
}

export function planRec(plan, { otPct = 5, xr, starts, gotBy, trainWk, nestWk } = {}) {
  const gap = Math.max(0, -plan.sustained);
  const otFTE = Math.round(((otPct / 100) * (plan.closingFTE || 0)) * 100) / 100;
  const otHrs = Math.round(((otPct / 100) * (plan.closingFTE || 0) * (plan.availHrs || 40)) * 100) / 100;
  const cross = xr != null ? xr : gotBy?.[plan.capId] || 0;
  const residual = Math.round(Math.max(0, gap - cross - otFTE) * 100) / 100;
  const hireStarts = starts != null ? starts : residual > 0 ? Math.ceil(residual / (0.97 * 0.98 * 0.99)) : 0;
  const timing = hireTiming(plan, { trainWk, nestWk });
  return {
    gap,
    otPct,
    otFTE,
    otHrs,
    xr: cross,
    residual,
    starts: hireStarts,
    trainWk: timing.trainWk,
    nestWk: timing.nestWk,
    productiveIn: timing.productiveIn,
  };
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
