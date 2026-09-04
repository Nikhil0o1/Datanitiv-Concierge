import { emit, emitError, getSessionId } from '../lib/telemetry';

const BASE = import.meta.env.VITE_API_URL || '';

function parseErrorBody(text) {
  if (!text) return 'Request failed';
  try {
    const data = JSON.parse(text);
    if (typeof data.detail === 'string') return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map((d) => d.msg || JSON.stringify(d)).join('; ');
    return text;
  } catch {
    return text;
  }
}

async function request(path, options = {}) {
  const start = performance.now();
  const headers = {
    'Content-Type': 'application/json',
    'X-Session-ID': getSessionId(),
    ...options.headers,
  };
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch (err) {
    emitError('api_error', err, { endpoint: path, method: options.method || 'GET' });
    throw err;
  }
  const latency_ms = Math.round(performance.now() - start);
  if (!res.ok) {
    const detail = parseErrorBody(await res.text());
    emit('api_error', {
      severity: res.status >= 500 ? 'error' : 'warning',
      endpoint: path,
      status_code: res.status,
      latency_ms,
      error_code: `HTTP_${res.status}`,
      metadata: { method: options.method || 'GET', detail },
    });
    throw new Error(detail || res.statusText);
  }
  emit('api_request', {
    endpoint: path,
    status_code: res.status,
    latency_ms,
    metadata: { method: options.method || 'GET' },
  });
  if (res.headers.get('content-type')?.includes('application/json')) {
    return res.json();
  }
  return res;
}

export const api = {
  health: () => request('/api/health'),
  cycle: () => request('/api/cycle/current'),
  plans: (program) => request(`/api/plans${program ? `?program=${encodeURIComponent(program)}` : ''}`),
  plan: (capId) => request(`/api/plans/${capId}`),
  createPlan: (body) =>
    request('/api/plans', { method: 'POST', body: JSON.stringify(body) }),
  triage: () => request('/api/triage'),
  programs: () => request('/api/programs'),
  queue: () => request('/api/queue/packages'),
  patchPackage: (id, body) => request(`/api/queue/packages/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  upsertPackage: (body) =>
    request('/api/queue/packages/upsert', { method: 'POST', body: JSON.stringify(body) }),
  executeQueue: (ids) =>
    request('/api/queue/execute', { method: 'POST', body: JSON.stringify({ package_ids: ids }) }),
  ledger: () => request('/api/ledger'),
  memories: () => request('/api/memories'),
  submitShrinkage: (capId, weeks) =>
    request(`/api/plans/${capId}/shrinkage`, { method: 'POST', body: JSON.stringify({ weeks }) }),
  submitAttrition: (capId, weeks) =>
    request(`/api/plans/${capId}/attrition`, { method: 'POST', body: JSON.stringify({ weeks }) }),
  submitForecast: (capId, body) =>
    request(`/api/plans/${capId}/forecast`, { method: 'POST', body: JSON.stringify(body) }),
  updateHeadcount: (capId, body) =>
    request(`/api/plans/${capId}/headcount`, { method: 'POST', body: JSON.stringify(body) }),
  mapRoster: (capId, body) =>
    request(`/api/plans/${capId}/roster/map`, { method: 'POST', body: JSON.stringify(body) }),
  agentChat: (message, contextCapId, uiState) =>
    request('/api/agent/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        context_cap_id: contextCapId,
        ui_state: {
          view: uiState?.view,
          filter: uiState?.filter,
          active_tab: uiState?.active_tab,
          ...(uiState?.roster_file ? { roster_file: uiState.roster_file } : {}),
          ...(uiState?.create_plan ? { create_plan: uiState.create_plan } : {}),
        },
        history: uiState?.history || [],
        source: uiState?.source || 'text',
      }),
    }),
  agentChatStream: async (message, contextCapId, uiState, { onDelta, onAudio, onDone, onError, signal } = {}) => {
    const start = performance.now();
    const headers = {
      'Content-Type': 'application/json',
      'X-Session-ID': getSessionId(),
    };
    let res;
    try {
      res = await fetch(`${BASE}/api/agent/chat/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message,
          context_cap_id: contextCapId,
          ui_state: {
            view: uiState?.view,
            filter: uiState?.filter,
            active_tab: uiState?.active_tab,
            ...(uiState?.roster_file ? { roster_file: uiState.roster_file } : {}),
            ...(uiState?.create_plan ? { create_plan: uiState.create_plan } : {}),
          },
          history: uiState?.history || [],
          source: uiState?.source || 'text',
        }),
        signal,
      });
    } catch (err) {
      emitError('agent.chat.stream.failed', err, { source: uiState?.source });
      throw err;
    }

    if (!res.ok) {
      const detail = parseErrorBody(await res.text());
      emit('agent.chat.stream.failed', {
        severity: res.status >= 500 ? 'error' : 'warning',
        status_code: res.status,
        latency_ms: Math.round(performance.now() - start),
        metadata: { detail },
      });
      throw new Error(detail || res.statusText);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('Streaming not supported');

    const decoder = new TextDecoder();
    let buffer = '';
    let finalPayload = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        let payload;
        try {
          payload = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (payload.type === 'delta' && payload.reply != null) {
          onDelta?.(payload.reply);
        } else if (payload.type === 'audio' && payload.data) {
          onAudio?.(payload.data, payload.format || 'pcm_24000');
        } else if (payload.type === 'done') {
          finalPayload = payload;
          onDone?.(payload);
        } else if (payload.type === 'error') {
          onError?.(new Error(payload.detail || 'Stream error'));
        }
      }
    }

    emit('agent.chat.stream.completed', {
      latency_ms: Math.round(performance.now() - start),
      metadata: { source: uiState?.source },
    });
    return finalPayload;
  },
  portfolioAnalysis: () => request('/api/portfolio/analysis'),
  agentStatus: () => request('/api/agent/status'),
  agentExecutionTraces: () => request('/api/agent/execution-traces'),
  costSummary: () => request('/api/cost/summary'),
  costAnalytics: (range = '24h', groupBy = 'none') =>
    request(`/api/cost/analytics?range=${encodeURIComponent(range)}&group_by=${encodeURIComponent(groupBy)}`),
  stt: async (blob) => {
    const form = new FormData();
    form.append('audio', blob, 'audio.webm');
    const start = performance.now();
    const res = await fetch(`${BASE}/api/voice/stt`, {
      method: 'POST',
      headers: { 'X-Session-ID': getSessionId() },
      body: form,
    });
    const latency_ms = Math.round(performance.now() - start);
    if (!res.ok) {
      emit('voice.stt.failed', { severity: 'error', latency_ms, status_code: res.status });
      throw new Error(await res.text());
    }
    emit('voice.stt.completed', { latency_ms });
    return res.json();
  },
  tts: async (text) => {
    const start = performance.now();
    const res = await fetch(`${BASE}/api/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-ID': getSessionId() },
      body: JSON.stringify({ text }),
    });
    const latency_ms = Math.round(performance.now() - start);
    if (!res.ok) {
      emit('voice.tts.failed', { severity: 'error', latency_ms, status_code: res.status });
      throw new Error(await res.text());
    }
    emit('voice.tts.completed', { latency_ms, metadata: { text_length: text.length } });
    return res.blob();
  },

  /** Stream PCM TTS chunks (SSE) — low latency, same as agent chat audio path. */
  ttsStream: async (text, { signal, onAudio, onDone, onError } = {}) => {
    const start = performance.now();
    const res = await fetch(`${BASE}/api/voice/tts/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-ID': getSessionId() },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!res.ok) {
      const detail = parseErrorBody(await res.text());
      emit('voice.tts.failed', {
        severity: res.status >= 500 ? 'error' : 'warning',
        status_code: res.status,
        latency_ms: Math.round(performance.now() - start),
      });
      throw new Error(detail || res.statusText);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('Streaming not supported');

    const decoder = new TextDecoder();
    let buffer = '';
    let audioChunks = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        let payload;
        try {
          payload = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (payload.type === 'audio' && payload.data) {
          audioChunks += 1;
          onAudio?.(payload.data, payload.format || 'pcm_24000');
        } else if (payload.type === 'done') {
          onDone?.(payload);
        } else if (payload.type === 'error') {
          onError?.(new Error(payload.detail || 'Stream error'));
        }
      }
    }

    emit('voice.tts.completed', {
      latency_ms: Math.round(performance.now() - start),
      metadata: { text_length: text.length, streamed: true, audio_chunks: audioChunks },
    });
  },

  conciergePendingNudges: (limit = 5, { capId, view } = {}) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (capId) qs.set('cap_id', capId);
    if (view) qs.set('view', view);
    return request(`/api/concierge/nudges/pending?${qs}`);
  },
  conciergeConfig: () => request('/api/concierge/config'),
  conciergeNudgeShown: (nudgeId) =>
    request(`/api/concierge/nudges/${nudgeId}/shown`, { method: 'POST' }),
  conciergeNudgeAccept: (nudgeId) =>
    request(`/api/concierge/nudges/${nudgeId}/accept`, { method: 'POST' }),
  conciergeNudgeDismiss: (nudgeId) =>
    request(`/api/concierge/nudges/${nudgeId}/dismiss`, { method: 'POST' }),
  conciergeNudgeSnooze: (nudgeId, minutes) =>
    request(`/api/concierge/nudges/${nudgeId}/snooze`, {
      method: 'POST',
      body: JSON.stringify({ minutes }),
    }),
  conciergeRecommendationFeedback: (recommendationId, body) =>
    request(`/api/concierge/recommendations/${recommendationId}/feedback`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
