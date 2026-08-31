/** Instant acknowledgment intent — only for queries that may need lookup time. */

const GREETING_RE = /^(hi|hey|hello|yo|sup|hiya|howdy|thanks|thank you|ok|okay|good morning|good afternoon|good evening)[!.?\s]*$/i;
const SHORT_GREETING_RE = /^(hi|hey|hello|good morning|good afternoon)\b/i;

export function pickFillerIntent(message) {
  const text = (message || '').trim();
  if (!text || text.length < 8) return null;
  if (GREETING_RE.test(text)) return null;

  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).length;

  if (SHORT_GREETING_RE.test(lower) && words <= 5) {
    if (!/\b(what|how|show|open|worst|plan|portfolio|need|attention)\b/.test(lower)) return null;
  }

  if (/\b(what is|what's|explain|tell me about|how does|why does|define|describe)\b/.test(lower)) {
    return 'lookup';
  }
  if (/\b(worst|urgent|attention|decide|triage|gap|shortage|portfolio|compare|side.by.side)\b/.test(lower)) {
    return 'portfolio';
  }
  if (/\b(open|show me|filter|go to|navigate|switch to|pull up)\b/.test(lower)) {
    return 'navigate';
  }
  if (/\b(set|adjust|map|execute|submit|attach|upload|change|update|increase|decrease|shrink)\b/.test(lower)) {
    return 'action';
  }

  return null;
}

export function fillerUrlForMessage(message) {
  const intent = pickFillerIntent(message);
  if (!intent) return null;
  return `/api/voice/filler/${intent}`;
}
