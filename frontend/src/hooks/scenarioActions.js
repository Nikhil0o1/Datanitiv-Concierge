import { api } from '../api/client';
import { directFromSelector, fireAgentTarget } from '../lib/agentTarget';
import { hm, reqOf } from '../utils/format';

export const HUE = { u: '#1C1B18', a: '#F5B01A', d: '#C4463C', s: '#3B6FB5' };

export function createScenarioActions({
  setState,
  stateRef,
  wait,
  push,
  say,
  hear,
  cursor,
  domHandlersRef,
  shouldUseCursor = () => true,
}) {
  const useCursor = () => Boolean(cursor && shouldUseCursor());

  const tap = async (selector, logMsg) => {
    const handlers = domHandlersRef?.current;
    if (useCursor()) {
      const ok = await cursor.tap(selector, (el) => fireAgentTarget(el, handlers));
      if (!ok && handlers) directFromSelector(selector, handlers);
    } else if (handlers) {
      directFromSelector(selector, handlers);
      await wait(200);
    }
    if (logMsg) await push('a', 'Agent · action', logMsg);
  };

  return {
    wait,
    tap,
    ast: async (t) => {
      setState((s) => ({ ...s, agentStatus: t }));
      return wait(0);
    },
    say,
    hear,
    push,
    showCursor: () => cursor?.show?.(),
    hideCursor: () => cursor?.hide?.(),
    addTime: async (min, why) => {
      setState((s) => ({ ...s, savedMin: s.savedMin + min, savedBump: true }));
      setTimeout(() => setState((s) => ({ ...s, savedBump: false })), 320);
      if (why) await push('s', 'Time back', `+${hm(min)} · ${why}`);
    },
    reveal: async (kind) => {
      setState((s) => ({ ...s, revealed: { ...s.revealed, [kind]: true } }));
      await wait(kind === 'dec' || kind === 'auto' ? 800 : 400);
    },
    setCount: async (key, val) => {
      setState((s) => ({ ...s, counts: { ...s.counts, [key]: val } }));
      await wait(150);
    },
    showFold: () => setState((s) => ({ ...s, foldVisible: true })),
    setFilter: async (prog) => {
      const sel =
        prog === 'all' ? '[data-filter="all"]' : `[data-filter="${String(prog).replace(/"/g, '\\"')}"]`;
      cursor?.show?.();
      await tap(sel, `filtered · program = ${prog}`);
    },
    view: async (v) => {
      if (v === 'queue') {
        cursor?.show?.();
        await tap('[data-view="queue"]', 'opened action queue');
      } else {
        domHandlersRef?.current?.view?.(v);
        await wait(250);
      }
    },
    openPlan: async (capId) => {
      cursor?.show?.();
      await tap(`.row[data-cap="${capId}"]`, `opened ${capId}`);
    },
    markTabs: async (tabs) => {
      setState((s) => ({ ...s, shownTabs: tabs, activeTab: tabs[0] || 'ov' }));
      await wait(350);
    },
    openTab: async (tab) => {
      cursor?.show?.();
      await tap(`[data-tab="${tab}"]`, `opened tab · ${tab}`);
    },
    drawOUChart: async (capId, opt) => {
      setState((s) => ({ ...s, chartOU: { capId, ...opt, ready: true } }));
      await wait(800);
    },
    drawShrChart: async (capId) => {
      setState((s) => ({ ...s, chartShr: { capId, ready: true } }));
      await wait(600);
    },
    buildEditor: async (capId) => {
      setState((s) => ({ ...s, editorCap: capId, editorReady: true }));
      await wait(300);
    },
    voiceSet: async (vals) => {
      for (const [k, v] of vals) {
        setState((s) => {
          const ew = [...s.editorWeeks];
          if (ew[k]) ew[k] = { ...ew[k], cur: v };
          return { ...s, editorWeeks: ew, editSrc: 'agent' };
        });
        await wait(230);
      }
    },
    mapRoster: async (capId) => {
      const id = capId || stateRef.current.activePlan;
      domHandlersRef?.current?.openTab?.('nh');
      await wait(300);
      cursor?.show?.();
      await tap('[data-act="go-roster"]', '2.42 FTE mapped · projected FTE corrected');
      try {
        await api.mapRoster(id, {});
      } catch {
        /* UI updates via handler */
      }
    },
    submitShrinkage: async (capId) => {
      const id = capId || stateRef.current.activePlan;
      domHandlersRef?.current?.openTab?.('shr');
      await wait(300);
      cursor?.show?.();
      await tap('[data-act="go-shrink"]', 'submitted to plan · 5 weeks changed');
      try {
        const editorWeeks = stateRef.current.editorWeeks;
        await api.submitShrinkage(
          id,
          editorWeeks.map((w) => ({ week_idx: w.weekIdx, shrink_plan: w.cur })),
        );
      } catch {
        /* local net shown */
      }
    },
    human: async (on) => {
      setState((s) => ({ ...s, humanMode: on, agentStatus: on ? 'You have control' : 'Standing by' }));
      if (on) cursor?.hide?.();
      else cursor?.show?.();
      await wait(300);
    },
    tickPackage: async (capId) => {
      cursor?.show?.();
      await tap(`.pkg[data-cap="${capId}"]`, `ticked ${capId}`);
    },
    selectAllPackages: async () => {
      cursor?.show?.();
      await tap('[data-act="sel-all"]', 'all packages selected');
    },
    executeSelected: async () => {
      cursor?.show?.();
      await tap('[data-act="exec"]', 'executed · packages posted to CAP-ABILITY');
    },
    fillLedger: async () => {
      domHandlersRef?.current?.view?.('time');
      setState((s) => ({ ...s, ledgerAnimated: true }));
      await wait(2000);
    },
    citeMemories: async () => {
      setState((s) => ({ ...s, memoriesCited: true }));
      await wait(900);
    },
  };
}

/** Apply structured intents from Claude — agent drives the live UI with cursor. */
export async function applyAgentActions(actions, actionList, setState, stateRef) {
  if (!actionList?.length) return;
  setState((s) => ({ ...s, humanMode: false, agentStatus: 'Working' }));
  actions.showCursor?.();

  for (const act of actionList || []) {
    const type = act.type;
    const p = act.params || {};
    switch (type) {
      case 'set_filter':
        await actions.setFilter(p.program || 'all');
        break;
      case 'open_plan':
        if (p.cap_id) await actions.openPlan(p.cap_id);
        break;
      case 'set_shrinkage_weeks':
        if (p.weeks) {
          const capId = p.cap_id || stateRef?.current?.activePlan;
          if (p.cap_id) await actions.openPlan(p.cap_id);
          await actions.openTab('shr');
          await actions.buildEditor(capId);
          await actions.voiceSet(p.weeks);
          if (p.submit) await actions.submitShrinkage(capId);
        }
        break;
      case 'map_roster':
        if (p.cap_id) await actions.mapRoster(p.cap_id);
        break;
      case 'execute_queue':
        await actions.view('queue');
        await actions.selectAllPackages();
        await actions.executeSelected();
        break;
      case 'open_tab':
        if (p.tab) await actions.openTab(p.tab);
        break;
      case 'human_mode':
        await actions.human(!!p.on);
        break;
      case 'mark_tabs':
        if (p.tabs?.length) await actions.markTabs(p.tabs);
        break;
      case 'view':
        if (p.view) await actions.view(p.view);
        break;
      default:
        break;
    }
  }
}

export async function dispatchScenarioCommand(actions, cmd, args = []) {
  const fn = actions[cmd];
  if (typeof fn !== 'function') return;
  await fn(...args);
}
