import { f2 } from '../../utils/format';
import { statusOf } from '../../utils/planLogic';
import { PEEK_TAGS, TAB_LABELS, tabsForPlan } from './PlanTabs';

const STEP_NUM = { ov: 1, hc: 2, nh: 3, shr: 4, att: 5, rec: 6, exe: 7 };

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

function railDot(plan) {
  const st = statusOf(plan);
  if (st === 'under' || st === 'critical') return '#F5B01A';
  if (Math.abs(plan.sustained || 0) <= 1) return '#9A948A';
  return '#2E7D5B';
}

function railValColor(plan) {
  const ou = plan.ouShrink ?? plan.sOU?.[plan.curIdx] ?? plan.ou ?? 0;
  return ou < 0 ? 'var(--neg)' : 'var(--muted)';
}

export function PlanRail({ plans = [], activeCapId, focusedPlan, onSelectPlan, onBackPortfolio }) {
  const sorted = [...plans].sort((a, b) => (a.sustained || 0) - (b.sustained || 0));

  return (
    <div className="rail">
      <div className="rhead">
        <span>Plans</span>
        <span>{plans.length}</span>
      </div>
      <button type="button" className="rall" data-view="port" onClick={onBackPortfolio}>
        ▦ All plans (portfolio)
      </button>
      {focusedPlan ? (
        <div className="rfoc">◉ Focused: {focusedPlan.plan}</div>
      ) : null}
      {sorted.map((p) => (
        <button
          key={p.capId}
          type="button"
          className={`ritem ${p.capId === activeCapId ? 'on' : ''}`}
          data-cap={p.capId}
          onClick={() => onSelectPlan?.(p.capId)}
        >
          <span className="dot" style={{ background: railDot(p) }} />
          <span className="id">{p.capId}</span>
          <span className="val" style={{ color: railValColor(p) }}>
            {f2(p.ouShrink ?? p.sOU?.[p.curIdx] ?? p.ou ?? 0)}
          </span>
        </button>
      ))}
    </div>
  );
}

export function PlanStepper({ plan, activeTab, shownTabs, onTabClick }) {
  const keys = tabsForPlan(plan);

  return (
    <div className="stepper">
      {keys.map((k) => {
        const num = STEP_NUM[k];
        const done = shownTabs.includes(k) && k !== activeTab;
        return (
          <button
            key={k}
            type="button"
            className={`stp ${activeTab === k ? 'on' : ''} ${done ? 'done' : ''}`}
            data-step={k}
            onClick={() => onTabClick?.(k)}
          >
            {num != null ? <b>{num}</b> : null}
            {TAB_LABELS[k]}
          </button>
        );
      })}
      {PEEK_TAGS[activeTab] ? <span className="peek">{PEEK_TAGS[activeTab]}</span> : null}
    </div>
  );
}

export function PlanHeader({ plan }) {
  if (!plan) return null;
  const ouNow = plan.ouShrink ?? plan.sOU?.[plan.curIdx] ?? plan.ou ?? 0;
  const req = plan.sReq?.[plan.curIdx] ?? plan.required ?? plan.closingFTE ?? 0;
  const proj = plan.sProj?.[plan.curIdx] ?? plan.projected ?? plan.closingFTE ?? 0;
  const br = [plan.program, plan.region, plan.site, plan.planner ? `Planner ${plan.planner}` : null]
    .filter(Boolean)
    .join(' › ');

  return (
    <div className="phdr">
      <div>
        <div className="nm">
          <span className="pp">{plan.capId}</span> {plan.plan}{' '}
          <span className={`stat ${statCls(plan)}`}>{statLabel(plan)}</span>
          {plan.cls && (plan.cls.status === 'missing' || plan.cls.status === 'partial') ? (
            <span className="flag">roster</span>
          ) : null}
        </div>
        {br ? <div className="br">{br}</div> : null}
      </div>
      <div className="mets">
        <div className="met">
          <i>Req</i>
          <b>{f2(req)}</b>
        </div>
        <div className="met">
          <i>Proj</i>
          <b>{f2(proj)}</b>
        </div>
        <div className="met">
          <i>O/U now</i>
          <b className={ouNow < 0 ? 'neg' : ouNow > 0 ? 'pos' : ''}>{ouNow >= 0 ? '+' : ''}{f2(ouNow)}</b>
        </div>
        <div className="met">
          <i>12-wk avg</i>
          <b className={plan.sustained < 0 ? 'neg' : plan.sustained > 0 ? 'pos' : ''}>
            {plan.sustained >= 0 ? '+' : ''}
            {f2(plan.sustained)}
          </b>
        </div>
      </div>
    </div>
  );
}
