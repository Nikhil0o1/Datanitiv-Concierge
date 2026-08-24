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
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const detail = parseErrorBody(await res.text());
    throw new Error(detail || res.statusText);
  }
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
    const res = await fetch(`${BASE}/api/voice/stt`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  tts: async (text) => {
    const res = await fetch(`${BASE}/api/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.blob();
  },
};
