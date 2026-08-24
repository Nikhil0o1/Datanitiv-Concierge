/** Convert API plan detail into prototype-compatible DATA row, enriched from HTML demo fields. */
import enrichment from '../data/htmlPlanEnrichment.json';

const BY_CAP = Object.fromEntries(enrichment.map((e) => [e.capId, e]));

function zeros(n, fill = 0) {
  return Array.from({ length: n }, () => fill);
}

export function detailToDataRow(detail) {
  const weeks = detail.weeks || [];
  const n = weeks.length;
  const enrich = BY_CAP[detail.cap_id] || {};
  const apiCls = detail.roster_classes?.find((c) => c.status === 'missing') || detail.roster_classes?.[0];
  const clsSrc = enrich.cls || (apiCls
    ? {
        name: apiCls.class_name,
        date: apiCls.class_date,
        wkRel: apiCls.wk_rel,
        plan: apiCls.plan_hc,
        actual: apiCls.actual_hc,
        trainHC: apiCls.train_hc,
        status: apiCls.status,
        trainWk: apiCls.train_wk,
        nestWk: apiCls.nest_wk,
      }
    : null);

  const hcCur = detail.headcount
    ? {
        opening: detail.headcount.opening,
        nest: detail.headcount.nest,
        tin: detail.headcount.tin,
        tout: detail.headcount.tout,
        loaIn: detail.headcount.loa_in,
        loaOut: detail.headcount.loa_out,
        attr: detail.headcount.attr,
        promo: detail.headcount.promo,
        closing: detail.headcount.closing,
      }
    : enrich.hcCur || null;

  const hcLast = enrich.hcLast || (hcCur
    ? {
        opening: hcCur.opening,
        nest: 0,
        tin: 0,
        tout: 0,
        loaIn: 0,
        loaOut: 0,
        attr: 0,
        promo: 0,
        closing: hcCur.opening,
      }
    : null);

  const attr12 = detail.attr12 ?? enrich.attr12 ?? 0;
  const hire12 = enrich.hire12 ?? 0;

  return {
    plan: detail.plan_name,
    capId: detail.cap_id,
    site: detail.site.endsWith('-') ? detail.site : `${detail.site}-`,
    lob: detail.lob,
    region: detail.region,
    planner: detail.planner,
    program: detail.program,
    vertical: detail.vertical,
    weeks: weeks.map((w) => w.week_label),
    curIdx: detail.cur_week_idx,
    isVol: detail.is_vol ?? enrich.isVol ?? false,
    ou: detail.ou ?? enrich.ou ?? 0,
    ouShrink: enrich.ouShrink ?? detail.ou ?? 0,
    sustained: detail.sustained ?? enrich.sustained ?? 0,
    minOUfwd: detail.min_ou_fwd ?? enrich.minOUfwd ?? 0,
    closingFTE: detail.closing_fte ?? enrich.closingFTE ?? hcCur?.closing ?? 0,
    availHrs: detail.avail_hrs ?? enrich.availHrs ?? 40,
    shrink12: detail.shrink12 ?? enrich.shrink12 ?? 0,
    attr12,
    hire12,
    recOT: enrich.recOT ?? 0,
    nClasses12: enrich.nClasses12 ?? 0,
    billable: detail.billable,
    fBias: enrich.fBias ?? null,
    aBias: enrich.aBias ?? null,
    sOU: weeks.map((w) => w.ou),
    sShrink: weeks.map((w) => w.shrink_actual),
    sShrinkPlan: weeks.map((w) => w.shrink_plan),
    sProj: weeks.map((w) => w.projected),
    sReq: weeks.map((w) => w.required),
    sAttr: enrich.sAttr || zeros(n, attr12),
    sAttrPlan: enrich.sAttrPlan || zeros(n, 0),
    sHire: enrich.sHire || zeros(n, 0),
    sFcst: enrich.sFcst || null,
    sActVol: enrich.sActVol || null,
    sAhtGoal: enrich.sAhtGoal || null,
    sAhtAct: enrich.sAhtAct || null,
    cls: clsSrc
      ? {
          name: clsSrc.name || clsSrc.className,
          date: clsSrc.date,
          wkRel: clsSrc.wkRel,
          plan: clsSrc.plan,
          actual: clsSrc.actual,
          trainHC: clsSrc.trainHC,
          status: clsSrc.status,
          trainWk: clsSrc.trainWk,
          nestWk: clsSrc.nestWk,
        }
      : null,
    hcCur,
    hcLast,
  };
}

export async function loadAllDataRows(api) {
  const summaries = await api.plans();
  const details = await Promise.all(summaries.map((s) => api.plan(s.cap_id)));
  return details.map(detailToDataRow);
}
