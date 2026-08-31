import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { BreakdownPanel, LineChart } from '../components/AnalyticsChart';
import '../styles/cost.css';

const RANGES = ['1H', '6H', '24H', '7D', '30D', '90D'];
const TABS = ['Usage', 'Cost', 'Latency', 'Errors', 'Models'];
const GROUPS = ['None', 'Model', 'Provider'];

function rangeKey(label) {
  return label.toLowerCase();
}

function groupKey(label) {
  return label.toLowerCase();
}

function fmtCompact(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}

function fmtUsd(n) {
  const v = Number(n || 0);
  if (v === 0) return '$0.00';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function Trend({ change, invert }) {
  const c = Number(change ?? 0);
  if (c === 0) return <span className="ax-trend ax-trend-neutral">0%</span>;
  const up = c > 0;
  const good = invert ? !up : up;
  return (
    <span className={`ax-trend ${good ? 'ax-trend-up' : 'ax-trend-down'}`}>
      {up ? '↑' : '↓'} {Math.abs(c).toFixed(1)}%
    </span>
  );
}

function MetricCard({ label, value, change, invert, format = 'number' }) {
  const display =
    format === 'usd' ? fmtUsd(value)
    : format === 'pct' ? `${Number(value).toFixed(2)}%`
    : format === 'ms' ? `${Math.round(value)}ms`
    : fmtCompact(value);
  return (
    <div className="ax-metric">
      <div className="ax-metric-label">{label}</div>
      <div className="ax-metric-row">
        <span className="ax-metric-value">{display}</span>
        <Trend change={change} invert={invert} />
      </div>
    </div>
  );
}

export default function CostPage() {
  const [range, setRange] = useState('24H');
  const [tab, setTab] = useState('Usage');
  const [groupBy, setGroupBy] = useState('None');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const effectiveGroup = tab === 'Models' ? 'Model' : groupBy;
  const showBreakdown = tab === 'Models' || groupBy !== 'None';

  const load = useCallback(async () => {
    try {
      const summary = await api.costAnalytics(rangeKey(range), groupKey(effectiveGroup));
      setData(summary);
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load analytics');
    } finally {
      setLoading(false);
    }
  }, [range, effectiveGroup]);

  useEffect(() => {
    document.title = 'Analytics · Claude API';
    document.documentElement.classList.add('ax-locked');
    document.body.classList.add('ax-locked');
    return () => {
      document.title = 'Datanitiv CAP-ABILITY — Planning Agent';
      document.documentElement.classList.remove('ax-locked');
      document.body.classList.remove('ax-locked');
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    void load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const ts = data?.timeseries || [];
  const labels = ts.map((p) => p.ts);
  const rk = rangeKey(range);

  const leftChart = useMemo(() => {
    if (!ts.length) return null;
    const titles = {
      Usage: 'Requests Over Time',
      Cost: 'Cost Over Time',
      Latency: 'Avg Latency Over Time',
      Errors: 'Errors Over Time',
      Models: 'Requests Over Time',
    };
    const values = {
      Usage: ts.map((p) => p.requests),
      Cost: ts.map((p) => p.cost_usd),
      Latency: ts.map((p) => p.avg_latency_ms),
      Errors: ts.map((p) => p.errors),
      Models: ts.map((p) => p.requests),
    };
    const colors = { Usage: '#e4e4e7', Cost: '#a78bfa', Latency: '#38bdf8', Errors: '#f87171', Models: '#e4e4e7' };
    return {
      title: titles[tab],
      series: [{ name: titles[tab], values: values[tab], labels, color: colors[tab] }],
    };
  }, [tab, ts, labels]);

  const rightChart = useMemo(() => {
    if (!ts.length || showBreakdown) return null;
    if (tab === 'Usage' || tab === 'Models') {
      return {
        title: 'Tokens Over Time',
        series: [
          { name: 'Input Tokens', values: ts.map((p) => p.input_tokens), labels, color: '#3b82f6' },
          { name: 'Output Tokens', values: ts.map((p) => p.output_tokens), labels, color: '#eab308' },
        ],
      };
    }
    return {
      title: 'Requests Over Time',
      series: [{ name: 'Requests', values: ts.map((p) => p.requests), labels, color: '#71717a' }],
    };
  }, [tab, ts, labels, showBreakdown]);

  const breakdownTitle =
    tab === 'Models' || groupBy === 'Model' ? 'Breakdown by model' : 'Breakdown by provider';

  const m = data?.metrics;

  return (
    <div className="ax-page">
      <div className="ax-glow ax-glow-a" aria-hidden />
      <div className="ax-glow ax-glow-b" aria-hidden />

      <div className="ax-shell">
        <header className="ax-top">
          <div className="ax-top-left">
            <div className="ax-title-row">
              <svg className="ax-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" strokeLinecap="round" />
              </svg>
              <h1>Analytics</h1>
              <span className="ax-live">
                <span className="ax-live-dot" />
                live
              </span>
            </div>
            <p className="ax-subtitle">Explore usage, cost, latency, and error trends.</p>
          </div>
          <div className="ax-range-pills">
            {RANGES.map((r) => (
              <button key={r} type="button" className={`ax-pill ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        </header>

        {error && (
          <div className="ax-banner ax-banner-error">
            {error}
            <button type="button" onClick={() => { setLoading(true); void load(); }}>Retry</button>
          </div>
        )}

        {loading && !data ? (
          <div className="ax-loading">Loading…</div>
        ) : (
          <div className="ax-body">
            <section className="ax-metrics">
              <MetricCard label="Total Requests" value={m?.total_requests?.value} change={m?.total_requests?.change_pct} invert={false} />
              <MetricCard label="Total Cost" value={m?.total_cost?.value} change={m?.total_cost?.change_pct} invert format="usd" />
              <MetricCard label="Avg Latency" value={m?.avg_latency_ms?.value} change={m?.avg_latency_ms?.change_pct} invert format="ms" />
              <MetricCard label="Error Rate" value={m?.error_rate_pct?.value} change={m?.error_rate_pct?.change_pct} invert format="pct" />
              <MetricCard label="Cache Hit Rate" value={m?.cache_hit_rate_pct?.value} change={m?.cache_hit_rate_pct?.change_pct} invert={false} format="pct" />
            </section>

            <div className="ax-toolbar">
              <nav className="ax-tabs">
                {TABS.map((t) => (
                  <button key={t} type="button" className={`ax-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                    {t}
                  </button>
                ))}
              </nav>
              {tab !== 'Models' && (
                <div className="ax-group-row">
                  <span className="ax-group-label">Group by:</span>
                  {GROUPS.map((g) => (
                    <button key={g} type="button" className={`ax-pill ax-pill-sm ${groupBy === g ? 'active' : ''}`} onClick={() => setGroupBy(g)}>
                      {g}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <section className="ax-charts">
              <div className="ax-chart-panel">
                {leftChart ? (
                  <LineChart title={leftChart.title} series={leftChart.series} range={rk} points={ts} />
                ) : (
                  <div className="ax-chart-empty">No data yet — use Vera to generate API calls.</div>
                )}
              </div>
              <div className="ax-chart-panel">
                {showBreakdown ? (
                  <BreakdownPanel
                    title={breakdownTitle}
                    groups={data?.groups}
                    formatUsd={fmtUsd}
                  />
                ) : rightChart ? (
                  <LineChart title={rightChart.title} series={rightChart.series} range={rk} points={ts} />
                ) : (
                  <div className="ax-chart-empty">No data yet.</div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
