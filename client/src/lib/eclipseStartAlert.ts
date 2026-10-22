export function isEclipseStartDue(startAt: string | null | undefined, endAt: string | null | undefined, nowMs = Date.now()) {
  if (!startAt || !endAt) return false;
  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= nowMs && nowMs <= endMs;
}
