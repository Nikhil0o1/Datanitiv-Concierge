/** Convert API plan detail into prototype-compatible DATA row, enriched from HTML demo fields. */
import enrichment from '../data/htmlPlanEnrichment.json';
import { computeClosing } from './planLogic';

const BY_CAP = Object.fromEntries(enrichment.map((e) => [e.capId, e]));

function zeros(n, fill = 0) {
  return Array.from({ length: n }, () => fill);
}

function pickSeries(apiVal, enrichVal, n, fill = 0) {
  if (Array.isArray(apiVal) && apiVal.some((v) => v != null)) return apiVal;
  if (Array.isArray(enrichVal) && enrichVal.some((v) => v != null)) return enrichVal;
  return zeros(n, fill);
}

function hcFromApi(h) {
  if (!h) return null;
  const hc = {
    opening: Number(h.opening) || 0,
    nest: Number(h.nest) || 0,
    tin: Number(h.tin) || 0,
    tout: Number(h.tout) || 0,
    loaIn: Number(h.loa_in ?? h.loaIn) || 0,
    loaOut: Number(h.loa_out ?? h.loaOut) || 0,
    attr: Number(h.attr) || 0,
    promo: Number(h.promo) || 0,
    closing: 0,
  };
  hc.closing = computeClosing(hc);
  return hc;
}

export function detailToDataRow(detail) {
  const weeks = detail.weeks || [];
  const n = weeks.length;
  const enrich = BY_CAP[detail.cap_id] || {};
  const apiCls =
    detail.roster_classes?.find((c) => c.status === 'planned' && String(c.class_name || '').startsWith('EXEC-HIRE')) ||
    detail.roster_classes?.find((c) => c.status === 'mapped' || c.status === 'uploaded') ||
    detail.roster_classes?.find((c) => c.status === 'missing') ||
    detail.roster_classes?.[0] ||
    null;
  const enrichCls = enrich.cls || null;
  const clsSrc =
    apiCls || enrichCls
      ? {
          id: apiCls?.id,
          name: apiCls?.class_name || enrichCls?.name || enrichCls?.className,
          date: apiCls?.class_date || enrichCls?.date,
          wkRel: apiCls?.wk_rel ?? enrichCls?.wkRel ?? 0,
          plan: apiCls?.plan_hc ?? enrichCls?.plan ?? 0,
          actual: apiCls?.actual_hc ?? 0,
          trainHC: apiCls?.train_hc ?? enrichCls?.trainHC ?? apiCls?.plan_hc ?? enrichCls?.plan ?? 0,
          status: apiCls?.status || 'missing',
          trainWk: apiCls?.train_wk ?? enrichCls?.trainWk ?? 2,
          nestWk: apiCls?.nest_wk ?? enrichCls?.nestWk ?? 1,
          rosterFile: apiCls?.roster_file || null,
          employeeCount: apiCls?.employee_count ?? 0,
        }
      : null;

  const hcCur = hcFromApi(detail.headcount) || hcFromApi(enrich.hcCur);
  const hcLast =
    hcFromApi(detail.headcount_last) ||
    hcFromApi(enrich.hcLast) ||
    (hcCur
      ? hcFromApi({
          opening: hcCur.opening,
          nest: 0,
          tin: 0,
          tout: 0,
          loa_in: 0,
          loa_out: 0,
          attr: 0,
          promo: 0,
        })
      : null);

  const closingFTE = detail.closing_fte ?? hcCur?.closing ?? enrich.closingFTE ?? 0;
  const availHrs = detail.avail_hrs ?? enrich.availHrs ?? 40;

  const attr12 = detail.attr12 ?? enrich.attr12 ?? 0;
  const hire12 = detail.hire12 ?? 0;
  const nClasses12 = detail.n_classes_12 ?? 0;
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
    closingFTE,
    availHrs,
    shrink12,
    attr12,
    hire12,
    recOT: Math.round(0.05 * closingFTE * availHrs * 100) / 100,
    nClasses12,
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
    sHire: pickSeries(detail.s_hire, enrich.sHire, n, 0),
    sFcst: detail.s_fcst ?? enrich.sFcst ?? null,
    sActVol: detail.s_act_vol ?? enrich.sActVol ?? null,
    sAhtGoal: detail.s_aht_goal ?? enrich.sAhtGoal ?? null,
    sAhtAct: detail.s_aht_act ?? enrich.sAhtAct ?? null,
    cls: clsSrc
      ? {
          id: clsSrc.id,
          name: clsSrc.name || clsSrc.className,
          date: clsSrc.date,
          wkRel: clsSrc.wkRel,
          plan: clsSrc.plan,
          actual: clsSrc.actual,
          trainHC: clsSrc.trainHC,
          status: clsSrc.status,
          trainWk: clsSrc.trainWk,
          nestWk: clsSrc.nestWk,
          rosterFile: clsSrc.rosterFile,
          employeeCount: clsSrc.employeeCount,
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
