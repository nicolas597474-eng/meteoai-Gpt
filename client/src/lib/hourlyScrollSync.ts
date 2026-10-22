export function clampHourIndex(index: number, hourCount: number) {
  return Math.max(0, Math.min(Math.max(hourCount - 1, 0), index));
}

export function getNearestHourIndex(scrollLeft: number, hourStride: number, hourCount: number) {
  if (hourCount <= 1 || hourStride <= 0) return 0;
  return clampHourIndex(Math.round(scrollLeft / hourStride), hourCount);
}

export function getHourScrollLeft(hourIndex: number, hourStride: number, hourCount: number) {
  return clampHourIndex(hourIndex, hourCount) * Math.max(hourStride, 0);
}

export function getHourCenterX(hourIndex: number, hourStride: number, cardWidth: number, hourCount: number) {
  return getHourScrollLeft(hourIndex, hourStride, hourCount) + Math.max(cardWidth, 0) / 2;
}

export function getCenteredHourScrollLeft(
  hourIndex: number,
  hourStride: number,
  cardWidth: number,
  hourCount: number,
  viewportWidth: number,
) {
  const contentWidth = Math.max(hourCount * hourStride, 0);
  const maxScrollLeft = Math.max(0, contentWidth - Math.max(viewportWidth, 0));
  const idealScrollLeft = getHourCenterX(hourIndex, hourStride, cardWidth, hourCount) - viewportWidth / 2;
  return Math.max(0, Math.min(maxScrollLeft, idealScrollLeft));
}

export function getNearestCenteredHourIndex(
  scrollLeft: number,
  viewportWidth: number,
  hourStride: number,
  cardWidth: number,
  hourCount: number,
) {
  if (hourCount <= 1 || hourStride <= 0) return 0;
  const contentCenter = Math.max(0, scrollLeft) + Math.max(0, viewportWidth) / 2;
  return clampHourIndex(Math.round((contentCenter - cardWidth / 2) / hourStride), hourCount);
}
