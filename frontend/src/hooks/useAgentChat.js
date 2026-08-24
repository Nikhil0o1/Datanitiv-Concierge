/** Unified agent chat — text or voice → Claude → cursor actions + TTS */

import { useCallback, useRef, useState } from 'react';
import { api } from '../api/client';
import { emit, emitError } from '../lib/telemetry';
import { applyAgentActions } from './scenarioActions';

/** Map timeline messages to Claude conversation history (natural replies only). */
function buildHistory(messages) {
  if (!messages?.length) return [];
  return messages
    .filter((m) => {
      if (m.cls === 'u') return true;
      if (m.cls === 'a' && m.tag?.includes('Vera')) return true;
      return false;
    })
    .slice(-14)
    .map((m) => ({
      role: m.cls === 'u' ? 'user' : 'assistant',
      content: (m.text || '').trim(),
    }))
    .filter((m) => m.content);
}

export function useAgentChat({ actionsRef, stateRef, setState, pushRef, isHumanActive }) {
  const [busy, setBusy] = useState(false);
  const audioRef = useRef(null);

  const speakReply = useCallback(
    async (reply, actions) => {
      const push = pushRef.current;
      try {
        const audioBlob = await api.tts(reply);
        const url = URL.createObjectURL(audioBlob);
        if (audioRef.current) {
          audioRef.current.pause();
          URL.revokeObjectURL(audioRef.current.src);
        }
        const audio = new Audio(url);
        audioRef.current = audio;
        setState((s) => ({ ...s, agentTalk: true, agentStatus: 'Speaking', bubble: reply }));
        await new Promise((resolve, reject) => {
          audio.onended = () => {
            setState((s) => ({ ...s, agentTalk: false, agentStatus: 'Standing by', bubble: '' }));
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.onerror = () => {
            setState((s) => ({ ...s, agentTalk: false, agentStatus: 'Standing by', bubble: '' }));
            reject(new Error('Audio playback failed'));
          };
          audio.play().catch(reject);
        });
      } catch {
        if (actions?.say) await actions.say(reply);
        else if (push) await push('a', 'Vera', reply);
        else setState((s) => ({ ...s, agentStatus: 'Standing by', bubble: '' }));
      }
    },
    [pushRef, setState],
  );

  const sendMessage = useCallback(
    async (text, source = 'text') => {
      const trimmed = (text || '').trim();
      if (!trimmed || busy) return;

      const push = pushRef.current;
      const actions = actionsRef.current;
      const st = stateRef.current;
      const history = buildHistory(st.messages);

      setBusy(true);
      setState((s) => ({ ...s, agentStatus: 'Thinking', bubble: '' }));

      const userTag = source === 'voice' ? 'Planner · voice' : 'Planner';
      if (push) await push('u', userTag, trimmed, source === 'voice');

      let reply = '';
      let actionList = [];

      const chatStart = performance.now();
      emit('agent.chat.started', {
        metadata: { source, cap_id: st.activePlan, view: st.view, filter: st.filter },
      });

      try {
        const chat = await api.agentChat(trimmed, st.activePlan, {
          view: st.view,
          filter: st.filter,
          active_tab: st.activeTab,
          history,
          source,
        });
        reply = chat.reply || '';
        actionList = chat.actions || [];
        emit('agent.chat.completed', {
          latency_ms: Math.round(performance.now() - chatStart),
          metadata: {
            source,
            action_count: actionList.length,
            action_types: actionList.map((a) => a.type),
          },
        });
      } catch (e) {
        emitError('agent.chat.failed', e, { source });
        const errMsg = e?.message || String(e);
        if (push) await push('d', 'Connection', errMsg.slice(0, 220));
        reply =
          "Sorry — I'm having trouble thinking right now. The connection to my reasoning engine dropped. " +
          'Make sure the backend is running, then try again.';
        actionList = [];
      }

      if (!reply.trim()) {
        reply = "I'm here — what would you like to look at in the portfolio?";
      }

      if (push) await push('a', 'Vera', reply);

      setState((s) => ({ ...s, agentStatus: 'Working' }));

      const speakPromise = speakReply(reply, actions);
      const actPromise = applyAgentActions(actions, actionList, setState, stateRef, {
        isHumanActive,
      });
      await Promise.all([actPromise, speakPromise]);

      setBusy(false);
      setState((s) => ({ ...s, agentStatus: 'Standing by' }));
    },
    [actionsRef, busy, isHumanActive, pushRef, setState, speakReply, stateRef],
  );

  return { busy, sendMessage, audioRef };
}
