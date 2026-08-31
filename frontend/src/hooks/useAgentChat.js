/** Unified agent chat — streamed Claude reply + simultaneous ElevenLabs PCM audio */

import { useCallback, useRef, useState } from 'react';
import { api } from '../api/client';
import { StreamingPcmPlayer } from '../lib/streamingPcmPlayer';
import { createDelayedFiller } from '../lib/delayedFiller';
import { readRosterFile } from '../utils/rosterCsv';
import { emit, emitError } from '../lib/telemetry';
import { applyAgentActions, partitionAgentActions } from './scenarioActions';
import { apiFieldToDraftKey, nextCreatePlanField } from '../utils/createPlanFields';

/** Map timeline messages to Claude conversation history (natural replies only). */
function buildHistory(messages) {
  if (!messages?.length) return [];
  return messages
    .filter((m) => {
      if (m.cls === 'u') return true;
      if (m.cls === 'v' || (m.cls === 'a' && m.tag?.includes('Vera'))) return true;
      return false;
    })
    .slice(-14)
    .map((m) => ({
      role: m.cls === 'u' ? 'user' : 'assistant',
      content: (m.text || '').trim(),
    }))
    .filter((m) => m.content);
}

function f2(n) {
  return Number(n || 0).toFixed(2);
}

function userFacingStreamError(err) {
  const msg = (err?.message || String(err)).trim();
  if (!msg) return "Sorry — I'm having trouble connecting right now. Try again in a moment.";
  if (/elevenlabs|tts failed|voice synthesis|502|503/i.test(msg)) {
    return "I hit a brief audio glitch — I can still help in text.";
  }
  if (/claude|anthropic|reasoning engine/i.test(msg)) {
    return "Sorry — I'm having trouble thinking right now. Make sure the backend is running, then try again.";
  }
  return msg.slice(0, 220);
}

export function useAgentChat({ actionsRef, stateRef, setState, pushRef, isHumanActive }) {
  const [busy, setBusy] = useState(false);
  const pcmPlayerRef = useRef(null);
  const streamAbortRef = useRef(null);
  const generationRef = useRef(0);
  const delayedFillerRef = useRef(null);

  const beginSpeaking = useCallback(
    (partialReply) => {
      setState((s) => ({
        ...s,
        agentTalk: true,
        agentStatus: 'Speaking',
        bubble: partialReply,
      }));
    },
    [setState],
  );

  const endSpeaking = useCallback(() => {
    setState((s) => ({
      ...s,
      agentTalk: false,
      agentStatus: 'Standing by',
      bubble: '',
    }));
  }, [setState]);

  const speakText = useCallback(
    async (text, { pushAfter = true, deferBubbleUntilAudio = false } = {}) => {
      const reply = (text || '').trim();
      if (!reply) return;

      const pcmPlayer = new StreamingPcmPlayer(24000);
      pcmPlayerRef.current = pcmPlayer;
      let audioReceived = false;

      if (deferBubbleUntilAudio) {
        setState((s) => ({ ...s, agentTalk: true, agentStatus: 'Speaking', bubble: '' }));
      } else {
        beginSpeaking(reply);
      }

      const playMp3Fallback = async () => {
        if (deferBubbleUntilAudio && !audioReceived) beginSpeaking(reply);
        const audioBlob = await api.tts(reply);
        const url = URL.createObjectURL(audioBlob);
        const audio = new Audio(url);
        await new Promise((resolve, reject) => {
          audio.onended = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Audio playback failed'));
          };
          audio.play().catch(reject);
        });
      };

      try {
        await api.ttsStream(reply, {
          onAudio: (b64) => {
            if (!audioReceived && deferBubbleUntilAudio) beginSpeaking(reply);
            audioReceived = true;
            setState((s) => ({ ...s, agentTalk: true, agentStatus: 'Speaking', bubble: reply }));
            void pcmPlayer.playBase64Chunk(b64);
          },
        });
        if (audioReceived) {
          await pcmPlayer.waitUntilIdle();
        } else {
          await playMp3Fallback();
        }
      } catch {
        if (!audioReceived) {
          try {
            await playMp3Fallback();
          } catch {
            /* text still visible in bubble / chat if pushAfter */
          }
        } else {
          await pcmPlayer.waitUntilIdle();
        }
      } finally {
        pcmPlayer.stop();
        pcmPlayerRef.current = null;
        endSpeaking();
        if (pushAfter && pushRef.current) {
          await pushRef.current('a', 'Vera', reply);
        }
      }
    },
    [beginSpeaking, endSpeaking, pushRef, setState],
  );

  const speakFullReplyFallback = useCallback(
    async (reply) => {
      await speakText(reply, { pushAfter: false });
    },
    [speakText],
  );

  const cancelActiveChat = useCallback(() => {
    generationRef.current += 1;
    delayedFillerRef.current?.cancel();
    delayedFillerRef.current = null;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    pcmPlayerRef.current?.stop();
    pcmPlayerRef.current = null;
  }, []);

  const sendMessage = useCallback(
    async (text, source = 'text', opts = {}) => {
      const file = opts.file || null;
      const trimmed = (text || '').trim();
      if ((!trimmed && !file) || busy) return;

      cancelActiveChat();
      const generation = generationRef.current;

      const push = pushRef.current;
      const actions = actionsRef.current;
      const st = stateRef.current;
      const history = buildHistory(st.messages);

      setBusy(true);
      setState((s) => ({ ...s, agentStatus: 'Thinking', bubble: '' }));

      let rosterMeta = null;
      let mapError = null;

      if (file) {
        try {
          const parsed = await readRosterFile(file);
          if (parsed.errors.length && !parsed.rows.length) {
            mapError = parsed.errors.join(' ');
          } else {
            const capId = st.activePlan;
            if (!capId) {
              mapError = 'Open a plan first, then attach the roster CSV.';
            } else {
              const payload = {
                train_hc: parsed.totalFte,
                employees: parsed.rows,
                source_filename: parsed.filename,
              };
              if (actions?.mapRoster) {
                await actions.mapRoster(capId, payload);
              } else {
                await api.mapRoster(capId, payload);
                setState((s) => ({ ...s, doneRoster: true }));
              }
              rosterMeta = {
                filename: parsed.filename,
                employee_count: parsed.rows.length,
                total_fte: parsed.totalFte,
                class_refs: parsed.classRefs,
                cap_id: capId,
                warnings: parsed.errors,
              };
            }
          }
        } catch (e) {
          mapError = e?.message || String(e);
        }
      }

      const userTag = source === 'voice' ? 'Planner · voice' : file ? 'Planner · file' : 'Planner';
      let userText = trimmed;
      if (file) {
        const label = rosterMeta
          ? `Attached ${rosterMeta.filename} (${rosterMeta.employee_count} employees · ${f2(rosterMeta.total_fte)} FTE)`
          : `Tried to attach ${file.name}`;
        userText = trimmed ? `${label}\n${trimmed}` : label;
      }
      if (userText && push) await push('u', userTag, userText, source === 'voice');

      if (mapError) {
        const errReply = `I couldn't map that roster — ${mapError}`;
        await speakFullReplyFallback(errReply);
        if (push) await push('v', 'Vera', errReply);
        setBusy(false);
        return;
      }

      let reply = '';
      let actionList = [];

      const chatMessage =
        rosterMeta
          ? [
              trimmed || 'Please confirm this roster upload.',
              `[Roster CSV already mapped on ${rosterMeta.cap_id}: file=${rosterMeta.filename}, employees=${rosterMeta.employee_count}, fte=${f2(rosterMeta.total_fte)}, classes=${(rosterMeta.class_refs || []).join('|') || 'n/a'}. Acknowledge in reply; do not emit map_roster again.]`,
            ].join('\n')
          : trimmed;

      const chatStart = performance.now();
      emit('agent.chat.started', {
        metadata: { source, cap_id: st.activePlan, view: st.view, filter: st.filter },
      });

      const uiState = {
        view: st.view,
        filter: st.filter,
        active_tab: st.activeTab,
        history,
        source: file ? 'roster_file' : source,
        roster_file: rosterMeta,
        create_plan: st.createPlan
          ? {
              open: st.createPlan.open,
              agent_mode: st.createPlan.agentMode,
              draft: st.createPlan.draft,
              next_field: nextCreatePlanField(st.createPlan.draft),
            }
          : undefined,
      };

      const pcmPlayer = new StreamingPcmPlayer(24000);
      pcmPlayerRef.current = pcmPlayer;

      const delayedFiller = createDelayedFiller({
        delayMs: 520,
        onPhrase: (phrase) => {
          if (generation !== generationRef.current) return;
          setState((s) => ({ ...s, bubble: phrase, agentTalk: true, agentStatus: 'Speaking' }));
        },
        blockMainAudio: () => pcmPlayer.blockMainAudio(),
        unblockMainAudio: () => pcmPlayer.unblockMainAudio(),
      });
      delayedFillerRef.current = delayedFiller;

      if (!opts.skipFiller && trimmed) {
        delayedFiller.arm(trimmed);
      }

      let streamStarted = false;
      let audioReceived = false;
      const controller = new AbortController();
      streamAbortRef.current = controller;

      const onDelta = (partialReply) => {
        if (generation !== generationRef.current) return;
        delayedFiller.cancel();
        reply = partialReply;
        if (!streamStarted) {
          streamStarted = true;
          beginSpeaking(partialReply);
        } else {
          setState((s) => ({ ...s, bubble: partialReply, agentTalk: true, agentStatus: 'Speaking' }));
        }
      };

      const onAudio = (b64) => {
        if (generation !== generationRef.current) return;
        delayedFiller.cancel();
        audioReceived = true;
        if (!streamStarted && reply) beginSpeaking(reply);
        setState((s) => ({ ...s, agentTalk: true, agentStatus: 'Speaking' }));
        void pcmPlayer.playBase64Chunk(b64);
      };

      try {
        const donePayload = await api.agentChatStream(chatMessage, st.activePlan, uiState, {
          signal: controller.signal,
          onDelta,
          onAudio,
          onDone: (payload) => {
            reply = payload.reply || reply;
            actionList = payload.actions || [];
          },
          onError: (err) => {
            throw err;
          },
        });

        if (generation !== generationRef.current) return;

        reply = donePayload?.reply || reply;
        actionList = donePayload?.actions || actionList;
        if (rosterMeta) {
          actionList = (actionList || []).filter((a) => a?.type !== 'map_roster');
        }

        emit('agent.chat.completed', {
          latency_ms: Math.round(performance.now() - chatStart),
          metadata: {
            source,
            action_count: actionList.length,
            action_types: actionList.map((a) => a.type),
            streamed: true,
            audio_streamed: audioReceived,
          },
        });
      } catch (e) {
        if (controller.signal.aborted || generation !== generationRef.current) return;

        emitError('agent.chat.failed', e, { source });
        pcmPlayer.stop();

        try {
          const chat = await api.agentChat(chatMessage, st.activePlan, uiState);
          reply = chat.reply || '';
          actionList = chat.actions || [];
          if (rosterMeta) {
            actionList = (actionList || []).filter((a) => a?.type !== 'map_roster');
          }
          const { createPlan: createPlanActs, other: otherActs } = partitionAgentActions(actionList);
          if (createPlanActs.length) {
            await applyAgentActions(actions, createPlanActs, setState, stateRef, { isHumanActive });
          }
          await applyAgentActions(actions, otherActs, setState, stateRef, { isHumanActive });
          await speakFullReplyFallback(reply);
          if (push) await push('v', 'Vera', reply);
        } catch (fallbackErr) {
          emitError('agent.chat.failed', fallbackErr, { source, fallback: true });
          const errMsg = userFacingStreamError(e);
          if (push) await push('d', 'Connection', errMsg);
          reply = rosterMeta
            ? `Mapped ${rosterMeta.employee_count} employees (${f2(rosterMeta.total_fte)} FTE) from ${rosterMeta.filename} onto ${rosterMeta.cap_id}. Gap should look better on New Hire / Overview.`
            : "Sorry — I'm having trouble thinking right now. The connection to my reasoning engine dropped. " +
              'Make sure the backend is running, then try again.';
          await speakFullReplyFallback(reply);
          if (push) await push('v', 'Vera', reply);
        }

        setBusy(false);
        streamAbortRef.current = null;
        pcmPlayerRef.current = null;
        setState((s) => ({ ...s, agentStatus: 'Standing by' }));
        return;
      }

      if (generation !== generationRef.current) return;

      const { createPlan: createPlanActs, other: otherActs } = partitionAgentActions(actionList);

      if (createPlanActs.length) {
        setState((s) => ({ ...s, agentStatus: 'Working' }));
        await applyAgentActions(actions, createPlanActs, setState, stateRef, { isHumanActive });
      }

      if (!reply.trim()) {
        reply = rosterMeta
          ? `Got it — ${rosterMeta.filename} is mapped (${rosterMeta.employee_count} people, ${f2(rosterMeta.total_fte)} FTE).`
          : "I'm here — what would you like to look at in the portfolio?";
        if (!streamStarted) beginSpeaking(reply);
        setState((s) => ({ ...s, bubble: reply }));
      }

      if (!audioReceived && reply.trim()) {
        pcmPlayer.stop();
        await applyAgentActions(actions, otherActs, setState, stateRef, { isHumanActive });
        await speakFullReplyFallback(reply);
        if (push) await push('v', 'Vera', reply);
        setBusy(false);
        streamAbortRef.current = null;
        pcmPlayerRef.current = null;
        setState((s) => ({ ...s, agentStatus: 'Standing by' }));
        return;
      }

      setState((s) => ({ ...s, agentStatus: 'Working', bubble: reply, agentTalk: true }));

      await applyAgentActions(actions, otherActs, setState, stateRef, { isHumanActive });
      await pcmPlayer.waitUntilIdle();

      if (generation !== generationRef.current) return;

      pcmPlayer.stop();
      pcmPlayerRef.current = null;
      endSpeaking();
      if (push) await push('v', 'Vera', reply);

      setBusy(false);
      streamAbortRef.current = null;
      setState((s) => ({ ...s, agentStatus: 'Standing by' }));
    },
    [
      actionsRef,
      beginSpeaking,
      busy,
      cancelActiveChat,
      endSpeaking,
      isHumanActive,
      pushRef,
      setState,
      speakFullReplyFallback,
      stateRef,
    ],
  );

  return { busy, sendMessage, cancelActiveChat, speakText };
}
