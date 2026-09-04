import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import '../styles/execution-flow.css';

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * The final user turn's `content` (built server-side by agent_harness._format_user_turn) is a
 * plain string: an optional instruction prefix, followed by a JSON object embedded as text
 * (json.dumps(payload, indent=2)) — e.g. {"live_portfolio": "...", "ui_state": {...}, "planner_says": "..."}.
 * This only re-parses that same string for DISPLAY — it does not change what was actually sent/stored.
 * Prior history turns are plain text and simply fail to parse, which is handled below.
 */
function parseTurnContent(content) {
  if (typeof content !== 'string') return null;
  const braceIdx = content.indexOf('{');
  if (braceIdx === -1) return null;
  const prefix = content.slice(0, braceIdx).trim();
  const jsonPart = content.slice(braceIdx);
  try {
    const payload = JSON.parse(jsonPart);
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return { prefix, payload };
    }
  } catch {
    // Not JSON (e.g. a plain history turn) — caller falls back to raw text.
  }
  return null;
}

function renderValue(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function ParsedTurn({ prefix, payload }) {
  return (
    <div className="ef-turn-parsed">
      {prefix && <div className="ef-turn-prefix">{prefix}</div>}
      {Object.entries(payload).map(([key, value]) => (
        <div className="ef-param" key={key}>
          <div className="ef-param-key">{key}</div>
          <pre className="ef-pre ef-param-value">{renderValue(value)}</pre>
        </div>
      ))}
    </div>
  );
}

function MessageCard({ message, index }) {
  const parsed = parseTurnContent(message.content);
  return (
    <div className="ef-message">
      <div className="ef-message-head">
        <span className={`ef-role ef-role-${message.role}`}>{message.role}</span>
        <span className="ef-message-index">turn {index + 1}</span>
      </div>
      {parsed ? (
        <ParsedTurn prefix={parsed.prefix} payload={parsed.payload} />
      ) : (
        <pre className="ef-pre">{message.content}</pre>
      )}
    </div>
  );
}

export default function ExecutionFlowPage() {
  const [traces, setTraces] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showRawInput, setShowRawInput] = useState(false);

  useEffect(() => {
    // The main app's global stylesheet sets body{overflow:hidden} for its own fixed-viewport
    // layout; this page needs normal document scrolling, so override it while mounted.
    document.title = 'Execution Flow · Vera';
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    return () => {
      document.title = 'Datanitiv CAP-ABILITY — Planning Agent';
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.agentExecutionTraces();
      const list = data.traces || [];
      setTraces(list);
      setError('');
      setSelectedId((prev) => (prev != null && list.some((t) => t.id === prev) ? prev : list[0]?.id ?? null));
    } catch (e) {
      setError(e?.message || 'Could not load execution traces');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = traces.find((t) => t.id === selectedId) || null;

  return (
    <div className="ef-page">
      <header className="ef-header">
        <div>
          <h1>Execution Flow</h1>
          <p>Exact input sent to Vera and exact raw output received — nothing added, nothing trimmed.</p>
        </div>
        <button className="ef-refresh" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {error && <div className="ef-error">{error}</div>}

      <div className="ef-layout">
        <aside className="ef-list">
          {traces.length === 0 && !loading && (
            <div className="ef-empty">No calls yet. Send a message to Vera, then refresh.</div>
          )}
          {traces.map((t) => (
            <button
              key={t.id}
              className={`ef-list-item ${t.id === selectedId ? 'active' : ''}`}
              onClick={() => setSelectedId(t.id)}
            >
              <span className="ef-list-endpoint">{t.endpoint}</span>
              <span className="ef-list-time">{fmtTime(t.timestamp)}</span>
            </button>
          ))}
        </aside>

        <main className="ef-detail">
          {!selected && <div className="ef-empty">Select a call to inspect it.</div>}
          {selected && (
            <>
              <section className="ef-block">
                <div className="ef-block-head">
                  <h2>Full input sent to the model</h2>
                  <button className="ef-toggle" onClick={() => setShowRawInput((v) => !v)}>
                    {showRawInput ? 'Show formatted' : 'Show raw JSON'}
                  </button>
                </div>

                {showRawInput ? (
                  <pre className="ef-pre">{JSON.stringify(selected.input, null, 2)}</pre>
                ) : (
                  <div className="ef-input-formatted">
                    <div className="ef-meta-row">
                      <div className="ef-meta-item">
                        <span className="ef-meta-label">model</span>
                        <span className="ef-meta-value">{selected.input.model}</span>
                      </div>
                      <div className="ef-meta-item">
                        <span className="ef-meta-label">max_tokens</span>
                        <span className="ef-meta-value">{selected.input.max_tokens}</span>
                      </div>
                    </div>

                    <details className="ef-system">
                      <summary>system prompt ({selected.input.system.length.toLocaleString()} chars — click to expand)</summary>
                      <pre className="ef-pre">{selected.input.system}</pre>
                    </details>

                    <div className="ef-messages">
                      <div className="ef-messages-label">messages ({selected.input.messages.length})</div>
                      {selected.input.messages.map((m, i) => (
                        <MessageCard message={m} index={i} key={i} />
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="ef-block">
                <h2>Full raw output from the model</h2>
                <pre className="ef-pre">{selected.raw_response}</pre>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
