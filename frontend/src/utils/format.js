export const f2 = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0.00';
  return (Math.round(v * 100) / 100).toFixed(2);
};
export const f1 = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0.0';
  return (Math.round(v * 10) / 10).toFixed(1);
};

export function hm(m) {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? `${h}h ${r < 10 ? '0' : ''}${r}m` : `${r}m`;
}

export function reqOf(billable, shrinkPct) {
  const b = Number(billable);
  const s = Number(shrinkPct);
  if (!Number.isFinite(b) || !Number.isFinite(s)) return 0;
  const denom = 1 - Math.min(99.5, Math.max(0, s)) / 100;
  if (denom <= 0.005) return b * 20;
  return Math.round((b / denom) * 100) / 100;
}
