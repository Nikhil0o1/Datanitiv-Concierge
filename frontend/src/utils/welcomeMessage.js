import { f2 } from './format';

export const WELCOME_SESSION_KEY = 'concierge.welcomeShown';

/** Short label from "Week of Aug 02, 2026" → "Aug 02". */
export function cycleShort(cycleLabel) {
  if (!cycleLabel) return 'this week';
  const m = cycleLabel.match(/([A-Za-z]{3}\s+\d{1,2})/);
  if (m) return m[1];
  return cycleLabel.replace(/^Week of\s+/i, '').replace(/,\s*\d{4}$/, '') || 'this week';
}

export function pickCasualGreeting(date = new Date()) {
  const h = date.getHours();
  const day = date.getDay();
  const pool =
    h < 12
      ? ['Morning', 'Hey', 'Hi there']
      : h < 17
        ? ['Hey', 'Hi', 'Afternoon']
        : ['Hey', 'Hi', 'Evening'];
  return pool[(day + h) % pool.length];
}

function pickVariant(seed) {
  return Math.abs(Number(seed) || 0) % 3;
}

function planLabel(item) {
  if (!item) return 'that plan';
  const name = (item.plan_name || item.plan || '').trim();
  const cap = (item.cap_id || item.capId || '').trim();
  if (name && cap) return `${name} (${cap})`;
  return name || cap || 'that plan';
}

function shortPlanLabel(item) {
  const label = planLabel(item);
  return label.length > 36 ? `${label.slice(0, 33)}…` : label;
}

/** Most understaffed plan in the decision bucket (lowest sustained O/U). */
export function worstDecision(dec = []) {
  if (!dec.length) return null;
  return [...dec].sort((a, b) => (Number(a.sustained) || 0) - (Number(b.sustained) || 0))[0];
}

function gapFte(item) {
  const s = Number(item?.sustained);
  if (!Number.isFinite(s) || s >= -0.01) return null;
  return f2(Math.abs(s));
}

function autoReason(item) {
  const why = (item?.why || '').trim();
  if (why) return why.replace(/\s+/g, ' ');
  const sg = item?.shrink12;
  return sg != null ? `shrinkage plan at ${f2(sg)}%` : 'minor shrinkage drift';
}

function decSummary(dec = []) {
  const sorted = [...dec].sort((a, b) => (Number(a.sustained) || 0) - (Number(b.sustained) || 0));
  const lead = sorted[0];
  const gap = gapFte(lead);
  const label = shortPlanLabel(lead);
  if (dec.length === 1) {
    return { lead, label, gap, phrase: `${label}${gap ? `, about ${gap} FTE short` : ''}` };
  }
  if (dec.length === 2) {
    const second = sorted[1];
    const g2 = gapFte(second);
    return {
      lead,
      label,
      gap,
      phrase: `${label}${gap ? ` (${gap} FTE)` : ''} and ${shortPlanLabel(second)}${g2 ? ` (${g2} FTE)` : ''}`,
    };
  }
  const rest = dec.length - 1;
  return {
    lead,
    label,
    gap,
    phrase: `${label}${gap ? ` (${gap} FTE)` : ''}, plus ${rest} other${rest === 1 ? '' : 's'}`,
  };
}

function autoSummary(auto = []) {
  const lead = auto[0];
  const label = shortPlanLabel(lead);
  const reason = autoReason(lead);
  if (auto.length === 1) {
    return `${label} — ${reason}`;
  }
  return `${label} — ${reason}, and ${auto.length - 1} similar`;
}

/**
 * Spoken welcome from live triage buckets (`/api/triage`) + cycle label (`/api/cycle`).
 * Sentence shells vary for naturalness; every number and plan name comes from API data.
 */
export function buildWelcomeMessage({ cycleLabel, dec = [], auto = [], quiet = [], counts = {} } = {}) {
  const greeting = pickCasualGreeting();
  const when = cycleShort(cycleLabel);
  const decN = dec.length;
  const autoN = auto.length;
  const quietN = quiet.length || Number(counts.quiet) || 0;
  const total = Number(counts.total) || decN + autoN + quietN;
  const v = pickVariant(decN * 7 + autoN * 3 + quietN + total);

  if (decN > 0) {
    const { lead, label, gap, phrase } = decSummary(dec);
    const cap = lead?.cap_id || lead?.capId;

    const urgent = [
      `${greeting}. For ${when}, ${decN} plan${decN === 1 ? '' : 's'} need you — ${phrase}. Want me to open ${cap ? cap : label}?`,
      `${greeting} — I'd start with ${label}${gap ? `, roughly ${gap} FTE under` : ''}${decN > 1 ? `; ${decN - 1} more waiting` : ''}. Say the word and I'll pull it up.`,
      `${greeting}. The tightest spot is ${phrase}. Happy to walk you through ${cap ? cap : 'it'} whenever you're ready.`,
    ];
    return urgent[v];
  }

  if (autoN > 0) {
    const detail = autoSummary(auto);
    const calm = [
      `${greeting}. No decisions for ${when} — ${quietN} plan${quietN === 1 ? '' : 's'} look fine. Worth a look: ${detail}.`,
      `${greeting} — you're in decent shape; ${quietN} on track. Autopilot flagged ${detail}.`,
      `${greeting}. Clean on staffing — ${quietN} plan${quietN === 1 ? '' : 's'} folded away. ${autoN} shrinkage check${autoN === 1 ? '' : 's'}: ${detail}.`,
    ];
    return calm[v];
  }

  const easy = [
    `${greeting}. ${total > 0 ? `All ${total} plans` : 'The portfolio'} look good for ${when} — nothing needs you right now.`,
    `${greeting} — quiet cycle. ${quietN > 0 ? `${quietN} plan${quietN === 1 ? '' : 's'} inside tolerance` : 'Everything inside tolerance'}. Holler if you want to dig in.`,
    `${greeting}. You're clear for ${when}. No gaps, no shrinkage flags — just tell me if you want to open something.`,
  ];
  return easy[v];
}

export function timeOfDayGreeting(date = new Date()) {
  return pickCasualGreeting(date);
}
