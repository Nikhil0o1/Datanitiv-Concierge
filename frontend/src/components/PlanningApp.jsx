import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { emit, emitError } from '../lib/telemetry';
import { loadAllDataRows } from '../utils/planTransform';
import { buildScenarioSteps, SCENARIOS } from '../data/scenarios';
import { f2, hm } from '../utils/format';
import { useScenarioEngine } from '../hooks/useScenarioEngine';
import { useConcierge } from '../hooks/useConcierge';
import { useVoice } from '../hooks/useVoice';
import { useAgentWebSocket } from '../hooks/useAgentWebSocket';
import AgentCursor from './AgentCursor';
import AgentAvatar from './AgentAvatar';
import PlanSearchBar from './PlanSearchBar';
import { filterPlans, matchesPlanSearch } from '../utils/planSearch';
import ConciergeNudgePanel from './ConciergeNudgePanel';
import PlanTabs, { TAB_LABELS, tabsForPlan } from './plan/PlanTabs';
import PortfolioLanding from './PortfolioLanding';
import { computeXutil, defaultOtWeekly, fwdCount, hireTiming, planRec, scaleDonorsToXu } from '../utils/planLogic';

const SHOW_SCENARIO_REPLAY = false;

/** Forward planning horizon: this week through next 12 weeks (same window as shrink12 / Overview). */
const SHRINK_MAX = 70;

function clampShrink(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(SHRINK_MAX, Math.max(0, Math.round(n * 100) / 100));
}

function buildEditorWeeks(plan) {
  if (!plan) return [];
  const i0 = plan.curIdx;
  const rows = [];
  for (let i = 0; i < 12; i++) {
    if (i0 + i >= plan.weeks.length) break;
    const idx = i0 + i;
    const baseShrink = plan.sShrinkPlan[idx] ?? plan.sShrink[idx] ?? 0;
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

function mergeEditorWeeks(plan, prev, dirty) {
  const next = buildEditorWeeks(plan);
  if (!dirty || !prev?.length) return next;
  const curByIdx = new Map(prev.map((w) => [w.weekIdx, w.cur]));
  return next.map((w) => (curByIdx.has(w.weekIdx) ? { ...w, cur: curByIdx.get(w.weekIdx) } : w));
}

const ATTR_MAX = 40;

function clampAttr(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(ATTR_MAX, Math.max(0, Math.round(n * 100) / 100));
}

function buildAttrWeeks(plan) {
  if (!plan) return [];
  const i0 = plan.curIdx;
  const opening = Number(plan.hcCur?.opening) || Number(plan.sProj?.[i0]) || 0;
  const rows = [];
  for (let i = 0; i < 12; i++) {
    if (i0 + i >= plan.weeks.length) break;
    const idx = i0 + i;
    const base = plan.sAttrPlan[idx] ?? plan.sAttr[idx] ?? 0;
    const proj = Number(plan.sProj[idx]) || 0;
    rows.push({
      weekIdx: idx,
      wk: plan.weeks[idx],
      base,
      cur: base,
      proj,
      stock: i === 0 ? opening : proj,
    });
  }
  return rows;
}

function mergeAttrWeeks(plan, prev, dirty) {
  const next = buildAttrWeeks(plan);
  if (!dirty || !prev?.length) return next;
  const curByIdx = new Map(prev.map((w) => [w.weekIdx, w.cur]));
  return next.map((w) => (curByIdx.has(w.weekIdx) ? { ...w, cur: curByIdx.get(w.weekIdx) } : w));
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
  const [chatFile, setChatFile] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [planDecisions, setPlanDecisions] = useState({});
  const [otWeeksByCap, setOtWeeksByCap] = useState({});
  const paneRef = useRef(null);
  const chatEndRef = useRef(null);
  const chatFileRef = useRef(null);
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
    attrWeeks: [],
    editSrc: 'plan values',
    netReq: null,
    shrLastEdit: null,
    doneShr: false,
    shrDirty: false,
    attrLastEdit: null,
    doneAttr: false,
    attrDirty: false,
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

  const concierge = useConcierge({
    actionsRef: engine.actionsRef,
    stateRef,
    setState,
    isHumanActive: engine.isHumanActive,
    pushRef: engine.pushRef,
    enabled: !loading,
  });

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

  const matchesSearch = useCallback((item) => matchesPlanSearch(item, searchQuery), [searchQuery]);

  const filteredData = useMemo(
    () => filterPlans(data, { query: searchQuery, program: state.filter }),
    [data, searchQuery, state.filter],
  );

  const filteredPackages = useMemo(() => {
    const base =
      state.filter === 'all'
        ? state.packages
        : state.packages.filter((p) => {
            const row = data.find((d) => d.capId === p.cap_id);
            return row?.program === state.filter;
          });
    if (!searchQuery.trim()) return base;
    return base.filter((p) => matchesPlanSearch(p, searchQuery));
  }, [state.packages, state.filter, data, searchQuery]);

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
          const posted = p.status === 'posted' || Boolean(p.staffing_applied);
          return {
            ...p,
            ticked: posted ? false : (prev?.ticked ?? false),
            done: posted || Boolean(prev?.done),
          };
        }),
      }));
    } catch (e) {
      console.error(e);
    }
  }, [setState]);

  useEffect(() => {
    if (loading) return;
    emit('ui.context', {
      metadata: {
        cap_id: state.activePlan,
        active_cap_id: state.activePlan,
        active_tab: state.activeTab,
        view: state.view,
        filter: state.filter,
      },
    });
  }, [loading, state.activePlan, state.activeTab, state.view, state.filter]);

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
          attrWeeks: buildAttrWeeks(rows.find((r) => r.capId === 'CAP00010')),
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

  const editorPlanRef = useRef(null);
  useEffect(() => {
    const p = data.find((r) => r.capId === state.activePlan);
    if (!p) return;
    const switched = editorPlanRef.current !== state.activePlan;
    editorPlanRef.current = state.activePlan;
    setState((s) => ({
      ...s,
      ...(switched
        ? {
            shrDirty: false,
            doneShr: false,
            editSrc: 'plan values',
            shrLastEdit: null,
            attrDirty: false,
            doneAttr: false,
            attrLastEdit: null,
          }
        : {}),
      editorWeeks:
        switched || !s.shrDirty ? buildEditorWeeks(p) : mergeEditorWeeks(p, s.editorWeeks, true),
      attrWeeks: switched || !s.attrDirty ? buildAttrWeeks(p) : mergeAttrWeeks(p, s.attrWeeks, true),
    }));
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
  const showing = filteredData.length;

  const setEditorWeek = (k, v) => {
    setState((s) => {
      const ew = [...s.editorWeeks];
      if (ew[k]) ew[k] = { ...ew[k], cur: clampShrink(v) };
      return { ...s, editorWeeks: ew, editSrc: 'edited by you', shrLastEdit: k, doneShr: false, shrDirty: true };
    });
  };

  const setAttrWeek = (k, v) => {
    setState((s) => {
      const aw = [...(s.attrWeeks || [])];
      if (aw[k]) aw[k] = { ...aw[k], cur: clampAttr(v) };
      return { ...s, attrWeeks: aw, attrLastEdit: k, doneAttr: false, attrDirty: true };
    });
  };

  const handleApplyAttritionValue = useCallback(() => {
    setState((s) => {
      const aw = s.attrWeeks || [];
      if (!aw.length) return s;
      const idx = s.attrLastEdit != null && aw[s.attrLastEdit] ? s.attrLastEdit : 0;
      const val = clampAttr(aw[idx].cur);
      return {
        ...s,
        attrWeeks: aw.map((w) => ({ ...w, cur: val })),
        doneAttr: false,
        attrDirty: true,
      };
    });
  }, [setState]);

  const handleApplyAttritionPct = useCallback(() => {
    setState((s) => {
      const aw = s.attrWeeks || [];
      if (!aw.length) return s;
      const idx = s.attrLastEdit != null && aw[s.attrLastEdit] ? s.attrLastEdit : 0;
      const src = aw[idx];
      const base = src.base;
      if (base == null || base === 0) {
        const val = clampAttr(src.cur);
        return {
          ...s,
          attrWeeks: aw.map((w) => ({ ...w, cur: val })),
          doneAttr: false,
          attrDirty: true,
        };
      }
      const pct = (src.cur - base) / base;
      return {
        ...s,
        attrWeeks: aw.map((w) => ({
          ...w,
          cur: clampAttr(Math.round(w.base * (1 + pct) * 100) / 100),
        })),
        doneAttr: false,
        attrDirty: true,
      };
    });
  }, [setState]);

  const handleResetAttrition = useCallback(() => {
    setState((s) => ({
      ...s,
      attrWeeks: (s.attrWeeks || []).map((w) => ({ ...w, cur: w.base })),
      doneAttr: false,
      attrDirty: false,
      attrLastEdit: null,
    }));
  }, [setState]);

  const handleApplyShrinkageValue = useCallback(() => {
    setState((s) => {
      const ew = s.editorWeeks || [];
      if (!ew.length) return s;
      const idx = s.shrLastEdit != null && ew[s.shrLastEdit] ? s.shrLastEdit : 0;
      const val = clampShrink(ew[idx].cur);
      return {
        ...s,
        editorWeeks: ew.map((w) => ({ ...w, cur: val })),
        editSrc: `applied ${val.toFixed(1)}% to all weeks`,
        doneShr: false,
        shrDirty: true,
      };
    });
  }, [setState]);

  const handleApplyShrinkagePct = useCallback(() => {
    setState((s) => {
      const ew = s.editorWeeks || [];
      if (!ew.length) return s;
      const idx = s.shrLastEdit != null && ew[s.shrLastEdit] ? s.shrLastEdit : 0;
      const src = ew[idx];
      const base = src.base;
      if (base == null || base === 0) {
        // no % vs base — fall back to absolute value apply
        const val = clampShrink(src.cur);
        return {
          ...s,
          editorWeeks: ew.map((w) => ({ ...w, cur: val })),
          editSrc: `applied ${val.toFixed(1)}% to all weeks`,
          doneShr: false,
          shrDirty: true,
        };
      }
      const pct = (src.cur - base) / base;
      return {
        ...s,
        editorWeeks: ew.map((w) => {
          const next = clampShrink(Math.round(w.base * (1 + pct) * 100) / 100);
          return { ...w, cur: next };
        }),
        editSrc: `applied ${(pct * 100 >= 0 ? '+' : '')}${(pct * 100).toFixed(1)}% to all weeks`,
        doneShr: false,
        shrDirty: true,
      };
    });
  }, [setState]);

  const handleSubmitShrinkage = useCallback(async () => {
    try {
      await api.submitShrinkage(
        stateRef.current.activePlan,
        stateRef.current.editorWeeks.map((w) => ({ week_idx: w.weekIdx, shrink_plan: w.cur })),
      );
      emit('plan.shrinkage.submitted', {
        metadata: { cap_id: stateRef.current.activePlan, week_count: stateRef.current.editorWeeks.length, success: true },
      });
      setState((s) => ({ ...s, doneShr: true, shrDirty: false, editSrc: 'plan values' }));
      await refreshPortfolio();
    } catch (e) {
      setState((s) => ({ ...s, doneShr: false }));
      emitError('plan.shrinkage.failed', e, { cap_id: stateRef.current.activePlan });
      console.error(e);
    }
  }, [setState, refreshPortfolio]);

  const handleResetShrinkage = useCallback(() => {
    setState((s) => ({
      ...s,
      editorWeeks: (s.editorWeeks || []).map((w) => ({ ...w, cur: w.base })),
      editSrc: 'plan values',
      doneShr: false,
      shrDirty: false,
      shrLastEdit: null,
    }));
  }, [setState]);

  const handleSubmitAttrition = useCallback(async () => {
    try {
      await api.submitAttrition(
        stateRef.current.activePlan,
        (stateRef.current.attrWeeks || []).map((w) => ({ week_idx: w.weekIdx, attr_plan: w.cur })),
      );
      emit('plan.attrition.submitted', {
        metadata: { cap_id: stateRef.current.activePlan, week_count: stateRef.current.attrWeeks?.length, success: true },
      });
      setState((s) => ({ ...s, doneAttr: true, attrDirty: false }));
      await refreshPortfolio();
    } catch (e) {
      setState((s) => ({ ...s, doneAttr: false }));
      emitError('plan.attrition.failed', e, { cap_id: stateRef.current.activePlan });
      console.error(e);
    }
  }, [setState, refreshPortfolio]);

  const handleSubmitForecast = useCallback(async (body) => {
    await api.submitForecast(stateRef.current.activePlan, body);
    await refreshPortfolio();
  }, [refreshPortfolio]);

  const handleSaveHeadcount = useCallback(async (body) => {
    await api.updateHeadcount(stateRef.current.activePlan, body);
    await refreshPortfolio();
  }, [refreshPortfolio]);

  const handleMapRoster = useCallback(async (capIdOrOpts, maybeBody) => {
    let id = stateRef.current.activePlan;
    let body = {};
    if (typeof capIdOrOpts === 'string') {
      id = capIdOrOpts;
      body = maybeBody || {};
    } else if (capIdOrOpts && typeof capIdOrOpts === 'object') {
      body = capIdOrOpts;
      id = capIdOrOpts.cap_id || capIdOrOpts.capId || id;
    }
    const payload = {
      ...(body.class_id != null ? { class_id: body.class_id } : {}),
      ...(body.train_hc != null ? { train_hc: body.train_hc } : {}),
      ...(body.employees ? { employees: body.employees } : {}),
      ...(body.source_filename ? { source_filename: body.source_filename } : {}),
    };
    try {
      const res = await api.mapRoster(id, payload);
      setState((s) => ({ ...s, doneRoster: true }));
      emit('plan.roster.mapped', {
        metadata: { cap_id: id, success: true, mapped_fte: res?.mapped_fte, status: res?.status },
      });
      await refreshPortfolio();
      return res;
    } catch (e) {
      emitError('plan.roster.failed', e, { cap_id: id });
      console.error(e);
      setState((s) => ({ ...s, doneRoster: false }));
      throw e;
    }
  }, [setState, refreshPortfolio]);

  const handleAcceptRec = useCallback(async () => {
    const capId = stateRef.current.activePlan;
    const plan = data.find((p) => p.capId === capId);
    if (!plan) return;

    const ovr = planDecisions[capId]?.recOvr || {};
    const xutil = computeXutil(data);
    const rec = planRec(plan, {
      otPct: ovr.otPct ?? 5,
      xr: ovr.xr,
      starts: ovr.starts,
      gotBy: xutil.gotBy,
    });
    const donors = scaleDonorsToXu(xutil.donorsBy?.[capId] || [], rec.xr);
    const timing = hireTiming(plan, ovr);
    const n = fwdCount(plan);
    const weeks = otWeeksByCap[capId];
    const weekly = weeks?.length === n ? weeks : Array(n).fill(defaultOtWeekly(plan, rec.otPct));
    const otHrs = Number(weekly[0]) || rec.otHrs;
    const donorNote = donors.length
      ? ` from ${donors.slice(0, 3).map((d) => d.cap_id).join(', ')}${donors.length > 3 ? '…' : ''}`
      : '';
    const hireNote =
      rec.starts > 0
        ? ` · hire ${rec.starts} (prod +${timing.productiveIn}wk)`
        : ' · hire 0';

    try {
      const pkg = await api.upsertPackage({
        cap_id: capId,
        ot_hrs: otHrs,
        ot_fte: rec.otFTE,
        xu_fte: rec.xr,
        hire_count: rec.starts,
        train_wk: timing.trainWk,
        nest_wk: timing.nestWk,
        donors,
        description: `OT ${otHrs.toFixed(2)} hrs/wk · loan ${Number(rec.xr).toFixed(2)} FTE${donorNote}${hireNote} · accepted`,
      });
      emit('recommend.accepted', {
        metadata: {
          cap_id: capId,
          package_id: pkg?.id,
          ot_hrs: otHrs,
          ot_fte: rec.otFTE,
          xu_fte: rec.xr,
          hire_count: rec.starts,
          train_wk: timing.trainWk,
          nest_wk: timing.nestWk,
          donors,
        },
      });
      setState((s) => {
        const mapped = { ...pkg, ticked: true, done: false };
        const idx = s.packages.findIndex((p) => p.id === pkg.id);
        let packages;
        if (idx >= 0) {
          packages = s.packages.map((p, i) => (i === idx ? mapped : p));
        } else {
          packages = [
            ...s.packages.filter((p) => !(p.cap_id === capId && !p.done)),
            mapped,
          ];
        }
        return { ...s, doneRec: true, packages };
      });
      setPlanDecisions((d) => ({
        ...d,
        [capId]: { ...(d[capId] || {}), rec: 'acc' },
      }));
    } catch (e) {
      emitError('recommend.accept.failed', e, { cap_id: capId });
      console.error(e);
      setState((s) => ({
        ...s,
        execMsg: e.message || 'Failed to queue package',
      }));
    }
  }, [data, planDecisions, otWeeksByCap, setState]);

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
    let ok = false;
    if (ids.length) {
      try {
        const res = await api.executeQueue(ids);
        message = res?.message || `Posted ${ids.length} package(s) · staffing applied`;
        ok = true;
        emit('queue.executed', {
          metadata: {
            package_ids: ids,
            count: ids.length,
            success: true,
            applied: res?.applied,
          },
        });
      } catch (e) {
        emitError('queue.execute.failed', e, { package_ids: ids });
        console.error(e);
        message = e.message || 'Execute failed';
      }
    }
    setState((s) => ({
      ...s,
      execDone: ok,
      execMsg: message,
      packages: ok
        ? s.packages.map((p) =>
            ids.includes(p.id) ? { ...p, done: true, status: 'posted', ticked: false } : p,
          )
        : s.packages,
    }));
    if (ok) await refreshPortfolio();
    return { message };
  }, [setState, refreshPortfolio]);

  const handleExecutePlan = useCallback(async () => {
    const capId = stateRef.current.activePlan;
    if (!stateRef.current.doneRec) {
      return { message: 'No approved package yet — accept a recommendation first.' };
    }
    let match = stateRef.current.packages.find((p) => p.cap_id === capId && !p.done);
    if (!match?.id) {
      // Accept may still be in flight or package missing — try upsert from live rec then execute.
      const plan = data.find((p) => p.capId === capId);
      if (!plan) {
        return { message: `No plan loaded for ${capId}` };
      }
      try {
        const ovr = planDecisions[capId]?.recOvr || {};
        const xutil = computeXutil(data);
        const rec = planRec(plan, {
          otPct: ovr.otPct ?? 5,
          xr: ovr.xr,
          starts: ovr.starts,
          gotBy: xutil.gotBy,
        });
        const donors = scaleDonorsToXu(xutil.donorsBy?.[capId] || [], rec.xr);
        const timing = hireTiming(plan, ovr);
        const n = fwdCount(plan);
        const weeks = otWeeksByCap[capId];
        const weekly = weeks?.length === n ? weeks : Array(n).fill(defaultOtWeekly(plan, rec.otPct));
        const otHrs = Number(weekly[0]) || rec.otHrs;
        match = await api.upsertPackage({
          cap_id: capId,
          ot_hrs: otHrs,
          ot_fte: rec.otFTE,
          xu_fte: rec.xr,
          hire_count: rec.starts,
          train_wk: timing.trainWk,
          nest_wk: timing.nestWk,
          donors,
        });
      } catch (e) {
        console.error(e);
        return { message: e.message || `No queued package for ${capId}` };
      }
    }
    let message = '';
    let ok = false;
    try {
      const res = await api.executeQueue([match.id]);
      message = res?.message || `Posted 1 package · staffing applied`;
      ok = true;
    } catch (e) {
      console.error(e);
      message = e.message || 'Execute failed';
    }
    setState((s) => ({
      ...s,
      execDone: ok,
      execMsg: message,
      packages: ok
        ? s.packages.map((p) =>
            p.id === match.id || p.cap_id === capId
              ? { ...p, ...match, done: true, status: 'posted', ticked: false }
              : p,
          )
        : s.packages,
    }));
    if (ok) await refreshPortfolio();
    return { message };
  }, [data, planDecisions, otWeeksByCap, setState, refreshPortfolio]);

  domHandlersRef.current = {
    setFilter: (prog) => {
      emit('filter.changed', { metadata: { program: prog } });
      setState((s) => ({ ...s, filter: prog, view: 'port', focusCap: null }));
    },
    openPlan: (capId) => {
      emit('plan.opened', { metadata: { cap_id: capId, source: 'user' } });
      const p = data.find((r) => r.capId === capId);
      const rosterOk =
        p?.cls?.status === 'mapped' || p?.cls?.status === 'uploaded';
      setState((s) => ({
        ...s,
        view: 'plan',
        activePlan: capId,
        focusCap: capId,
        activeTab: 'ov',
        shownTabs: ['ov'],
        editorWeeks: p ? buildEditorWeeks(p) : s.editorWeeks,
        attrWeeks: p ? buildAttrWeeks(p) : s.attrWeeks,
        editorReady: true,
        chartOU: { capId, ready: true, mark: 8, lbl: '' },
        chartShr: { capId, ready: true },
        doneRec: false,
        doneShr: false,
        shrDirty: false,
        doneAttr: false,
        attrDirty: false,
        doneRoster: rosterOk,
      }));
      if (p) {
        setOtWeeksByCap((prev) => ({
          ...prev,
          [capId]: prev[capId]?.length === fwdCount(p) ? prev[capId] : Array(fwdCount(p)).fill(defaultOtWeekly(p)),
        }));
      }
    },
    openTab: (tab) => {
      emit('tab.changed', { metadata: { cap_id: stateRef.current.activePlan, active_tab: tab } });
      setState((s) => ({
        ...s,
        view: 'plan',
        activeTab: tab,
        shownTabs: s.shownTabs.includes(tab) ? s.shownTabs : [...s.shownTabs, tab],
        editorReady: tab === 'shr' || tab === 'ov' ? true : s.editorReady,
      }));
    },
    view: (v) => {
      emit('view.changed', { metadata: { from_view: stateRef.current.view, to_view: v, cap_id: stateRef.current.activePlan } });
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
              <ConciergeNudgePanel
                nudges={concierge.nudges}
                loading={concierge.loading}
                onShowMe={concierge.acceptAndGuide}
                onDismiss={concierge.dismissNudge}
                onSnooze={concierge.snoozeNudge}
              />
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
                  <PlanSearchBar
                    plans={data}
                    program={state.filter}
                    value={searchQuery}
                    showing={showing}
                    total={data.length}
                    onChange={(v) => {
                      engine.markHumanActive();
                      setSearchQuery(v);
                    }}
                    onOpenPlan={(capId) => {
                      engine.markHumanActive();
                      setSearchQuery('');
                      domHandlersRef.current.openPlan?.(capId);
                    }}
                    onSearchSubmit={() => {
                      if (state.view !== 'port') {
                        setState((s) => ({ ...s, view: 'port' }));
                      }
                    }}
                  />
                </div>

                {state.view === 'port' && (
                  <div className="pane on" data-view="port" ref={paneRef}>
                    <PortfolioLanding
                      plans={filteredData}
                      programs={programs}
                      filter={state.filter}
                      search={searchQuery}
                      expandAll={Boolean(searchQuery.trim())}
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
                      <div className="tab-list">
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
                      </div>
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
                        onResetShrinkage={handleResetShrinkage}
                        onApplyShrinkageValue={handleApplyShrinkageValue}
                        onApplyShrinkagePct={handleApplyShrinkagePct}
                        onSubmitAttrition={handleSubmitAttrition}
                        onResetAttrition={handleResetAttrition}
                        onApplyAttritionValue={handleApplyAttritionValue}
                        onApplyAttritionPct={handleApplyAttritionPct}
                        onAttritionChange={setAttrWeek}
                        onSubmitForecast={handleSubmitForecast}
                        onSaveHeadcount={handleSaveHeadcount}
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
                      <b id="selCount">{filteredPackages.filter((p) => p.ticked).length} of {filteredPackages.length}</b> selected to execute ·
                      <span className="mini" data-act="sel-all" onClick={() => handleSelectAllPackages()}>Select all</span>
                      <span className="mini" data-act="sel-none" onClick={() => handleClearPackages()}>Clear</span>
                    </div>
                    <div id="pkgList">
                      {filteredPackages.map((p) => (
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
                  <span className="vhint">{voice.recording ? 'Listening… click to send' : 'Mic, type, or attach CSV'}</span>
                </div>
                {chatFile ? (
                  <div className="chat-file-chip">
                    <span title={chatFile.name}>📎 {chatFile.name}</span>
                    <button type="button" aria-label="Remove file" onClick={() => setChatFile(null)}>
                      ×
                    </button>
                  </div>
                ) : null}
                <form
                  className="chat-in"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const msg = chatInput.trim();
                    if ((!msg && !chatFile) || voice.voiceBusy) return;
                    const file = chatFile;
                    setChatInput('');
                    setChatFile(null);
                    await voice.sendMessage(msg, 'text', { file });
                  }}
                >
                  <input
                    ref={chatFileRef}
                    type="file"
                    accept=".csv,text/csv"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      e.target.value = '';
                      if (f) setChatFile(f);
                    }}
                  />
                  <button
                    type="button"
                    className="chat-attach"
                    title="Attach roster CSV"
                    aria-label="Attach roster CSV"
                    disabled={voice.voiceBusy}
                    onClick={() => chatFileRef.current?.click()}
                  >
                    📎
                  </button>
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask Vera — or attach sample_roster.csv…"
                    disabled={voice.voiceBusy}
                    aria-label="Message Vera"
                  />
                  <button
                    type="submit"
                    disabled={voice.voiceBusy || (!chatInput.trim() && !chatFile)}
                    aria-label="Send"
                  >
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
