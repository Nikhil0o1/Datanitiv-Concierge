/** Convert API plan detail into prototype-compatible DATA row, enriched from HTML demo fields. */
import enrichment from '../data/htmlPlanEnrichment.json';

const BY_CAP = Object.fromEntries(enrichment.map((e) => [e.capId, e]));

function zeros(n, fill = 0) {
  return Array.from({ length: n }, () => fill);
}

function pickSeries(apiVal, enrichVal, n, fill = 0) {
  if (Array.isArray(apiVal) && apiVal.some((v) => v != null)) return apiVal;
  if (Array.isArray(enrichVal) && enrichVal.some((v) => v != null)) return enrichVal;
  return zeros(n, fill);
}

export function detailToDataRow(detail) {
  const weeks = detail.weeks || [];
  const n = weeks.length;
  const enrich = BY_CAP[detail.cap_id] || {};
  const apiCls =
    detail.roster_classes?.find((c) => c.status === 'planned' && String(c.class_name || '').startsWith('EXEC-HIRE')) ||
    detail.roster_classes?.find((c) => c.status === 'mapped' || c.status === 'uploaded') ||
    detail.roster_classes?.find((c) => c.status === 'missing') ||
    detail.roster_classes?.[0];
  const enrichCls = enrich.cls || null;
  const clsSrc =
    apiCls || enrichCls
      ? {
          name: apiCls?.class_name || enrichCls?.name || enrichCls?.className,
          date: enrichCls?.date || apiCls?.class_date,
          wkRel: enrichCls?.wkRel ?? apiCls?.wk_rel ?? 0,
          plan: apiCls?.plan_hc ?? enrichCls?.plan ?? 0,
          actual: apiCls?.actual_hc ?? enrichCls?.actual ?? 0,
          trainHC: enrichCls?.trainHC ?? apiCls?.train_hc ?? apiCls?.plan_hc ?? enrichCls?.plan ?? 0,
          status: apiCls?.status || enrichCls?.status || 'missing',
          trainWk: enrichCls?.trainWk ?? apiCls?.train_wk ?? 2,
          nestWk: enrichCls?.nestWk ?? apiCls?.nest_wk ?? 1,
        }
      : null;

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
  const apiHire =
    apiCls && (apiCls.status === 'mapped' || apiCls.status === 'uploaded' || apiCls.status === 'partial')
      ? Number(apiCls.actual_hc) || 0
      : null;
  const hire12 = apiHire != null && apiHire > 0 ? apiHire : detail.hire12 ?? enrich.hire12 ?? 0;
  const sShrinkPlan = weeks.map((w) => w.shrink_plan);
  const curIdx = detail.cur_week_idx || 0;
  const fwdShrink = sShrinkPlan.slice(curIdx, curIdx + 12).filter((v) => v != null);
  const shrink12 =
    detail.shrink12 ??
    (fwdShrink.length ? fwdShrink.reduce((a, b) => a + b, 0) / fwdShrink.length : enrich.shrink12) ??
    0;

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
    curIdx,
    isVol: detail.is_vol ?? enrich.isVol ?? false,
    ou: detail.ou ?? enrich.ou ?? 0,
    ouShrink: detail.ou_shrink ?? enrich.ouShrink ?? detail.ou ?? 0,
    sustained: detail.sustained ?? enrich.sustained ?? 0,
    minOUfwd: detail.min_ou_fwd ?? enrich.minOUfwd ?? 0,
    closingFTE: detail.closing_fte ?? enrich.closingFTE ?? hcCur?.closing ?? 0,
    availHrs: detail.avail_hrs ?? enrich.availHrs ?? 40,
    shrink12,
    attr12,
    hire12,
    recOT: enrich.recOT ?? 0,
    nClasses12: enrich.nClasses12 ?? 0,
    billable: detail.billable,
    fBias: detail.f_bias ?? enrich.fBias ?? null,
    aBias: detail.a_bias ?? enrich.aBias ?? null,
    sOU: weeks.map((w) => w.ou),
    sShrink: weeks.map((w) => w.shrink_actual),
    sShrinkPlan,
    sProj: weeks.map((w) => w.projected),
    sReq: weeks.map((w) => w.required),
    sAttr: pickSeries(detail.s_attr, enrich.sAttr, n, attr12),
    sAttrPlan: pickSeries(detail.s_attr_plan, enrich.sAttrPlan, n, 0),
    sHire: (() => {
      const fromApi = pickSeries(detail.s_hire, enrich.sHire, n, 0);
      if (hire12 > 0 && !(Array.isArray(detail.s_hire) && detail.s_hire.some((v) => v))) {
        const copy = [...fromApi];
        copy[curIdx] = hire12;
        return copy;
      }
      return fromApi;
    })(),
    sFcst: detail.s_fcst ?? enrich.sFcst ?? null,
    sActVol: detail.s_act_vol ?? enrich.sActVol ?? null,
    sAhtGoal: detail.s_aht_goal ?? enrich.sAhtGoal ?? null,
    sAhtAct: detail.s_aht_act ?? enrich.sAhtAct ?? null,
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
