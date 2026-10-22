export const TEMPERATURE_LABEL_ABOVE_GAP = 28;
export const TEMPERATURE_LABEL_BELOW_GAP = 30;
export const TEMPERATURE_WIND_CLEARANCE = 20;

export function getLabelAboveCurveY(curveY: number, tempZoneTop: number, offset = TEMPERATURE_LABEL_ABOVE_GAP): number {
  return Math.max(tempZoneTop + 18, curveY - offset);
}

export function getLabelBelowCurveY(
  curveY: number,
  tempZoneTop: number,
  windZoneTop: number,
  offset = TEMPERATURE_LABEL_BELOW_GAP,
  windClearance = TEMPERATURE_WIND_CLEARANCE,
): number {
  return Math.min(Math.max(curveY + offset, tempZoneTop + 32), windZoneTop - windClearance);
}

export function getFeltLabelY(windZoneTop: number): number {
  return windZoneTop - 8;
}
