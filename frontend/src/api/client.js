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
  triage: () => request('/api/triage'),
  programs: () => request('/api/programs'),
  queue: () => request('/api/queue/packages'),
  patchPackage: (id, body) => request(`/api/queue/packages/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  executeQueue: (ids) => request('/api/queue/execute', { method: 'POST', body: JSON.stringify({ package_ids: ids }) }),
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
        },
        history: uiState?.history || [],
        source: uiState?.source || 'text',
      }),
    }),
  portfolioAnalysis: () => request('/api/portfolio/analysis'),
  agentStatus: () => request('/api/agent/status'),
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

  conciergePendingNudges: (limit = 5) =>
    request(`/api/concierge/nudges/pending?limit=${limit}`),
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
