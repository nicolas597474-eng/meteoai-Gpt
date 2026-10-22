export const GROUND_TRUTH_REFERENCE_TOLERANCE = 0.001;

export function getGroundTruthReferenceBounds(value: number) {
  return {
    min: value - GROUND_TRUTH_REFERENCE_TOLERANCE,
    max: value + GROUND_TRUTH_REFERENCE_TOLERANCE,
  };
}
