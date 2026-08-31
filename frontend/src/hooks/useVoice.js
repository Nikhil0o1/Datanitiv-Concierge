import { useCallback, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAgentChat } from './useAgentChat';

export function useVoice({ actionsRef, stateRef, setState, pushRef, isHumanActive }) {
  const [recording, setRecording] = useState(false);
  const mediaRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  const chat = useAgentChat({ actionsRef, stateRef, setState, pushRef, isHumanActive });

  const startRecording = useCallback(async () => {
    if (recording || chat.busy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setState((s) => ({ ...s, agentHear: true, agentStatus: 'Listening', bubble: 'Listening…' }));
    } catch (e) {
      const push = pushRef.current;
      if (push) await push('d', 'Voice', `Microphone unavailable: ${e.message}`);
    }
  }, [recording, chat.busy, pushRef, setState]);

  const stopRecording = useCallback(async () => {
    if (!recording || !recorderRef.current) return;
    setRecording(false);

    const recorder = recorderRef.current;
    await new Promise((resolve) => {
      recorder.onstop = resolve;
      recorder.stop();
    });

    mediaRef.current?.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
    recorderRef.current = null;

    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];

    setState((s) => ({ ...s, agentHear: false, agentStatus: 'Processing', bubble: '', agentTalk: false }));

    if (!blob.size) {
      setState((s) => ({ ...s, agentStatus: 'Standing by', agentTalk: false, bubble: '' }));
      return;
    }

    try {
      const stt = await api.stt(blob);
      const text = (stt.text || '').trim();

      if (stt.transcription_quality === 'retry_suggested' || !text) {
        const push = pushRef.current;
        const hint =
          stt.transcription_quality === 'retry_suggested'
            ? "I didn't catch that clearly — try again in English, a bit closer to the mic."
            : 'Could not transcribe — speak clearly or type your request below.';
        if (push) await push('d', 'Voice', hint);
        setState((s) => ({ ...s, agentStatus: 'Standing by', agentTalk: false, bubble: '' }));
        return;
      }

      await chat.sendMessage(text, 'voice', { skipFiller: false });
    } catch (e) {
      const push = pushRef.current;
      const msg = (e?.message || 'Voice processing failed').replace(/elevenlabs/gi, 'voice service');
      if (push) await push('d', 'Voice', msg);
      setState((s) => ({ ...s, agentStatus: 'Standing by', agentTalk: false, bubble: '' }));
    }
  }, [recording, chat, pushRef, setState]);

  const toggleRecording = useCallback(async () => {
    if (recording) await stopRecording();
    else await startRecording();
  }, [recording, startRecording, stopRecording]);

  return {
    recording,
    voiceBusy: chat.busy,
    toggleRecording,
    sendMessage: chat.sendMessage,
    speakText: chat.speakText,
    chatBusy: chat.busy,
  };
}
