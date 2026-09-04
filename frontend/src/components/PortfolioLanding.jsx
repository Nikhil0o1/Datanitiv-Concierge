import { Fragment, useEffect, useMemo, useState } from 'react';
import { f2 } from '../utils/format';
import { kpiTrends, ouColor, planRec, statusOf, weeks12 } from '../utils/planLogic';
import SeriesChart, { KpiTrendCard } from './SeriesChart';

function statLabel(plan) {
  const st = statusOf(plan);
  if (st === 'critical' || st === 'under') return 'Understaffed';
  if (st === 'surplus') return 'Surplus';
  return 'Balanced';
}

function statCls(plan) {
  const st = statusOf(plan);
  if (st === 'critical' || st === 'under') return 'under';
  if (st === 'surplus') return 'sur';
  return 'bal';
}

function recShort(plan, gotBy) {
  const st = statusOf(plan);
  const w = weeks12(plan);
  const s = (plan.sOU || []).slice(plan.curIdx, plan.curIdx + 12);
  const peak = s.length ? Math.min(0, ...s) : 0;
  if (st === 'under' || st === 'critical') {
    const r = planRec(plan, { gotBy });
    return { cls: 'bad', t: `Short ~${f2(r.gap)} FTE · OT ${f2(r.otFTE)} + cross-util ${f2(r.xr)} + hire ${r.starts}` };
  }
  if (w.under >= 2) {
    return { cls: 'warn', t: `${w.under} of 12 wks short (peak ${f2(peak)} FTE) — OT / redistribute to cover` };
  }
  if (st === 'surplus') {
    return { cls: 'good', t: `Surplus — lend up to ${f2(Math.max(0, plan.minOUfwd - 1))} FTE (cross-util)` };
  }
  return { cls: 'warn', t: 'On plan — no shortfall weeks' };
}

function sparkBars(plan) {
  const s = (plan.sOU || []).slice(plan.curIdx, plan.curIdx + 12);
  let u = 0;
  let o = 0;
  const bars = s.map((v) => {
    if (v < -0.5) {
      u += 1;
      return 'u';
    }
    if (v > 0.5) {
      o += 1;
      return 'o';
    }
    return '';
  });
  const na = Math.max(0, 12 - s.length);
  for (let k = 0; k < na; k += 1) bars.push('na');
  return { bars, u, o, na };
}

function PlanExpandDetail({ plan, onOpenDetail, gotBy }) {
  const trends = kpiTrends(plan);
  const rc = recShort(plan, gotBy);

  return (
    <div className="land-detail" data-cap-detail={plan.capId}>
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
          value={plan.ouShrink ?? plan.sOU?.[plan.curIdx] ?? plan.ou ?? 0}
          caption={`vs billable ${f2(plan.ou)}`}
          color={(plan.ouShrink ?? plan.sOU?.[plan.curIdx] ?? plan.ou ?? 0) < 0 ? '#e0483f' : '#1a9e6a'}
          tone={(plan.ouShrink ?? plan.sOU?.[plan.curIdx] ?? plan.ou ?? 0) < 0 ? 'neg' : 'pos'}
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
        height={180}
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
      <div className="land-detail-foot">
        <span className={`rec ${rc.cls}`}>{rc.t}</span>
        <button type="button" className="btn p" data-act="open-detail" onClick={() => onOpenDetail(plan.capId)}>
          Open detailed analysis →
        </button>
      </div>
    </div>
  );
}

export default function PortfolioLanding({
  plans = [],
  programs = [],
  search = '',
  expandAll = false,
  packages = [],
  execDone = false,
  onOpenPlan,
  onOpenQueue,
  gotBy = {},
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());
  const [focusCap, setFocusCap] = useState(null);

  const filtered = useMemo(() => plans, [plans]);

  const groups = useMemo(() => {
    const map = {};
    filtered.forEach((p) => {
      const g = p.program || '—';
      (map[g] = map[g] || []).push(p);
    });
    Object.values(map).forEach((arr) => arr.sort((a, b) => a.sustained - b.sustained));
    const order = Object.keys(map).sort(
      (a, b) => Math.min(...map[a].map((x) => x.sustained)) - Math.min(...map[b].map((x) => x.sustained)),
    );
    const prefer = programs.map((p) => p.name).filter((n) => map[n]);
    const rest = order.filter((n) => !prefer.includes(n));
    return [...prefer, ...rest].map((name) => ({ name, plans: map[name] }));
  }, [filtered, programs]);

  useEffect(() => {
    if (!expandAll || !search.trim()) return;
    setCollapsed(new Set());
    setExpanded(new Set(filtered.map((p) => p.capId)));
  }, [expandAll, search, filtered]);

  const nPri = filtered.filter((p) => {
    const st = statusOf(p);
    const w = weeks12(p);
    return st === 'under' || st === 'critical' || w.under >= 2;
  }).length;

  const nUnder = filtered.filter((p) => {
    const st = statusOf(p);
    return st === 'under' || st === 'critical';
  }).length;
  const nSurplus = filtered.filter((p) => statusOf(p) === 'surplus').length;
  const nRoster = filtered.filter(
    (p) => p.cls && (p.cls.status === 'missing' || p.cls.status === 'partial'),
  ).length;
  const netOu = filtered.reduce((a, p) => a + (p.sustained || 0), 0);

  const queued = packages.filter((p) => !p.done && p.status !== 'rejected' && p.status !== 'posted');
  const queuedPlans = new Set(queued.map((p) => p.cap_id));
  const otN = queued.filter((p) => (p.ot_hrs || 0) > 0).length;
  const xuN = queued.filter((p) => (p.xu_fte || 0) > 0).length;
  const hrN = queued.filter((p) => (p.hire_count || 0) > 0).length;

  const toggleProg = (name) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const togglePlan = (capId) => {
    setFocusCap(capId);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(capId)) next.delete(capId);
      else next.add(capId);
      return next;
    });
  };

  return (
    <div className="land" data-view="port-landing">
      <div>
        <div className="ltitle">
          Portfolio — CAP plans by Program{' '}
          <span className="lsub">
            · grouped by Program, most-deficit first
            {nPri ? (
              <>
                {' '}
                · <b style={{ color: 'var(--neg)' }}>{nPri} need attention</b>
              </>
            ) : null}
          </span>
        </div>
      </div>

      <div className="tiles">
        <span className="tile">
          <b>{filtered.length}</b> Active
        </span>
        <span className="tile neg">
          <b>{nUnder}</b> Understaffed
        </span>
        <span className="tile pos">
          <b>{nSurplus}</b> Surplus
        </span>
        <span className="tile warn">
          <b>{nRoster}</b> Roster gaps
        </span>
        <span className="tile pos">
          <b>{netOu >= 0 ? '+' : ''}{f2(netOu)}</b> Net O/U
        </span>
      </div>

      <div className={`execbar ${queued.length ? 'on' : ''}`} id="execBar">
        <span className="ic">🚀</span>
        <div id="ebTx">
          {queued.length ? (
            <>
              <b>
                {queued.length} approved package(s) across {queuedPlans.size} plan(s)
              </b>{' '}
              ready to execute in one go
              <div className="ebchips">
                {otN ? <span className="ebchip">⏱ {otN} OT</span> : null}
                {xuN ? <span className="ebchip">⇄ {xuN} cross-util</span> : null}
                {hrN ? <span className="ebchip">🎓 {hrN} hire</span> : null}
              </div>
            </>
          ) : (
            <div className="s">Accept recommendations on individual plans to queue packages here</div>
          )}
        </div>
        <button type="button" className="btn w" data-act="exec-all" onClick={() => onOpenQueue?.()}>
          Review &amp; execute all →
        </button>
      </div>

      <div className={`ok ${execDone ? 'on' : ''}`} id="execOk">
        <span>✓</span>
        <span>Posted to CAP-ABILITY · planners notified · every action reversible from the ledger for 24 hours</span>
      </div>

      <div className="ptbl">
        <div className="phead">
          <span>CAP plan</span>
          <span>Avg FTE O/U</span>
          <span>Next 12 wks</span>
          <span>Status</span>
          <span>Recommendation</span>
          <span></span>
        </div>

        {groups.map((g) => {
          const col = collapsed.has(g.name);
          const net12 = g.plans.reduce((a, p) => a + (p.sustained || 0), 0);
          const need = g.plans.filter((p) => {
            const st = statusOf(p);
            return st === 'under' || st === 'critical';
          }).length;

          return (
            <Fragment key={g.name}>
              <button
                type="button"
                className="gband"
                data-prog={g.name}
                onClick={() => toggleProg(g.name)}
              >
                <b>{g.name}</b>
                <span>
                  {g.plans.length} plan{g.plans.length === 1 ? '' : 's'}
                  {need ? (
                    <>
                      {' '}
                      · <b style={{ color: 'var(--neg)' }}>{need} need attention</b>
                    </>
                  ) : null}
                  {' '}
                  · net 12-wk O/U{' '}
                  <b style={{ color: net12 >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                    {net12 >= 0 ? '+' : ''}
                    {f2(net12)}
                  </b>
                </span>
                <span className="nou">{col ? '▸' : '▾'}</span>
              </button>

              {!col
                ? g.plans.map((p) => {
                    const ex = expanded.has(p.capId);
                    const sp = sparkBars(p);
                    const rc = recShort(p, gotBy);
                    const subLine = [p.lob || p.region, (p.site || '').replace(/-$/, '')].filter(Boolean).join(' › ');

                    return (
                      <Fragment key={p.capId}>
                        <button
                          type="button"
                          className={`prow ${ex || focusCap === p.capId ? 'focus' : ''}`}
                          data-cap={p.capId}
                          data-prog={g.name}
                          onClick={() => togglePlan(p.capId)}
                        >
                          <div>
                            <div className="pn">
                              <span className="pp">{p.capId}</span>
                              {p.plan}
                              {p.cls && (p.cls.status === 'missing' || p.cls.status === 'partial') ? (
                                <span className="flag">roster</span>
                              ) : null}
                            </div>
                            {subLine ? <div className="pb">{subLine}</div> : null}
                          </div>
                          <div className={`pv ${p.sustained < 0 ? 'neg' : 'pos'}`}>
                            {p.sustained > 0 ? '+' : ''}
                            {f2(p.sustained)}
                          </div>
                          <div>
                            <div className="spark">
                              {sp.bars.map((kind, i) => (
                                <i key={i} className={kind || undefined} />
                              ))}
                            </div>
                            <div className="scount">
                              {sp.u} under · {sp.o} over{sp.na ? ` · ${sp.na} n/a` : ''}
                            </div>
                          </div>
                          <div>
                            <span className={`stat ${statCls(p)}`}>{statLabel(p)}</span>
                          </div>
                          <div>
                            <span className={`rec ${rc.cls}`}>{rc.t}</span>
                          </div>
                          <div>
                            <span
                              className="openb"
                              data-open={p.capId}
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenPlan?.(p.capId);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.stopPropagation();
                                  onOpenPlan?.(p.capId);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              Open →
                            </span>
                          </div>
                        </button>
                        {ex ? (
                          <PlanExpandDetail plan={p} onOpenDetail={onOpenPlan} gotBy={gotBy} />
                        ) : null}
                      </Fragment>
                    );
                  })
                : null}
            </Fragment>
          );
        })}

        {!groups.length ? (
          <div className="fold in" style={{ opacity: 1, transform: 'none', margin: 12 }}>
            <b>No plans match</b> — try clearing search or changing the program filter
          </div>
        ) : null}
      </div>
    </div>
  );
}
