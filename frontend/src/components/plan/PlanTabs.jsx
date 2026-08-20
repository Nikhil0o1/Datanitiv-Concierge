import { f2 } from '../../utils/format';
import OUChart from '../OUChart';
import ShrChart from '../ShrChart';
import ShrinkageEditor from '../ShrinkageEditor';

const TAB_LABELS = {
  ov: 'Overview',
  hc: 'Headcount',
  nh: 'New Hire',
  shr: 'Shrinkage',
  att: 'Attrition',
  rec: 'Recommend',
  exe: 'Execute',
};

export { TAB_LABELS };

function HeadcountTab({ plan }) {
  const hc = plan.hcCur;
  if (!hc) {
    return (
      <div className="tsec on" data-sec="hc">
        <div className="card in">
          <div className="ch">
            <b>Headcount snapshot</b>
            <span className="tag">step 2 · agent skipped</span>
          </div>
          <p>No headcount snapshot for this plan.</p>
        </div>
      </div>
    );
  }

  const prevWk = plan.weeks[Math.max(0, plan.curIdx - 1)] || '07/26';
  const curWk = plan.weeks[plan.curIdx] || '08/02';

  const rows = [
    ['Opening FTE', hc.opening, hc.opening],
    ['+ Nesting → Production', 0, hc.nest],
    ['+ Transfer In', 0, hc.tin],
    ['− Transfer Out', 0, hc.tout],
    ['+ Back from LOA', 0, hc.loaIn],
    ['− Move to LOA', 0, hc.loaOut],
    ['− Production Attrition', 0, hc.attr],
    ['− Promotion (out)', 0, hc.promo],
    ['Closing FTE', hc.closing, hc.closing],
  ];

  return (
    <div className="tsec on" data-sec="hc">
      <div className="card in">
        <div className="ch">
          <b>Headcount snapshot</b>
          <span className="tag">step 2 · agent skipped</span>
        </div>
        <p>Every movement for last week and this week. Nothing here moves the decision — which is exactly why it was folded.</p>
        <table className="fl">
          <thead>
            <tr>
              <th>Movement</th>
              <th>Prev wk · {prevWk}</th>
              <th>Current wk · {curWk}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, prev, cur]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{f2(prev)}</td>
                <td className={cur > 0 && label.startsWith('+') ? 'pos-t' : ''}>{f2(cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewHireTab({ plan, doneRoster, onMapRoster, humanMode }) {
  const cls = plan.cls;
  if (!cls) {
    return (
      <div className="tsec on" data-sec="nh">
        <div className="card in">
          <div className="ch">
            <b>New hire roster</b>
            <span className="tag">step 3</span>
          </div>
          <p>No roster gaps flagged for this plan.</p>
        </div>
      </div>
    );
  }

  const gap = Math.abs(plan.sustained);
  const rosterFte = cls.plan - cls.actual;
  const realGap = doneRoster ? gap - rosterFte : gap;

  return (
    <div className="tsec on" data-sec="nh">
      <div className="card warn in">
        <div className="ch">
          <b>Roster gap — this one does matter</b>
          <span className="tag">step 3</span>
        </div>
        <p>
          Class <b>{cls.name || 'TC_2026_91020'}</b> ran on <b>{cls.date}</b>, two weeks ago.{' '}
          <b>{f2(rosterFte)} FTE</b> of trained heads are onboarded but not mapped on the employee roster, so projected
          FTE excludes them and the shortfall reads worse than it is.
        </p>
        <table className="fl" style={{ marginTop: 9 }}>
          <thead>
            <tr>
              <th>Class</th>
              <th>Train / nest</th>
              <th>Plan HC</th>
              <th>Onboarded</th>
              <th>Roster</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{cls.name || 'TC_2026_91020'}</td>
              <td>
                {cls.trainWk} wk / {cls.nestWk} wk
              </td>
              <td>{f2(cls.plan)}</td>
              <td className="neg-t">{f2(cls.actual)}</td>
              <td className="neg-t">{cls.status === 'missing' ? 'Not uploaded' : 'Mapped'}</td>
            </tr>
          </tbody>
        </table>
        <div className="math">
          <div className="mline">
            <span>Reported 12-week gap</span>
            <span>{f2(gap)} FTE</span>
          </div>
          <div className="mline cut">
            <span>Onboarded, not on roster</span>
            <span>−{f2(rosterFte)} FTE</span>
          </div>
          <div className="mline">
            <span>Real gap</span>
            <span>{f2(realGap)} FTE</span>
          </div>
        </div>
        <div className="acts">
          <div className="btn p" data-act="go-roster" onClick={humanMode ? onMapRoster : undefined}>
            Map the roster
          </div>
          <div className="btn g">Upload file</div>
        </div>
        <div className={`done ${doneRoster ? 'on' : ''}`} id="doneRoster">
          <span>✓</span>
          <span>
            {f2(rosterFte)} FTE mapped · projected FTE corrected · gap now {f2(realGap)}
          </span>
        </div>
      </div>
    </div>
  );
}

function AttritionTab({ plan }) {
  const actual = plan.attr12 ?? 0;
  const planned = 0;
  const variance = actual - planned;

  return (
    <div className="tsec on" data-sec="att">
      <div className="card in">
        <div className="ch">
          <b>Attrition trend</b>
          <span className="tag">step 5 · agent skipped</span>
        </div>
        <div className="kpis">
          <div className="kpi">
            <b>{f2(actual)}%</b>
            <span>8-wk actual</span>
          </div>
          <div className="kpi">
            <b>{f2(planned)}%</b>
            <span>Planned</span>
          </div>
          <div className="kpi">
            <b>{variance >= 0 ? '+' : ''}{f2(variance)}pt</b>
            <span>Variance</span>
          </div>
        </div>
        <p style={{ marginTop: 9 }}>
          Production attrition is flat at zero on both actual and plan across the whole window. There is nothing to
          adjust and nothing to decide, which is why the agent left it closed.
        </p>
      </div>
    </div>
  );
}

function RecommendTab({ plan, doneRoster, doneRec, onAccept, humanMode }) {
  const gap = Math.abs(plan.sustained);
  const rosterFte = plan.cls ? plan.cls.plan - plan.cls.actual : 0;
  const realGap = doneRoster || plan.cls == null ? gap - (doneRoster ? rosterFte : 0) : gap;
  const loan = Math.min(realGap, 6.68);

  return (
    <div className="tsec on" data-sec="rec">
      <div className="card good in">
        <div className="ch">
          <b>Staffing recommendation</b>
          <span className="tag">step 6</span>
        </div>
        <div className="math">
          <div className="mline">
            <span>Real gap after roster fix</span>
            <span>{f2(realGap)} FTE</span>
          </div>
          <div className="mline">
            <span className="strike">Overtime · 100.00 hrs/wk</span>
            <span className="strike">2.50 FTE</span>
          </div>
          <div className="mline add">
            <span>Cross-util from CAP00013 · MX City</span>
            <span>−{f2(loan)} FTE</span>
          </div>
          <div className="mline">
            <span>Hire</span>
            <span>0 starts</span>
          </div>
          <div className="mline">
            <span>Residual</span>
            <span>0.00 FTE</span>
          </div>
        </div>
        <p style={{ marginTop: 9 }}>
          No overtime and no requisition. CAP00013 can lend <b>13.63</b> and still keep a full FTE of headroom in its
          worst forward week.
        </p>
        <div className="acts">
          <div className="btn p" data-act="go-accept" onClick={humanMode ? onAccept : undefined}>
            Accept &amp; queue
          </div>
          <div className="btn g">Modify</div>
          <div className="btn g">Reject</div>
        </div>
        <div className={`done ${doneRec ? 'on' : ''}`} id="doneRec">
          <span>✓</span>
          <span>Package accepted · added to the execution queue · nothing posted yet</span>
        </div>
      </div>
    </div>
  );
}

function ExecuteTab({ onOpenQueue, humanMode }) {
  return (
    <div className="tsec on" data-sec="exe">
      <div className="card in">
        <div className="ch">
          <b>Execute</b>
          <span className="tag">step 7</span>
        </div>
        <p>
          This plan&apos;s package moves to the portfolio action queue, where you tick what actually posts to CAP-ABILITY.
          Open the queue from the top bar.
        </p>
        <div className="acts">
          <div className="btn p" data-view="queue" onClick={humanMode ? onOpenQueue : undefined}>
            Open action queue
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PlanTabs({
  activeTab,
  plan,
  state,
  humanMode,
  onEditorChange,
  onSubmitShrinkage,
  onMapRoster,
  onAcceptRec,
  onOpenQueue,
}) {
  if (!plan) return null;

  const shrinkKpis = () => {
    const actual8 = plan.shrink12 ?? 43.11;
    const i0 = plan.curIdx;
    const fwd = plan.sShrinkPlan.slice(i0 + 1, i0 + 12);
    const planFwd = fwd.length ? fwd.reduce((a, b) => a + b, 0) / fwd.length : 20.58;
    return { actual8, planFwd, variance: actual8 - planFwd };
  };

  const sk = shrinkKpis();

  return (
    <>
      {activeTab === 'ov' && (
        <div className="tsec on" data-sec="ov">
          <div className="card in">
            <div className="ch">
              <b>Plan overview</b>
              <span className="tag">step 1</span>
            </div>
            <div className="kpis">
              <div className="kpi">
                <b>{f2(plan.sReq[plan.curIdx])}</b>
                <span>Required</span>
              </div>
              <div className="kpi">
                <b>{f2(plan.sProj[plan.curIdx])}</b>
                <span>Projected</span>
              </div>
              <div className="kpi neg">
                <b>{f2(plan.sustained)}</b>
                <span>12-wk avg O/U</span>
              </div>
              <div className="kpi neg">
                <b>{f2(plan.minOUfwd)}</b>
                <span>Worst week</span>
              </div>
            </div>
            <div id="chOU" style={{ marginTop: 11 }}>
              {state.chartOU?.ready && (
                <OUChart plan={plan} mark={state.chartOU.mark} lbl={state.chartOU.lbl} editorWeeks={state.editorWeeks} />
              )}
            </div>
            <div className="lgd">
              <span>
                <i style={{ background: '#2E7D5B' }}></i>Covered
              </span>
              <span>
                <i style={{ background: '#C4463C' }}></i>Short
              </span>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'hc' && <HeadcountTab plan={plan} />}
      {activeTab === 'nh' && (
        <NewHireTab plan={plan} doneRoster={state.doneRoster} onMapRoster={onMapRoster} humanMode={humanMode} />
      )}

      {activeTab === 'shr' && state.editorReady && (
        <div className="tsec on" data-sec="shr">
          <div className="card in">
            <div className="ch">
              <b>Shrinkage trend</b>
              <span className="tag">step 4</span>
            </div>
            <div className="kpis">
              <div className="kpi neg">
                <b>{sk.actual8.toFixed(2)}%</b>
                <span>8-wk actual</span>
              </div>
              <div className="kpi">
                <b>{sk.planFwd.toFixed(2)}%</b>
                <span>Planned fwd</span>
              </div>
              <div className="kpi neg">
                <b>+{sk.variance.toFixed(2)}pt</b>
                <span>Variance</span>
              </div>
            </div>
            {state.chartShr?.ready && <ShrChart plan={plan} />}
            <div className="lgd">
              <span>
                <i style={{ background: '#B57A11' }}></i>Actual
              </span>
              <span>
                <i style={{ background: '#D2CDC1' }}></i>Plan forward
              </span>
            </div>
            <ShrinkageEditor
              weeks={state.editorWeeks}
              billable={plan.billable}
              onChange={onEditorChange}
              editSrc={state.editSrc}
              netReq={state.netReq}
              humanMode={humanMode}
              onSubmit={onSubmitShrinkage}
              doneShr={state.doneShr}
            />
          </div>
        </div>
      )}

      {activeTab === 'att' && <AttritionTab plan={plan} />}
      {activeTab === 'rec' && (
        <RecommendTab
          plan={plan}
          doneRoster={state.doneRoster}
          doneRec={state.doneRec}
          onAccept={onAcceptRec}
          humanMode={humanMode}
        />
      )}
      {activeTab === 'exe' && <ExecuteTab onOpenQueue={onOpenQueue} humanMode={humanMode} />}
    </>
  );
}
