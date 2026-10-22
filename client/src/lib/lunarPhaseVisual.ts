export function clampLunarIllumination(illuminationPct: number) {
  if (!Number.isFinite(illuminationPct)) return 0;
  return Math.max(0, Math.min(100, illuminationPct));
}

/**
 * Returns the unlit part of a spherical Moon projected onto a circular disk.
 * The illuminated limb faces right before the SVG is rotated to its computed
 * bright-limb position angle. Unlike a conic wedge, the terminator is curved.
 */
export function getLunarShadowPath(illuminationPct: number) {
  const illumination = clampLunarIllumination(illuminationPct) / 100;
  if (illumination >= 1) return null;

  const phaseAngle = Math.acos(2 * illumination - 1);
  const terminatorRadiusX = Math.round(Math.abs(Math.cos(phaseAngle)) * 5_000) / 100;
  const terminatorSweep = phaseAngle < Math.PI / 2 ? 1 : 0;

  return `M 50 0 A 50 50 0 0 0 50 100 A ${terminatorRadiusX} 50 0 0 ${terminatorSweep} 50 0 Z`;
}

/** Converts the local angle (zenith toward east) to clockwise SVG rotation; east is left in this sky-chart view. */
export function getLunarShadowTransform(brightLimbAngleDeg: number) {
  const normalized = ((270 - brightLimbAngleDeg) % 360 + 360) % 360;
  return `rotate(${Math.round(normalized * 10) / 10} 50 50)`;
}
