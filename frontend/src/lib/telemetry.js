/** Frontend telemetry — batched event emission to Concierge collector. */

const SESSION_KEY = 'concierge_session_id';
const BATCH_SIZE = 10;
const FLUSH_MS = 2000;

let queue = [];
let flushTimer = null;
let sessionId = sessionStorage.getItem(SESSION_KEY);

if (!sessionId) {
  sessionId = crypto.randomUUID();
  sessionStorage.setItem(SESSION_KEY, sessionId);
}

function buildEvent(eventType, props = {}) {
  return {
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    tenant_id: 'default',
    event_type: eventType,
    source: 'frontend',
    service: 'planning-ui',
    severity: props.severity || 'info',
    metadata: props.metadata || {},
    endpoint: props.endpoint,
    status_code: props.status_code,
    latency_ms: props.latency_ms,
    error_code: props.error_code,
    correlation_id: props.correlation_id,
    ...props,
  };
}

async function flush() {
  if (!queue.length) return;
  const batch = queue.splice(0, BATCH_SIZE);
  try {
    await fetch('/api/concierge/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': sessionId,
      },
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    queue.unshift(...batch);
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_MS);
}

export function getSessionId() {
  return sessionId;
}

export function emit(eventType, props = {}) {
  const { metadata, severity, endpoint, status_code, latency_ms, error_code, correlation_id, ...rest } = props;
  queue.push(
    buildEvent(eventType, {
      metadata: { ...metadata, ...rest },
      severity,
      endpoint,
      status_code,
      latency_ms,
      error_code,
      correlation_id,
    }),
  );
  if (eventType === 'plan.opened' || queue.length >= BATCH_SIZE) {
    flush();
  } else {
    scheduleFlush();
  }
}

export function emitError(eventType, error, extra = {}) {
  emit(eventType, {
    severity: 'error',
    error_code: error?.name || 'Error',
    metadata: { message: String(error?.message || error), ...extra },
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (queue.length) {
      navigator.sendBeacon(
        '/api/concierge/events',
        JSON.stringify({ events: queue }),
      );
    }
  });

  window.addEventListener('error', (ev) => {
    emit('frontend_error', {
      severity: 'error',
      metadata: { message: ev.message, filename: ev.filename, lineno: ev.lineno },
    });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    emit('frontend_error', {
      severity: 'error',
      metadata: { message: String(ev.reason) },
    });
  });
}
