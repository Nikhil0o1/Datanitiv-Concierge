import { useCallback, useRef, useState } from 'react';
import { SCENARIOS } from '../data/scenarios';
import { dispatchScenarioCommand } from './scenarioActions';

const API_URL = import.meta.env.VITE_API_URL || '';
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  (API_URL ? `${API_URL.replace(/^http/, 'ws')}/ws/agent` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/agent`);

const SCENARIO_KEYS = {
  brief: 'brief',
  filter: 'filter',
  peek: 'peek',
  voice: 'voice',
  mouse: 'mouse',
  approve: 'approve',
  ledger: 'ledger',
};

export function useAgentWebSocket({ actionsRef, onStep, onComplete, onError }) {
  const wsRef = useRef(null);
  const playingRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);

  const disconnect = useCallback(() => {
    playingRef.current = false;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    setStreaming(false);
  }, []);

  const handleMessage = useCallback(
    async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      const actions = actionsRef.current;
      if (!actions) return;

      switch (msg.type) {
        case 'scenario_start':
          setStreaming(true);
          onStep?.({ type: 'start', total: msg.total_steps, label: msg.label });
          break;
        case 'step_begin':
          onStep?.({ type: 'step_begin', index: msg.index, label: msg.label });
          break;
        case 'command':
          if (playingRef.current) {
            await dispatchScenarioCommand(actions, msg.cmd, msg.args || []);
          }
          break;
        case 'step_end':
          onStep?.({ type: 'step_end', index: msg.index });
          break;
        case 'scenario_complete':
          playingRef.current = false;
          setStreaming(false);
          onComplete?.(msg.scenario);
          break;
        case 'error':
          playingRef.current = false;
          setStreaming(false);
          onError?.(msg.message);
          break;
        default:
          break;
      }
    },
    [actionsRef, onComplete, onError, onStep],
  );

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return wsRef.current;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setStreaming(false);
      playingRef.current = false;
    };
    ws.onerror = () => onError?.('WebSocket connection failed');
    ws.onmessage = handleMessage;

    return ws;
  }, [handleMessage, onError]);

  const startScenario = useCallback(
    async (scenarioIdx, speed = 1) => {
      const key = SCENARIOS[scenarioIdx]?.key;
      const scenario = SCENARIO_KEYS[key] || 'brief';

      const ws = connect();
      if (ws.readyState === WebSocket.CONNECTING) {
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve, { once: true });
          ws.addEventListener('error', reject, { once: true });
        });
      }

      playingRef.current = true;
      setStreaming(true);
      ws.send(JSON.stringify({ action: 'start_scenario', scenario, speed }));
    },
    [connect],
  );

  const stopScenario = useCallback(() => {
    playingRef.current = false;
    setStreaming(false);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'stop' }));
    }
  }, []);

  return {
    connected,
    streaming,
    connect,
    disconnect,
    startScenario,
    stopScenario,
  };
}
