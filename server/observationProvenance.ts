export type ObservationProvenance = "physical_observation" | "model_reference" | "legacy_unqualified";

/** Only an explicitly qualified physical observation can update operational scores. */
export function isOperationalObservation(input: {
  provenanceType: ObservationProvenance;
  isQualified: number;
}): boolean {
  return input.provenanceType === "physical_observation" && input.isQualified === 1;
}
