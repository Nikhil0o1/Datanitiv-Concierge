import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { applyAgentActions } from './scenarioActions';

const DEFAULT_POLL_MS = 20000;
const INITIAL_DELAY_MS = 8000;

/**
 * Background Concierge — polls for nudges; cursor guidance runs only when user clicks Show me.
 * Separate from Vera (user-initiated agent).
 */
export function useConcierge({ actionsRef, stateRef, setState, isHumanActive, pushRef, enabled = true }) {
  const [nudges, setNudges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pollMs, setPollMs] = useState(DEFAULT_POLL_MS);
  const seenRef = useRef(new Set());
  const activeRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    api
      .conciergeConfig()
      .then((cfg) => {
        if (cfg?.poll_interval_seconds) setPollMs(Math.max(15, cfg.poll_interval_seconds) * 1000);
      })
      .catch(() => {});
  }, [enabled]);

  const runGuide = useCallback(
    async (nudge) => {
      if (!nudge) return;
      try {
        await api.conciergeNudgeAccept(nudge.id);
        setNudges((prev) => prev.filter((n) => n.id !== nudge.id));

        const actions = actionsRef?.current;
        if (actions && nudge.ui_actions?.length) {
          setState((s) => ({ ...s, agentStatus: 'Concierge guiding', conciergeActive: true }));
          await applyAgentActions(actions, nudge.ui_actions, setState, stateRef, { isHumanActive });
          setState((s) => ({ ...s, agentStatus: 'Standing by', conciergeActive: false }));
        }

        const reliability = Math.round((nudge.reliability_score || 0) * 100);
        pushRef?.current?.(
          's',
          'Concierge',
          `${nudge.title}\nRecommend: ${nudge.recommendation || nudge.summary}\nReliability: ${reliability}%${nudge.explanation ? `\n${nudge.explanation.split('\n\n')[0]}` : ''}`,
        );
      } catch (err) {
        pushRef?.current?.('d', 'Concierge', err?.message || 'Could not run guidance');
      }
    },
    [actionsRef, isHumanActive, pushRef, setState, stateRef],
  );

  const refresh = useCallback(async () => {
    if (!enabled || activeRef.current) return;
    activeRef.current = true;
    setLoading(true);
    try {
      const data = await api.conciergePendingNudges();
      const rows = data?.nudges || [];
      setNudges(rows);
      setError(null);

      for (const nudge of rows) {
        if (seenRef.current.has(nudge.id)) continue;
        seenRef.current.add(nudge.id);
        await api.conciergeNudgeShown(nudge.id);
      }
    } catch (err) {
      setError(err?.message || 'Concierge unavailable');
    } finally {
      setLoading(false);
      activeRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const t0 = setTimeout(refresh, INITIAL_DELAY_MS);
    const t1 = setInterval(refresh, pollMs);
    return () => {
      clearTimeout(t0);
      clearInterval(t1);
    };
  }, [enabled, pollMs, refresh]);

  const dismissNudge = useCallback(async (nudgeId) => {
    await api.conciergeNudgeDismiss(nudgeId);
    setNudges((prev) => prev.filter((n) => n.id !== nudgeId));
  }, []);

  const snoozeNudge = useCallback(async (nudgeId, minutes) => {
    await api.conciergeNudgeSnooze(nudgeId, minutes);
    setNudges((prev) => prev.filter((n) => n.id !== nudgeId));
  }, []);

  return {
    nudges,
    loading,
    error,
    refresh,
    dismissNudge,
    snoozeNudge,
    acceptAndGuide: runGuide,
  };
}
