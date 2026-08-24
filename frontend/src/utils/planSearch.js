/** Shared portfolio search — matches plan rows, triage items, and queue packages. */

export function normalizeSearchQuery(query) {
  return (query || '').trim().toLowerCase();
}

export function planSearchFields(item) {
  if (!item) return [];
  return [
    item.plan,
    item.plan_name,
    item.capId,
    item.cap_id,
    item.program,
    item.lob,
    item.site,
    item.planner,
    item.region,
    item.vertical,
    item.why,
    item.description,
    item.tag,
  ].filter(Boolean);
}

export function matchesPlanSearch(item, query) {
  const q = normalizeSearchQuery(query);
  if (!q) return true;
  return planSearchFields(item).some((field) => String(field).toLowerCase().includes(q));
}

export function searchScore(item, query) {
  const q = normalizeSearchQuery(query);
  if (!q) return 0;

  const cap = String(item.capId || item.cap_id || '').toLowerCase();
  const name = String(item.plan || item.plan_name || '').toLowerCase();
  const program = String(item.program || '').toLowerCase();

  if (cap === q) return 100;
  if (cap.startsWith(q)) return 92;
  if (name === q) return 88;
  if (name.startsWith(q)) return 84;
  if (program.startsWith(q)) return 70;
  if (planSearchFields(item).some((f) => String(f).toLowerCase().startsWith(q))) return 60;
  if (matchesPlanSearch(item, q)) return 40;
  return 0;
}

export function filterPlans(plans, { query, program = 'all' } = {}) {
  return (plans || []).filter((p) => {
    if (program && program !== 'all' && p.program !== program) return false;
    return matchesPlanSearch(p, query);
  });
}

export function searchPlans(plans, query, { program = 'all', limit = 8 } = {}) {
  return filterPlans(plans, { query, program })
    .map((p) => ({ plan: p, score: searchScore(p, query) }))
    .sort((a, b) => b.score - a.score || (a.plan.sustained ?? 0) - (b.plan.sustained ?? 0))
    .slice(0, limit)
    .map((x) => x.plan);
}
