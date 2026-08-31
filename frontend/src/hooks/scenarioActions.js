import { api } from '../api/client';
import { directFromSelector, fireAgentTarget } from '../lib/agentTarget';
import { hm } from '../utils/format';
import { apiFieldToDraftKey, isCreatePlanSelectKey } from '../utils/createPlanFields';

export const HUE = { u: '#1C1B18', v: '#F5B01A', a: '#F5B01A', d: '#C4463C', s: '#3B6FB5' };

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

  const waitPaint = () =>
    new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

  const agentTap = async (selector, onFire, logMsg) => {
    const handlers = domHandlersRef?.current;
    if (useCursor()) {
      cursor?.show?.();
      const ok = await cursor.tap(selector, onFire);
      if (!ok && onFire) onFire();
    } else if (onFire) {
      onFire();
      await wait(200);
    } else if (handlers) {
      directFromSelector(selector, handlers);
      await wait(200);
    }
    if (logMsg) await push('a', 'Agent · action', logMsg);
  };

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
    showCursor: () => {
      if (useCursor()) cursor?.show?.();
    },
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
      if (useCursor()) cursor?.show?.();
      await tap(sel, `filtered · program = ${prog}`);
    },
    view: async (v) => {
      if (v === 'queue') {
        if (useCursor()) cursor?.show?.();
        await tap('[data-view="queue"]', 'opened action queue');
      } else {
        domHandlersRef?.current?.view?.(v);
        await wait(250);
      }
    },
    openPlan: async (capId) => {
      domHandlersRef?.current?.openPlan?.(capId);
      await wait(80);
      if (useCursor()) {
        cursor?.show?.();
        const sel = `.land-row[data-cap="${capId}"] .open-mini, .land-row[data-cap="${capId}"], .row[data-cap="${capId}"]`;
        await tap(sel, `opened ${capId}`);
      }
    },
    markTabs: async (tabs) => {
      setState((s) => ({ ...s, shownTabs: tabs, activeTab: tabs[0] || 'ov' }));
      await wait(350);
    },
    openTab: async (tab) => {
      domHandlersRef?.current?.openTab?.(tab);
      await wait(80);
      if (useCursor()) {
        cursor?.show?.();
        await tap(`[data-tab="${tab}"]`, `opened tab · ${tab}`);
      }
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
          return { ...s, editorWeeks: ew, editSrc: 'agent', doneShr: false, shrDirty: true };
        });
        await wait(useCursor() ? 230 : 40);
      }
    },
    mapRoster: async (capId, body = {}) => {
      const id = (typeof capId === 'string' ? capId : null) || stateRef.current.activePlan;
      const payload = typeof capId === 'object' && capId ? capId : body || {};
      const apply = async () => {
        if (domHandlersRef?.current?.mapRoster) {
          await domHandlersRef.current.mapRoster(id, payload);
        } else {
          await api.mapRoster(id, payload);
        }
      };
      if (!useCursor()) {
        try {
          await apply();
        } catch {
          /* ignore */
        }
        const n = payload.employees?.length;
        await push(
          'a',
          'Agent · background',
          n
            ? `mapped roster · ${id} · ${n} employees · ${Number(payload.train_hc || 0).toFixed(2)} FTE`
            : `mapped roster · ${id}`,
        );
        return;
      }
      domHandlersRef?.current?.openTab?.('nh');
      await wait(300);
      cursor?.show?.();
      await tap('[data-act="go-roster"]', 'roster mapped · projected FTE corrected');
      try {
        await apply();
      } catch {
        /* ignore */
      }
    },
    submitShrinkage: async (capId) => {
      const id = capId || stateRef.current.activePlan;
      if (!useCursor()) {
        try {
          const editorWeeks = stateRef.current.editorWeeks;
          await api.submitShrinkage(
            id,
            editorWeeks.map((w) => ({ week_idx: w.weekIdx, shrink_plan: w.cur })),
          );
        } catch {
          /* ignore */
        }
        domHandlersRef?.current?.submitShrinkage?.(id);
        await push('a', 'Agent · background', `submitted shrinkage · ${id}`);
        return;
      }
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
    tickPackage: async (capId) => {
      if (useCursor()) cursor?.show?.();
      await tap(`.pkg[data-cap="${capId}"]`, `ticked ${capId}`);
    },
    selectAllPackages: async () => {
      if (useCursor()) cursor?.show?.();
      await tap('[data-act="sel-all"]', 'all packages selected');
    },
    executeSelected: async () => {
      if (useCursor()) cursor?.show?.();
      await tap('[data-act="exec"]', 'executed · packages posted to CAP-ABILITY');
    },
    openCreatePlanWizard: async () => {
      if (useCursor()) {
        cursor?.show?.();
        await tap('[data-act="open-create-plan"]', 'opened new CAP plan form');
      } else {
        domHandlersRef?.current?.openCreatePlan?.(true);
      }
    },
    setCreatePlanField: async (field, value) => {
      const key = apiFieldToDraftKey(field);
      const str = String(value ?? '').trim();
      const handlers = domHandlersRef?.current;
      const isSelect = isCreatePlanSelectKey(key);

      if (!useCursor()) {
        handlers?.setCreatePlanField?.(field, str, { finalize: true });
        return;
      }

      cursor?.show?.();

      if (isSelect) {
        await agentTap(`[data-create-select-trigger="${key}"]`, () => {
          handlers?.openCreatePlanSelect?.(key);
        });
        await waitPaint();
        await wait(120);
        const optSel = `[data-create-option="${key}"][data-option-value="${CSS.escape(str)}"]`;
        await agentTap(optSel, () => {
          handlers?.setCreatePlanField?.(field, str, { finalize: true });
          handlers?.closeCreatePlanSelect?.();
        }, `filled · ${key}`);
        return;
      }

      await agentTap(`[data-create-input="${key}"]`, () => {}, null);
      await wait(100);
      for (let i = 1; i <= str.length; i++) {
        handlers?.setCreatePlanField?.(field, str.slice(0, i), { finalize: false });
        await wait(42);
      }
      handlers?.setCreatePlanField?.(field, str, { finalize: true });
      await push('a', 'Agent · action', `filled · ${key}`);
    },
    submitCreatePlanWizard: async () => {
      if (useCursor()) {
        cursor?.show?.();
        const btn = document.querySelector('[data-act="submit-create-plan"]');
        if (btn) {
          await tap('[data-act="submit-create-plan"]', 'created new CAP plan');
        } else {
          await tap('[data-create-field="scenario"] input, [data-create-field="scenario"] select', 'creating plan');
        }
      }
      await domHandlersRef?.current?.submitCreatePlan?.();
    },
    fillLedger: async () => {
      if (useCursor()) {
        domHandlersRef?.current?.view?.('time');
      }
      setState((s) => ({ ...s, ledgerAnimated: true }));
      await wait(useCursor() ? 2000 : 200);
    },
    citeMemories: async () => {
      setState((s) => ({ ...s, memoriesCited: true }));
      await wait(900);
    },
  };
}

export const CREATE_PLAN_ACTION_TYPES = new Set([
  'open_create_plan',
  'set_create_plan_field',
  'submit_create_plan',
]);

export function partitionAgentActions(actionList) {
  const createPlan = [];
  const other = [];
  for (const act of actionList || []) {
    if (CREATE_PLAN_ACTION_TYPES.has(act?.type)) createPlan.push(act);
    else other.push(act);
  }
  return { createPlan, other };
}

/**
 * Apply structured intents from Claude.
 * Planner always keeps the mouse. If they are actively clicking/editing, the
 * agent hides its cursor and applies actions silently in the background.
 */
export async function applyAgentActions(actions, actionList, setState, stateRef, { isHumanActive } = {}) {
  if (!actionList?.length) return;

  const humanBusy = typeof isHumanActive === 'function' ? isHumanActive() : false;

  setState((s) => ({
    ...s,
    agentStatus: humanBusy ? 'Working in background' : 'Working',
  }));

  if (humanBusy) {
    actions.hideCursor?.();
  } else {
    actions.showCursor?.();
  }

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
          if (humanBusy) {
            await actions.buildEditor(capId);
            await actions.voiceSet(p.weeks);
            if (p.submit) await actions.submitShrinkage(capId);
          } else {
            if (p.cap_id) await actions.openPlan(p.cap_id);
            await actions.openTab('shr');
            await actions.buildEditor(capId);
            await actions.voiceSet(p.weeks);
            if (p.submit) await actions.submitShrinkage(capId);
          }
        }
        break;
      case 'map_roster':
        if (p.cap_id) {
          await actions.mapRoster(p.cap_id, {
            ...(p.train_hc != null ? { train_hc: p.train_hc } : {}),
          });
        }
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
        break;
      case 'mark_tabs':
        if (p.tabs?.length) await actions.markTabs(p.tabs);
        break;
      case 'view':
        if (p.view) await actions.view(p.view);
        break;
      case 'open_create_plan':
        await actions.openCreatePlanWizard();
        break;
      case 'set_create_plan_field':
        if (p.field != null && p.value != null) {
          await actions.setCreatePlanField(p.field, p.value);
        }
        break;
      case 'submit_create_plan':
        await actions.submitCreatePlanWizard();
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
