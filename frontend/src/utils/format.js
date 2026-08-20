export const f2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
export const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

export function hm(m) {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? `${h}h ${r < 10 ? '0' : ''}${r}m` : `${r}m`;
}

export function reqOf(billable, shrinkPct) {
  return billable / (1 - shrinkPct / 100);
}
