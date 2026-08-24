import { useEffect, useMemo, useState } from 'react';
import { f2 } from '../utils/format';
import { planRec, statusOf, weeks12 } from '../utils/planLogic';
import SeriesChart, { sparkMini } from './SeriesChart';

function recShort(plan, gotBy) {
  const st = statusOf(plan);
  const w = weeks12(plan);
  const s = (plan.sOU || []).slice(plan.curIdx, plan.curIdx + 12);
  const peak = s.length ? Math.min(0, ...s) : 0;
  if (st === 'under' || st === 'critical') {
    const r = planRec(plan, { gotBy });
    return { cls: 'neg', t: `Short ~${f2(r.gap)} FTE · OT ${f2(r.otFTE)} + cross-util ${f2(r.xr)} + hire ${r.starts}` };
  }
  if (w.under >= 2) {
    return { cls: 'warn', t: `${w.under} of 12 wks short (peak ${f2(peak)} FTE) — OT / redistribute to cover` };
  }
  if (st === 'surplus') {
    return { cls: 'pos', t: `Surplus — lend up to ${f2(Math.max(0, plan.minOUfwd - 1))} FTE (cross-util)` };
  }
  return { cls: 'mut', t: 'On plan — no shortfall weeks' };
}

function underOverBars(plan) {
  const s = (plan.sOU || []).slice(plan.curIdx, plan.curIdx + 12);
  const under = s.filter((v) => v < -0.5).length;
  const over = s.filter((v) => v > 0.5).length;
  return { under, over, n: s.length };
}

function PlanExpandDetail({ plan, onOpenDetail }) {
  const past = (plan.sOU || []).map((v, i) => (i <= plan.curIdx ? v : null));
  const fu = (plan.sOU || []).map((v, i) => (i >= plan.curIdx ? v : null));
  const shrF = (plan.sShrinkPlan || []).slice(plan.curIdx, plan.curIdx + 12);
  const attrF = (plan.sAttrPlan || []).slice(plan.curIdx, plan.curIdx + 12);
  const hireF = (plan.sHire || []).slice(plan.curIdx, plan.curIdx + 12);
  const rc = recShort(plan);

  return (
    <div className="land-detail" data-cap-detail={plan.capId}>
      <div className="kpis">
        <div className="kpi">
          <b>{f2(plan.shrink12)}%</b>
          <span>Shrinkage · 12wk</span>
          <div style={{ marginTop: 4 }}>{sparkMini({ values: shrF, color: '#2a78d6' })}</div>
        </div>
        <div className="kpi">
          <b>{f2(plan.attr12)}%</b>
          <span>Attrition · 12wk</span>
          <div style={{ marginTop: 4 }}>{sparkMini({ values: attrF, color: '#eb6834' })}</div>
        </div>
        <div className="kpi">
          <b>{f2(plan.hire12)}</b>
          <span>Hiring · 12wk</span>
          <div style={{ marginTop: 4 }}>{sparkMini({ values: hireF, color: '#1a9e6a' })}</div>
        </div>
        <div className={`kpi ${(plan.ouShrink ?? plan.ou) < 0 ? 'neg' : 'pos'}`}>
          <b>{f2(plan.ouShrink ?? plan.ou)}</b>
          <span>O/U with shrinkage</span>
          <div style={{ fontSize: '.65rem', color: 'var(--dim)', marginTop: 4 }}>vs billable {f2(plan.ou)}</div>
        </div>
      </div>
      <div className="slabel">FTE Over / Under — week on week</div>
      <SeriesChart
        weeks={plan.weeks}
        curIdx={plan.curIdx}
        zeroLine
        height={180}
        bars={[
          { label: 'Actual/plan', data: past, color: (v) => (v < 0 ? '#e0483f' : '#1a9e6a') },
          { label: 'Forecast', data: fu, color: (v) => (v < 0 ? '#f3b0ab' : '#a9dcc6') },
        ]}
      />
      <div className="land-detail-foot">
        <span className={`recchip ${rc.cls}`}>{rc.t}</span>
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
  filter = 'all',
  search = '',
  expandAll = false,
  triageCounts = { dec: 0, auto: 0, quiet: 0 },
  onOpenPlan,
  gotBy = {},
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());

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

  const toggleProg = (name) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const togglePlan = (capId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(capId)) next.delete(capId);
      else next.add(capId);
      return next;
    });
  };

  return (
    <div className="land" data-view="port-landing">
      <div className="land-bar">
        <div className="land-title">
          Portfolio — grouped by Program{' '}
          <span className="land-sub">
            · {groups.length} programs · sorted by priority
            {nPri ? (
              <>
                {' '}
                · <b className="neg-t">{nPri} need attention</b>
              </>
            ) : null}
          </span>
        </div>
        <div className="land-triage">
          <span>
            Decide <b>{triageCounts.dec}</b>
          </span>
          <span>
            Autopilot <b>{triageCounts.auto}</b>
          </span>
          <span>
            Quiet <b>{triageCounts.quiet}</b>
          </span>
        </div>
      </div>

      {groups.map((g) => {
        const col = collapsed.has(g.name);
        const net = g.plans.reduce((a, p) => a + (p.ou || 0), 0);
        const need = g.plans.filter((p) => {
          const st = statusOf(p);
          return st === 'under' || st === 'critical' || weeks12(p).under >= 2;
        }).length;
        return (
          <div key={g.name} className="land-prog" data-prog={g.name}>
            <button type="button" className={`land-gh ${col ? 'col' : ''}`} onClick={() => toggleProg(g.name)}>
              <span className="gh-caret">{col ? '▸' : '▾'}</span>
              <span className="gh-name">{g.name}</span>
              <span className="gh-meta">
                {g.plans.length} plan{g.plans.length === 1 ? '' : 's'} · net O/U{' '}
                <b className={net < 0 ? 'neg-t' : 'pos-t'}>
                  {net >= 0 ? '+' : ''}
                  {f2(net)}
                </b>
                {need ? (
                  <>
                    {' '}
                    · <b className="neg-t">{need} need attention</b>
                  </>
                ) : null}
              </span>
            </button>
            {!col
              ? g.plans.map((p) => {
                  const ex = expanded.has(p.capId);
                  const bars = underOverBars(p);
                  const rc = recShort(p, gotBy);
                  return (
                    <div key={p.capId} className={`land-row ${ex ? 'exp' : ''}`} data-cap={p.capId}>
                      <button type="button" className="land-row-main" onClick={() => togglePlan(p.capId)}>
                        <span className="caret">{ex ? '▼' : '▶'}</span>
                        <span className="capchip">{p.capId}</span>
                        <span className="nm">
                          {p.plan}
                          {p.cls && (p.cls.status === 'missing' || p.cls.status === 'partial') ? (
                            <span className="flag">roster</span>
                          ) : null}
                        </span>
                        <span className={`mono ${p.sustained < 0 ? 'neg-t' : 'pos-t'}`}>{f2(p.sustained)}</span>
                        <span className="uo">
                          <b className="neg-t">{bars.under}</b> under · <b className="pos-t">{bars.over}</b> over
                        </span>
                        <span className={`recchip ${rc.cls}`}>{rc.t}</span>
                        <span
                          className="open-mini"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenPlan?.(p.capId);
                          }}
                        >
                          Open →
                        </span>
                      </button>
                      {ex ? <PlanExpandDetail plan={p} onOpenDetail={onOpenPlan} /> : null}
                    </div>
                  );
                })
              : null}
          </div>
        );
      })}

      {!groups.length ? (
        <div className="fold in" style={{ opacity: 1, transform: 'none' }}>
          <b>No plans match</b> — try clearing search or changing the program filter
        </div>
      ) : null}
    </div>
  );
}
