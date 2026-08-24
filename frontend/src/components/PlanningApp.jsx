import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { loadAllDataRows } from '../utils/planTransform';
import { buildScenarioSteps, SCENARIOS } from '../data/scenarios';
import { f2, hm } from '../utils/format';
import { useScenarioEngine } from '../hooks/useScenarioEngine';
import { useVoice } from '../hooks/useVoice';
import { useAgentWebSocket } from '../hooks/useAgentWebSocket';
import AgentCursor from './AgentCursor';
import AgentAvatar from './AgentAvatar';
import PlanTabs, { TAB_LABELS, tabsForPlan } from './plan/PlanTabs';
import PortfolioLanding from './PortfolioLanding';
import { computeXutil, defaultOtWeekly, fwdCount } from '../utils/planLogic';

const SHOW_SCENARIO_REPLAY = false;

function buildEditorWeeks(plan) {
  if (!plan) return [];
  const i0 = plan.curIdx;
  const rows = [];
  for (let i = 7; i < 12; i++) {
    if (i0 + i >= plan.weeks.length) break;
    const idx = i0 + i;
    const baseShrink = plan.sShrink[idx] ?? plan.sShrinkPlan[idx];
    rows.push({
      weekIdx: idx,
      wk: plan.weeks[idx],
      base: baseShrink,
      cur: baseShrink,
      proj: plan.sProj[idx],
    });
  }
  return rows;
}

export default function PlanningApp({ logoSrc }) {
  const workspaceRef = useRef(null);
  const domHandlersRef = useRef({});
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [triage, setTriage] = useState({ dec: [], auto: [], quiet: [] });
  const [programs, setPrograms] = useState([]);
  const [cycleLabel, setCycleLabel] = useState('Week of Aug 02, 2026');
  const [ledger, setLedger] = useState([]);
  const [memories, setMemories] = useState([]);
  const [streamMode, setStreamMode] = useState(false);
  const [wsStepLabel, setWsStepLabel] = useState('Ready');
  const [chatInput, setChatInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [planDecisions, setPlanDecisions] = useState({});
  const [otWeeksByCap, setOtWeeksByCap] = useState({});
  const paneRef = useRef(null);
  const chatEndRef = useRef(null);
  const stateRef = useRef(null);

  const [state, setState] = useState({
    view: 'port',
    filter: 'all',
    activePlan: 'CAP00010',
    activeTab: 'ov',
    shownTabs: [],
    messages: [],
    bubble: '',
    agentTalk: false,
    agentHear: false,
    agentStatus: 'Standing by',
    savedMin: 0,
    savedBump: false,
    focusCap: null,
    snap: false,
    foldVisible: false,
    revealed: {},
    counts: { c1: '', c2: '' },
    chartOU: null,
    chartShr: null,
    editorReady: false,
    editorWeeks: [],
    editSrc: 'plan values',
    netReq: null,
    doneShr: false,
    doneRoster: false,
    doneRec: false,
    execDone: false,
    execMsg: '',
    ledgerAnimated: false,
    memoriesCited: false,
    packages: [],
  });
  stateRef.current = state;

  const engine = useScenarioEngine(state, setState, { workspaceRef, domHandlersRef });

  const ws = useAgentWebSocket({
    actionsRef: engine.actionsRef,
    onStep: (ev) => {
      if (ev.type === 'step_begin') {
        engine.setStepFromStream(ev.index);
        setWsStepLabel(ev.label || 'Running');
      }
      if (ev.type === 'start') setWsStepLabel('Starting…');
    },
    onComplete: () => {
      engine.setStepFromStream(0, true);
      setWsStepLabel('Complete');
    },
    onError: (msg) => {
      engine.pushRef.current?.('d', 'Stream', msg || 'WebSocket error');
    },
  });

  const voice = useVoice({
    actionsRef: engine.actionsRef,
    stateRef,
    setState,
    pushRef: engine.pushRef,
    isHumanActive: engine.isHumanActive,
  });

  const matchesSearch = useCallback((item) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return [item.plan_name, item.cap_id, item.program, item.lob, item.site, item.why]
      .some((field) => (field || '').toLowerCase().includes(q));
  }, [searchQuery]);

  const refreshPortfolio = useCallback(async () => {
    try {
      const [rows, tri, progs, cycle, pkg] = await Promise.all([
        loadAllDataRows(api),
        api.triage(),
        api.programs(),
        api.cycle(),
        api.queue(),
      ]);
      setData(rows);
      setTriage(tri);
      setPrograms(progs);
      setCycleLabel(cycle.week_label);
      setState((s) => ({
        ...s,
        packages: (pkg || []).map((p) => {
          const prev = s.packages.find((x) => x.id === p.id);
          return { ...p, ticked: prev?.ticked ?? false, done: prev?.done ?? false };
        }),
        editorWeeks: buildEditorWeeks(rows.find((r) => r.capId === s.activePlan) || rows[0]),
      }));
    } catch (e) {
      console.error(e);
    }
  }, [setState]);

  useEffect(() => {
    (async () => {
      try {
        const [rows, tri, progs, cycle, pkg, led, mem] = await Promise.all([
          loadAllDataRows(api),
          api.triage(),
          api.programs(),
          api.cycle(),
          api.queue(),
          api.ledger(),
          api.memories(),
        ]);
        setData(rows);
        setTriage(tri);
        setPrograms(progs);
        setCycleLabel(cycle.week_label);
        setLedger(led.entries || []);
        setMemories(mem);
        setState((s) => ({
          ...s,
          packages: (pkg || []).map((p) => ({ ...p, ticked: false, done: false })),
          editorWeeks: buildEditorWeeks(rows.find((r) => r.capId === 'CAP00010')),
          revealed: { dec: true, auto: true },
          foldVisible: true,
          counts: {
            c1: String(tri.dec?.length ?? ''),
            c2: String(tri.auto?.length ?? ''),
          },
        }));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const p = data.find((r) => r.capId === state.activePlan);
    if (p) setState((s) => ({ ...s, editorWeeks: buildEditorWeeks(p) }));
  }, [state.activePlan, data]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages.length]);

  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [state.view, state.filter]);

  const activePlan = useMemo(() => data.find((p) => p.capId === state.activePlan), [data, state.activePlan]);

  const filteredDec = useMemo(
    () => (triage.dec?.filter((p) => (state.filter === 'all' || p.program === state.filter) && matchesSearch(p)) || []),
    [triage.dec, state.filter, matchesSearch],
  );
  const filteredAuto = useMemo(
    () => (triage.auto?.filter((p) => (state.filter === 'all' || p.program === state.filter) && matchesSearch(p)) || []),
    [triage.auto, state.filter, matchesSearch],
  );
  const filteredQuiet = useMemo(
    () => (triage.quiet?.filter((p) => (state.filter === 'all' || p.program === state.filter) && matchesSearch(p)) || []),
    [triage.quiet, state.filter, matchesSearch],
  );
  const showing = useMemo(() => {
    const base = state.filter === 'all' ? data : data.filter((p) => p.program === state.filter);
    if (!searchQuery.trim()) return base.length;
    const q = searchQuery.trim().toLowerCase();
    return base.filter((p) =>
      [p.plan, p.capId, p.program, p.lob, p.site, p.planner].some((f) => (f || '').toLowerCase().includes(q)),
    ).length;
  }, [data, state.filter, searchQuery]);

  const setEditorWeek = (k, v) => {
    setState((s) => {
      const ew = [...s.editorWeeks];
      if (ew[k]) ew[k] = { ...ew[k], cur: v };
      return { ...s, editorWeeks: ew, editSrc: 'edited by you' };
    });
  };

  const handleSubmitShrinkage = useCallback(async () => {
    setState((s) => ({ ...s, doneShr: true }));
    try {
      await api.submitShrinkage(
        stateRef.current.activePlan,
        stateRef.current.editorWeeks.map((w) => ({ week_idx: w.weekIdx, shrink_plan: w.cur })),
      );
      await refreshPortfolio();
    } catch (e) {
      console.error(e);
    }
  }, [setState, refreshPortfolio]);

  const handleMapRoster = useCallback(async () => {
    setState((s) => ({ ...s, doneRoster: true }));
    try {
      await api.mapRoster(stateRef.current.activePlan, {});
      await refreshPortfolio();
    } catch (e) {
      console.error(e);
    }
  }, [setState, refreshPortfolio]);

  const handleAcceptRec = useCallback(() => {
    const capId = stateRef.current.activePlan;
    setState((s) => ({
      ...s,
      doneRec: true,
      packages: s.packages.map((p) =>
        p.cap_id === capId && !p.done ? { ...p, ticked: true } : p,
      ),
    }));
    setPlanDecisions((d) => ({
      ...d,
      [capId]: { ...(d[capId] || {}), rec: 'acc' },
    }));
  }, []);

  const handleRejectRec = useCallback(() => {
    const capId = stateRef.current.activePlan;
    setState((s) => ({
      ...s,
      doneRec: false,
      packages: s.packages.map((p) => (p.cap_id === capId ? { ...p, ticked: false } : p)),
    }));
    setPlanDecisions((d) => ({
      ...d,
      [capId]: { ...(d[capId] || {}), rec: 'rej' },
    }));
  }, []);

  const handleRecOverride = useCallback((patch) => {
    const capId = stateRef.current.activePlan;
    setPlanDecisions((d) => ({
      ...d,
      [capId]: {
        ...(d[capId] || {}),
        rec: 'mod',
        recOvr: { ...(d[capId]?.recOvr || {}), ...patch },
      },
    }));
  }, []);

  const handleDecide = useCallback((kind, sub, mode) => {
    const capId = stateRef.current.activePlan;
    setPlanDecisions((d) => {
      const cur = { ...(d[capId] || {}) };
      if (kind === 'shr') cur.shr = mode;
      else if (kind === 'fw') cur.fw = { ...(cur.fw || {}), [sub]: mode };
      else if (kind === 'rec') cur.rec = mode;
      else if (kind === 'att') cur.att = mode;
      return { ...d, [capId]: cur };
    });
    if (kind === 'shr' && (mode === 'acc' || mode === 'mod')) {
      setState((s) => ({ ...s, editorReady: true, chartShr: { capId, ready: true } }));
    }
  }, [setState]);

  const handleOtWeekChange = useCallback((idx, value) => {
    const capId = stateRef.current.activePlan;
    const plan = data.find((p) => p.capId === capId);
    if (!plan) return;
    const n = fwdCount(plan);
    setOtWeeksByCap((prev) => {
      const base = prev[capId]?.length === n ? [...prev[capId]] : Array(n).fill(defaultOtWeekly(plan));
      base[idx] = value;
      return { ...prev, [capId]: base };
    });
  }, [data]);

  const handleOpenQueue = useCallback(() => {
    setState((s) => ({ ...s, view: 'queue', revealed: { ...s.revealed, pkg: true } }));
  }, []);

  const handleSelectAllPackages = useCallback(() => {
    setState((s) => ({
      ...s,
      packages: s.packages.map((p) => (p.done ? p : { ...p, ticked: true })),
    }));
  }, []);

  const handleClearPackages = useCallback(() => {
    setState((s) => ({
      ...s,
      packages: s.packages.map((p) => ({ ...p, ticked: false })),
    }));
  }, []);

  const handleExecuteSelected = useCallback(async () => {
    const ticked = stateRef.current.packages.filter((p) => p.ticked && !p.done);
    const ids = ticked.map((p) => p.id).filter(Boolean);
    let message = 'No packages selected.';
    if (ids.length) {
      try {
        const res = await api.executeQueue(ids);
        message = res?.message || `Posted ${ids.length} package(s) to CAP-ABILITY`;
      } catch (e) {
        console.error(e);
        message = e.message || 'Execute failed';
      }
    }
    setState((s) => ({
      ...s,
      execDone: ids.length > 0,
      execMsg: message,
      packages: s.packages.map((p) =>
        p.ticked ? { ...p, done: true, status: 'posted', ticked: false } : p,
      ),
    }));
    refreshPortfolio();
    return { message };
  }, [setState, refreshPortfolio]);

  const handleExecutePlan = useCallback(async () => {
    const capId = stateRef.current.activePlan;
    if (!stateRef.current.doneRec) {
      return { message: 'No approved package yet — accept a recommendation first.' };
    }
    const match = stateRef.current.packages.find((p) => p.cap_id === capId && !p.done);
    if (!match?.id) {
      setState((s) => ({
        ...s,
        execDone: true,
        execMsg: `Local execute for ${capId} — no queued package id; marked complete in UI.`,
      }));
      return { message: `Local execute for ${capId}` };
    }
    let message = '';
    try {
      const res = await api.executeQueue([match.id]);
      message = res?.message || `Posted 1 package to CAP-ABILITY`;
    } catch (e) {
      console.error(e);
      message = e.message || 'Execute failed';
    }
    setState((s) => ({
      ...s,
      execDone: true,
      execMsg: message,
      packages: s.packages.map((p) =>
        p.cap_id === capId ? { ...p, done: true, status: 'posted', ticked: false } : p,
      ),
    }));
    refreshPortfolio();
    return { message };
  }, [setState, refreshPortfolio]);

  domHandlersRef.current = {
    setFilter: (prog) => setState((s) => ({ ...s, filter: prog, view: 'port', focusCap: null })),
    openPlan: (capId) => {
      const p = data.find((r) => r.capId === capId);
      const tabs = tabsForPlan(p);
      setState((s) => ({
        ...s,
        view: 'plan',
        activePlan: capId,
        focusCap: capId,
        activeTab: 'ov',
        shownTabs: tabs,
        editorWeeks: p ? buildEditorWeeks(p) : s.editorWeeks,
        editorReady: true,
        chartOU: { capId, ready: true, mark: 8, lbl: '' },
        chartShr: { capId, ready: true },
        doneRec: false,
        doneShr: false,
        doneRoster: false,
      }));
      if (p) {
        setOtWeeksByCap((prev) => ({
          ...prev,
          [capId]: prev[capId]?.length === fwdCount(p) ? prev[capId] : Array(fwdCount(p)).fill(defaultOtWeekly(p)),
        }));
      }
    },
    openTab: (tab) => {
      setState((s) => ({
        ...s,
        view: 'plan',
        activeTab: tab,
        shownTabs: s.shownTabs.includes(tab) ? s.shownTabs : [...s.shownTabs, tab],
        editorReady: tab === 'shr' || tab === 'ov' ? true : s.editorReady,
      }));
    },
    view: (v) => {
      setState((s) => ({
        ...s,
        view: v,
        ...(v === 'queue' ? { revealed: { ...s.revealed, pkg: true } } : {}),
      }));
    },
    mapRoster: handleMapRoster,
    submitShrinkage: handleSubmitShrinkage,
    acceptRec: handleAcceptRec,
    rejectRec: handleRejectRec,
    selectAllPackages: handleSelectAllPackages,
    clearPackages: handleClearPackages,
    executeSelected: handleExecuteSelected,
    executePlan: handleExecutePlan,
    togglePackage: (capId) => {
      setState((s) => ({
        ...s,
        packages: s.packages.map((p) =>
          p.cap_id === capId && !p.done ? { ...p, ticked: !p.ticked } : p,
        ),
      }));
    },
  };

  const togglePackage = (capId) => {
    engine.markHumanActive();
    setState((s) => ({
      ...s,
      packages: s.packages.map((p) => (p.cap_id === capId ? { ...p, ticked: !p.ticked } : p)),
    }));
  };

  const crumb = {
    port: ['Portfolio — grouped by Program', `${data.length} plans`],
    plan: ['CP FTE Based · detailed analysis', state.activePlan],
    queue: ['Review & execute', 'action queue'],
    time: ['Time & memory', 'ledger'],
  }[state.view] || ['Portfolio — grouped by Program', '11 plans'];

  const steps = buildScenarioSteps(SCENARIOS[engine.scenarioIdx]?.key, {});
  const localStepLabel =
    engine.stepIdx >= engine.stepCount ? 'Complete' : engine.stepIdx === 0 ? 'Ready' : steps[engine.stepIdx - 1]?.l || 'Ready';
  const stepLabel = streamMode ? wsStepLabel : localStepLabel;

  const ticked = state.packages.filter((p) => p.ticked);
  const qOT = ticked.reduce((a, p) => a + (p.ot_hrs || 0), 0);
  const qXU = ticked.reduce((a, p) => a + (p.xu_fte || 0), 0);
  const qHR = ticked.reduce((a, p) => a + (p.hire_count || 0), 0);
  const qOTn = ticked.filter((p) => p.ot_hrs > 0).length;
  const qXUn = ticked.filter((p) => p.xu_fte > 0).length;
  const qHRn = ticked.filter((p) => p.hire_count > 0).length;

  const handlePlay = async () => {
    if (streamMode) {
      if (ws.streaming) {
        ws.stopScenario();
        engine.setStepFromStream(engine.stepIdx, false);
        return;
      }
      engine.reset();
      setWsStepLabel('Starting…');
      await ws.startScenario(engine.scenarioIdx, engine.speed);
      return;
    }
    engine.toggle();
  };

  const handleTabClick = (k) => {
    setState((s) => ({
      ...s,
      activeTab: k,
      shownTabs: s.shownTabs.includes(k) ? s.shownTabs : [...s.shownTabs, k],
    }));
  };

  if (loading) {
    return (
      <div className="app-shell">
        <div className="app-loading">Loading portfolio from database…</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="top">
        <div className="top-in">
          <img className="logo" alt="Datanitiv" src={logoSrc} />
          <span className="tg">CAP-ABILITY · Planning agent</span>
          <span className="lv"><i></i>{cycleLabel}</span>
        </div>
      </header>

      <main className="app-main">
        <div className="console" id="console">
            {SHOW_SCENARIO_REPLAY ? (
            <div className="scnbar" id="scnbar">
              {engine.SCENARIOS.map((s, i) => (
                <button key={s.key} type="button" className={`scn ${engine.scenarioIdx === i ? 'on' : ''}`} onClick={() => engine.pickScenario(i)}>
                  <kbd>{i + 1}</kbd>{s.t}
                </button>
              ))}
            </div>
            ) : null}

            <div
              className="ws human"
              id="ws"
              ref={workspaceRef}
              onPointerDownCapture={() => engine.markHumanActive()}
              onKeyDownCapture={() => engine.markHumanActive()}
            >
              <AgentCursor cursor={engine.cursor} />
              <div id="wsIn">
                <div className="wtop">
                  <span className="crumb"><b id="crumbTxt">{crumb[0]}</b></span>
                  <span className="pill" id="crumbPill">{crumb[1]}</span>
                  <div className="navviews">
                    {[
                      ['port', 'Portfolio'],
                      ['queue', 'Queue'],
                      ['time', 'Time'],
                    ].map(([v, label]) => (
                      <span
                        key={v}
                        className={state.view === v ? 'on' : ''}
                        data-view={v}
                        onClick={() => {
                          engine.markHumanActive();
                          domHandlersRef.current.view?.(v);
                        }}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  <span className="ctrl">◉ You have the mouse</span>
                  <span className={`saved ${state.savedBump ? 'bump' : ''}`} id="savedChip">⏱ <span id="saveTxt">{hm(state.savedMin)} saved</span></span>
                </div>

                <div className="filters">
                  <span
                    className={`sel ${state.filter === 'all' ? 'on' : ''}`}
                    data-filter="all"
                    onClick={() => {
                      engine.markHumanActive();
                      setState((s) => ({ ...s, filter: 'all' }));
                    }}
                  >
                    All programs
                  </span>
                  {programs.map((g) => (
                    <span
                      key={g.name}
                      className={`sel ${state.filter === g.name ? 'on' : ''}`}
                      data-filter={g.name}
                      onClick={() => {
                        engine.markHumanActive();
                        setState((s) => ({ ...s, filter: g.name }));
                      }}
                    >
                      {g.name}
                    </span>
                  ))}
                  <input
                    type="search"
                    className="srch"
                    placeholder="Search plan / planner / site"
                    value={searchQuery}
                    onChange={(e) => {
                      engine.markHumanActive();
                      setSearchQuery(e.target.value);
                    }}
                    aria-label="Search plans"
                  />
                  <span className="showing" id="showing">Showing {showing} of {data.length}</span>
                </div>

                {state.view === 'port' && (
                  <div className="pane on" data-view="port" ref={paneRef}>
                    <PortfolioLanding
                      plans={data}
                      programs={programs}
                      filter={state.filter}
                      search={searchQuery}
                      triageCounts={{
                        dec: filteredDec.length,
                        auto: filteredAuto.length,
                        quiet: filteredQuiet.length,
                      }}
                      gotBy={computeXutil(data).gotBy}
                      onOpenPlan={(capId) => {
                        engine.markHumanActive();
                        domHandlersRef.current.openPlan?.(capId);
                      }}
                    />
                  </div>
                )}

                {state.view === 'plan' && activePlan && (
                  <div className="pane on" data-view="plan" ref={paneRef}>
                    <div className="tabs">
                      <span className="lb">{tabsForPlan(activePlan).length} steps</span>
                      {tabsForPlan(activePlan).map((k) => (
                        <span
                          key={k}
                          className={`tab ${state.shownTabs.includes(k) ? 'shown' : ''} ${state.activeTab === k ? 'on' : ''}`}
                          data-tab={k}
                          onClick={() => {
                            engine.markHumanActive();
                            handleTabClick(k);
                          }}
                        >
                          {TAB_LABELS[k]}
                        </span>
                      ))}
                      <span className="peek" id="peekTxt">{state.shownTabs.length ? 'all tabs open' : 'peeking — agent skipped this'}</span>
                    </div>
                    <div className="tp-body">
                      <PlanTabs
                        activeTab={state.activeTab}
                        plan={activePlan}
                        state={state}
                        allPlans={data}
                        decisions={planDecisions[activePlan.capId] || {}}
                        otWeeks={otWeeksByCap[activePlan.capId] || []}
                        onEditorChange={setEditorWeek}
                        onSubmitShrinkage={handleSubmitShrinkage}
                        onMapRoster={handleMapRoster}
                        onAcceptRec={handleAcceptRec}
                        onRejectRec={handleRejectRec}
                        onOpenQueue={handleOpenQueue}
                        onDecide={handleDecide}
                        onOtWeekChange={handleOtWeekChange}
                        onExecutePlan={handleExecutePlan}
                        onRecOverride={handleRecOverride}
                      />
                    </div>
                  </div>
                )}

                {state.view === 'queue' && (
                  <div className="pane on" data-view="queue" ref={paneRef}>
                    <div className="qcards">
                      <div className="qc">
                        <span className="ic" style={{ background: '#3B6FB5' }}>⏱</span>
                        <div><div className="t">Overtime authorizations</div><div className="s" id="qOTn">{qOTn} plans</div></div>
                        <span className="v" id="qOT" style={{ color: '#3B6FB5' }}>{f2(qOT)} hrs</span>
                      </div>
                      <div className="qc">
                        <span className="ic" style={{ background: '#2E7D5B' }}>⇄</span>
                        <div><div className="t">Cross-util / loans</div><div className="s" id="qXUn">{qXUn} donor plans</div></div>
                        <span className="v" id="qXU" style={{ color: '#2E7D5B' }}>{f2(qXU)} FTE</span>
                      </div>
                      <div className="qc">
                        <span className="ic" style={{ background: '#F5B01A', color: '#1C1B18' }}>🎓</span>
                        <div><div className="t">New hire requisitions</div><div className="s" id="qHRn">{qHRn} plans</div></div>
                        <span className="v" id="qHR" style={{ color: '#8A6100' }}>{qHR} agents</span>
                      </div>
                    </div>
                    <div className="trihead"><b>Approved plan packages</b><span>tick the ones to execute</span></div>
                    <div className="selbar">
                      <b id="selCount">{ticked.length} of {state.packages.length}</b> selected to execute ·
                      <span className="mini" data-act="sel-all" onClick={() => handleSelectAllPackages()}>Select all</span>
                      <span className="mini" data-act="sel-none" onClick={() => handleClearPackages()}>Clear</span>
                    </div>
                    <div id="pkgList">
                      {state.packages.map((p) => (
                        <div
                          key={p.id}
                          className={`pkg ${state.revealed.pkg ? 'in' : ''} ${p.ticked ? 'tick' : ''} ${p.done ? 'done' : ''}`}
                          data-cap={p.cap_id}
                          onClick={() => togglePackage(p.cap_id)}
                        >
                          <span className="cbx"></span>
                          <div>
                            <div className="nm"><span className="pill">{p.cap_id}</span>{p.plan_name || p.cap_id}</div>
                            <div className="sub">{p.description || `OT ${f2(p.ot_hrs)} hrs · loan ${f2(p.xu_fte)} FTE`}</div>
                          </div>
                          <span className="st">{p.status === 'posted' ? 'Posted' : 'Queued'}</span>
                        </div>
                      ))}
                    </div>
                    <div className="acts" style={{ marginTop: 12 }}>
                      <div className="btn p" data-act="exec" onClick={() => handleExecuteSelected()}>
                        Execute selected →
                      </div>
                    </div>
                    <div className={`done ${state.execDone ? 'on' : ''}`} id="execDone"><span>✓</span><span>Packages posted to CAP-ABILITY</span></div>
                  </div>
                )}

                {state.view === 'time' && (
                  <div className="pane on" data-view="time" ref={paneRef}>
                    <div className="ledger">
                      <div id="ledRows">{ledger.map((l, i) => <div key={l.id} className={`lrow ${state.ledgerAnimated ? 'in' : ''}`} id={`lr${i}`}><span>{l.label}</span><span className="hr">{hm(l.minutes)}</span></div>)}</div>
                    </div>
                    <div className="memlist" id="memlist">{memories.map((m) => <div key={m.id} className={`mem ${state.memoriesCited ? 'cite' : ''}`}><div className="k">{m.rule_text}</div></div>)}</div>
                  </div>
                )}
              </div>
            </div>

            <aside className={`agent ${state.agentTalk ? 'talk' : ''} ${state.agentHear ? 'hear' : ''}`} id="agent">
              <div className="ahead">
                <div className="orb">
                  <span className="ring" />
                  <span className="ring r2" />
                  <AgentAvatar talking={state.agentTalk} listening={state.agentHear || voice.recording} />
                </div>
                <div className="anm">Vera</div>
                <div className="arl">Planning agent</div>
                <div className="wv"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
                <div className="ast" id="ast">{state.agentStatus}</div>
                <div className="voicebar">
                  <button
                    type="button"
                    className={`mic ${voice.recording ? 'on' : ''} ${voice.voiceBusy ? 'busy' : ''}`}
                    id="bMic"
                    title="Click to speak — ElevenLabs STT + Claude"
                    aria-label="Voice input"
                    onClick={voice.toggleRecording}
                    disabled={voice.voiceBusy}
                  >
                    {voice.recording ? '⏹' : '🎙'}
                  </button>
                  <span className="vhint">{voice.recording ? 'Listening… click to send' : 'Mic or type below'}</span>
                </div>
                <form
                  className="chat-in"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const msg = chatInput.trim();
                    if (!msg || voice.voiceBusy) return;
                    setChatInput('');
                    await voice.sendMessage(msg, 'text');
                  }}
                >
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask Vera — filter ACE Retail, open CAP00010…"
                    disabled={voice.voiceBusy}
                    aria-label="Message Vera"
                  />
                  <button type="submit" disabled={voice.voiceBusy || !chatInput.trim()} aria-label="Send">
                    →
                  </button>
                </form>
              </div>
              <div className="bub" id="bub">{state.bubble}</div>
              <div className="tl" id="tl">
                {state.messages.map((m, i) => (
                  <div key={i} className={`m ${m.cls}`}><div className="tg"><b style={{ background: m.hue }}></b>{m.tag}</div><div className="bd">{m.text}</div></div>
                ))}
                <div ref={chatEndRef} />
              </div>
            </aside>

            <div className="tp" style={SHOW_SCENARIO_REPLAY ? undefined : { display: 'none' }}>
              <button type="button" className="tb" id="bR" title="Restart (R)" aria-label="Restart (R)" onClick={engine.reset}>↺</button>
              <button
                type="button"
                className="tb play"
                id="bP"
                title="Play / pause (space)"
                aria-label="Play / pause (space)"
                onClick={handlePlay}
              >
                {(streamMode ? ws.streaming : engine.playing) ? '❚❚' : '▶'}
              </button>
              <button type="button" className="tb" id="bS" title="Step (right arrow)" aria-label="Step (right arrow)" disabled={engine.stepIdx >= engine.stepCount || streamMode} onClick={engine.step}>⏭</button>
              <button
                type="button"
                className={`streamtog ${streamMode ? 'on' : ''}`}
                title="Stream scenario from backend WebSocket"
                onClick={() => {
                  setStreamMode((m) => !m);
                  ws.connect();
                }}
              >
                {streamMode ? '● Stream' : 'Stream'}
              </button>
              <div className="trk">
                <div className="tks" id="tks">{[...Array(engine.stepCount)].map((_, i) => <i key={i} className={`${i < engine.stepIdx ? 'done' : ''} ${i === engine.stepIdx ? 'now' : ''}`}></i>)}</div>
                <div className="tmt"><span id="sLb">{stepLabel}</span><span id="sCt">{engine.stepIdx} / {engine.stepCount}</span></div>
              </div>
              {[1, 1.6, 2.4].map((sp) => <button key={sp} type="button" className={`sp ${engine.speed === sp ? 'on' : ''}`} onClick={() => engine.setSpeed(sp)}>{sp}x</button>)}
            </div>
        </div>
      </main>
    </div>
  );
}
