/** Convert API plan detail into prototype-compatible DATA row */
export function detailToDataRow(detail) {
  const weeks = detail.weeks || [];
  const cls = detail.roster_classes?.find((c) => c.status === 'missing');
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
    isVol: detail.is_vol,
    ou: detail.ou,
    sustained: detail.sustained,
    minOUfwd: detail.min_ou_fwd,
    closingFTE: detail.closing_fte,
    availHrs: detail.avail_hrs,
    shrink12: detail.shrink12,
    attr12: detail.attr12,
    billable: detail.billable,
    sOU: weeks.map((w) => w.ou),
    sShrink: weeks.map((w) => w.shrink_actual),
    sShrinkPlan: weeks.map((w) => w.shrink_plan),
    sProj: weeks.map((w) => w.projected),
    sReq: weeks.map((w) => w.required),
    cls: cls
      ? {
          name: cls.class_name,
          date: cls.class_date,
          wkRel: cls.wk_rel,
          plan: cls.plan_hc,
          actual: cls.actual_hc,
          trainHC: cls.train_hc,
          status: cls.status,
          trainWk: cls.train_wk,
          nestWk: cls.nest_wk,
        }
      : null,
    hcCur: detail.headcount
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
      : null,
  };
}

export async function loadAllDataRows(api) {
  const summaries = await api.plans();
  const details = await Promise.all(summaries.map((s) => api.plan(s.cap_id)));
  return details.map(detailToDataRow);
}
