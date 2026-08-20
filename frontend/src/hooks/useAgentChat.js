/** Unified agent chat — text or voice → Claude → cursor actions + TTS */

import { useCallback, useRef, useState } from 'react';
import { api } from '../api/client';
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

export function useAgentChat({ actionsRef, stateRef, setState, pushRef }) {
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

      try {
        const chat = await api.agentChat(trimmed, st.activePlan, {
          view: st.view,
          filter: st.filter,
          active_tab: st.activeTab,
          human_mode: st.humanMode,
          history,
          source,
        });
        reply = chat.reply || '';
        actionList = chat.actions || [];
      } catch (e) {
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
      const actPromise = applyAgentActions(actions, actionList, setState, stateRef);
      await Promise.all([actPromise, speakPromise]);

      setBusy(false);
      setState((s) => ({ ...s, agentStatus: 'Standing by' }));
    },
    [actionsRef, busy, pushRef, setState, speakReply, stateRef],
  );

  return { busy, sendMessage, audioRef };
}
