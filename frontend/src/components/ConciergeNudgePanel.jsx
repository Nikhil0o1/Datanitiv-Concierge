function reliabilityLabel(score) {
  const pct = Math.round((score || 0) * 100);
  if (pct >= 80) return 'High';
  if (pct >= 60) return 'Moderate';
  return 'Early';
}

function reliabilityClass(score) {
  const pct = Math.round((score || 0) * 100);
  if (pct >= 80) return 'high';
  if (pct >= 60) return 'mid';
  return 'low';
}

function factorSummary(factors) {
  if (!factors || typeof factors !== 'object') return null;
  const parts = [];
  if (factors.similar_cases != null) parts.push(`${factors.similar_cases} similar cases`);
  if (factors.successful_outcomes != null && factors.similar_cases) {
    parts.push(`${factors.successful_outcomes}/${factors.similar_cases} succeeded`);
  }
  if (factors.evidence_quality) parts.push(`${factors.evidence_quality} evidence`);
  return parts.length ? parts.join(' · ') : null;
}

export default function ConciergeNudgePanel({ nudges, onShowMe, onDismiss, onSnooze, loading }) {
  if (!nudges?.length && !loading) return null;

  const visible = (nudges || []).slice(0, 3);
  const overflow = Math.max(0, (nudges?.length || 0) - visible.length);

  return (
    <div className="concierge-nudges" aria-live="polite" aria-label="Concierge recommendations">
      <div className="concierge-nudges-head">
        <span className="concierge-dot" aria-hidden />
        <span className="concierge-label">Concierge</span>
        <span className="concierge-sub">WFM monitor</span>
        {nudges?.length ? <span className="concierge-count">{nudges.length}</span> : null}
      </div>
      <div className="concierge-nudges-stack">
        {loading && !nudges.length ? (
          <div className="concierge-nudge-card concierge-nudge-loading">Scanning…</div>
        ) : null}
        {visible.map((nudge) => (
          <article key={nudge.id} className="concierge-nudge-card" data-cap={nudge.cap_id || ''}>
            <header className="concierge-nudge-top">
              <div className="concierge-nudge-title-wrap">
                <div className="concierge-nudge-title">{nudge.title}</div>
                {nudge.program ? <div className="concierge-nudge-program">{nudge.program}</div> : null}
                {nudge.cap_id ? <div className="concierge-nudge-cap">{nudge.cap_id}</div> : null}
              </div>
              <div className={`concierge-reliability ${reliabilityClass(nudge.reliability_score)}`}>
                <span className="pct">{Math.round((nudge.reliability_score || 0) * 100)}%</span>
                <span className="lbl">{reliabilityLabel(nudge.reliability_score)}</span>
              </div>
            </header>

            <p className="concierge-nudge-recommend">{nudge.recommendation || nudge.summary}</p>

            {nudge.explanation ? (
              <details className="concierge-nudge-reason">
                <summary>Why this?</summary>
                <div className="concierge-nudge-explanation">{nudge.explanation}</div>
              </details>
            ) : null}

            {factorSummary(nudge.reliability_factors) ? (
              <div className="concierge-nudge-factors">{factorSummary(nudge.reliability_factors)}</div>
            ) : null}

            <div className="concierge-nudge-actions">
              <button type="button" className="concierge-btn primary" onClick={() => onShowMe(nudge)}>
                Accept &amp; show me
              </button>
              <button type="button" className="concierge-btn" onClick={() => onSnooze(nudge.id, 60)}>
                Snooze
              </button>
              <button type="button" className="concierge-btn ghost" onClick={() => onDismiss(nudge.id)}>
                Dismiss
              </button>
            </div>
          </article>
        ))}
        {overflow > 0 ? <div className="concierge-nudge-more">+{overflow} more in queue</div> : null}
      </div>
    </div>
  );
}
