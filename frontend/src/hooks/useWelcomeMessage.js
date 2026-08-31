import { useEffect, useRef } from 'react';
import { WELCOME_SESSION_KEY, buildWelcomeMessage } from '../utils/welcomeMessage';

const OPEN_DELAY_MS = 650;

/**
 * One brief Vera welcome per browser session after portfolio data loads.
 * Template-based (no LLM) — uses cycle label + triage counts + ElevenLabs TTS.
 */
export function useWelcomeMessage({
  enabled,
  cycleLabel,
  triage,
  pushRef,
  setState,
  stateRef,
  speakText,
  voiceBusy = false,
  streamMode = false,
  scenarioPlaying = false,
}) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled || startedRef.current) return;

    try {
      if (sessionStorage.getItem(WELCOME_SESSION_KEY)) return;
    } catch {
      /* private browsing */
    }

    if (streamMode || scenarioPlaying || voiceBusy) return;
    if (stateRef.current?.messages?.length) return;

    startedRef.current = true;

    const text = buildWelcomeMessage({
      cycleLabel,
      dec: triage?.dec || [],
      auto: triage?.auto || [],
      quiet: triage?.quiet || [],
      counts: triage?.counts || {},
    });

    const timer = setTimeout(async () => {
      if (stateRef.current?.messages?.length) return;
      if (streamMode || scenarioPlaying || voiceBusy) return;
      if (stateRef.current?.agentTalk || stateRef.current?.agentHear) return;

      try {
        if (speakText) {
          await speakText(text, { deferBubbleUntilAudio: true });
        } else {
          setState((s) => ({ ...s, agentStatus: 'Ready' }));
          const push = pushRef.current;
          if (push) await push('v', 'Vera', text, true);
          setState((s) => ({ ...s, agentStatus: 'Standing by' }));
        }
        sessionStorage.setItem(WELCOME_SESSION_KEY, '1');
      } catch {
        /* still show text if TTS fails */
        const push = pushRef.current;
        if (push) await push('v', 'Vera', text, true);
        setState((s) => ({ ...s, agentStatus: 'Standing by' }));
        try {
          sessionStorage.setItem(WELCOME_SESSION_KEY, '1');
        } catch {
          /* ignore */
        }
      }
    }, OPEN_DELAY_MS);

    return () => clearTimeout(timer);
  }, [
    enabled,
    cycleLabel,
    triage,
    pushRef,
    setState,
    stateRef,
    speakText,
    voiceBusy,
    streamMode,
    scenarioPlaying,
  ]);
}
