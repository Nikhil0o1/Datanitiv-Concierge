import { useCallback, useRef, useState } from 'react';
import { buildScenarioSteps, SCENARIOS } from '../data/scenarios';
import { createScenarioActions, HUE } from './scenarioActions';
import { useAgentCursor } from './useAgentCursor';

export function useScenarioEngine(state, setState, { workspaceRef, domHandlersRef } = {}) {
  const genRef = useRef(0);
  const playingRef = useRef(false);
  const stepIdxRef = useRef(0);
  const busyRef = useRef(false);
  const scenarioIdxRef = useRef(0);
  const speedRef = useRef(1);
  const snapRef = useRef(false);
  const stateRef = useRef(state);
  const actionsRef = useRef({});
  const pushRef = useRef(null);

  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [speed, setSpeed] = useState(1);

  stepIdxRef.current = stepIdx;
  busyRef.current = busy;
  scenarioIdxRef.current = scenarioIdx;
  speedRef.current = speed;
  snapRef.current = state.snap;
  stateRef.current = state;

  const wait = useCallback(
    (ms) =>
      new Promise((r) => {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        setTimeout(r, reduce || snapRef.current ? 0 : ms / speedRef.current);
      }),
    [],
  );

  const stale = (g) => g !== genRef.current;

  const push = useCallback(
    async (cls, tag, text, stream = false) => {
      setState((s) => ({
        ...s,
        messages: [...s.messages, { cls, tag, hue: HUE[cls], text: stream ? '' : text }],
      }));
      if (!stream) return;
      const words = text.split(' ');
      for (let n = 1; n <= words.length; n++) {
        await wait(37);
        const partial = words.slice(0, n).join(' ');
        setState((s) => {
          const msgs = [...s.messages];
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: partial };
          return { ...s, messages: msgs };
        });
      }
    },
    [setState, wait],
  );
  pushRef.current = push;

  const say = useCallback(
    async (text) => {
      setState((s) => ({ ...s, agentTalk: true, agentStatus: 'Speaking', bubble: '' }));
      const words = text.split(' ');
      for (let i = 1; i <= words.length; i++) {
        await wait(94);
        setState((s) => ({ ...s, bubble: words.slice(0, i).join(' ') }));
      }
      setState((s) => ({ ...s, agentTalk: false, agentStatus: 'Standing by', bubble: '' }));
      await push('a', 'Vera', text);
      await wait(220);
    },
    [push, setState, wait],
  );

  const hear = useCallback(
    async (ms) => {
      setState((s) => ({ ...s, agentHear: true, agentStatus: 'Listening', bubble: 'Listening…' }));
      await wait(ms);
      setState((s) => ({ ...s, agentHear: false, agentStatus: 'Standing by', bubble: '' }));
    },
    [setState, wait],
  );

  const cursor = useAgentCursor(workspaceRef, { wait, getSpeed: () => speedRef.current });

  actionsRef.current = createScenarioActions({
    setState,
    stateRef,
    wait,
    push,
    say,
    hear,
    cursor,
    domHandlersRef,
    shouldUseCursor: () => !stateRef.current.humanMode,
  });

  const reset = useCallback(() => {
    genRef.current += 1;
    playingRef.current = false;
    stepIdxRef.current = 0;
    busyRef.current = false;
    setPlaying(false);
    setBusy(false);
    setStepIdx(0);
    setState((s) => ({
      ...s,
      snap: false,
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
      humanMode: false,
      cursorOn: false,
      foldVisible: false,
      revealed: {},
      counts: { c1: '', c2: '' },
      chartOU: null,
      chartShr: null,
      editorReady: false,
      doneShr: false,
      doneRoster: false,
      doneRec: false,
      rosterMapped: false,
      execDone: false,
      ledgerAnimated: false,
      memoriesCited: false,
      packages: s.packages.map((p) => ({ ...p, ticked: false, status: 'queued', done: false })),
    }));
  }, [setState]);

  const runStep = useCallback(async () => {
    const key = SCENARIOS[scenarioIdxRef.current]?.key;
    const steps = buildScenarioSteps(key, actionsRef.current);
    const idx = stepIdxRef.current;
    if (idx >= steps.length || busyRef.current) return false;

    const mine = genRef.current;
    busyRef.current = true;
    setBusy(true);
    try {
      await steps[idx].f();
    } catch (e) {
      await push('d', 'error', String(e?.message || e));
    }
    if (stale(mine)) {
      busyRef.current = false;
      setBusy(false);
      return false;
    }
    stepIdxRef.current = idx + 1;
    setStepIdx(idx + 1);
    busyRef.current = false;
    setBusy(false);
    return true;
  }, [push]);

  const loopRef = useRef(null);
  loopRef.current = async () => {
    if (!playingRef.current) return;
    const ok = await runStep();
    if (!ok || !playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      return;
    }
    await wait(185);
    loopRef.current();
  };

  const toggle = useCallback(async () => {
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      setState((s) => ({ ...s, snap: true }));
      return;
    }
    setState((s) => ({ ...s, snap: false }));
    const key = SCENARIOS[scenarioIdxRef.current]?.key;
    const steps = buildScenarioSteps(key, actionsRef.current);
    if (stepIdxRef.current >= steps.length) reset();
    playingRef.current = true;
    setPlaying(true);
    loopRef.current();
  }, [reset, setState]);

  const pickScenario = useCallback(
    (i) => {
      scenarioIdxRef.current = i;
      setScenarioIdx(i);
      reset();
    },
    [reset],
  );

  const step = useCallback(async () => {
    playingRef.current = false;
    setPlaying(false);
    setState((s) => ({ ...s, snap: false }));
    await runStep();
  }, [runStep, setState]);

  const setSpeedAndRef = useCallback((sp) => {
    speedRef.current = sp;
    setSpeed(sp);
  }, []);

  const setStepFromStream = useCallback((idx, complete = false) => {
    const count = buildScenarioSteps(SCENARIOS[scenarioIdxRef.current]?.key, actionsRef.current).length;
    stepIdxRef.current = complete ? count : idx;
    setStepIdx(complete ? count : idx);
    setPlaying(!complete);
  }, []);

  return {
    SCENARIOS,
    scenarioIdx,
    stepIdx,
    playing,
    busy,
    speed,
    setSpeed: setSpeedAndRef,
    reset,
    toggle,
    step,
    pickScenario,
    setStepFromStream,
    actionsRef,
    pushRef,
    cursor,
    stepCount: buildScenarioSteps(SCENARIOS[scenarioIdx]?.key, actionsRef.current).length,
  };
}
