export type CurrentModelReference = {
  id: string;
  name: string;
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windGust: number | null;
  windDirection: number | null;
  precipitation: number | null;
  updatedAt: string | null;
};

export type ModelReferenceCoherence = CurrentModelReference & {
  localTemperature: number | null;
  localStationCount: number;
  localDeltaC: number | null;
  ensembleDeltaC: number | null;
  coherenceWeight: number | null;
  coherenceStatus: "measured" | "unavailable";
};

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Mesure l’accord instantané sans modifier la fusion météo. Le coefficient est
 * volontairement un indicateur d’ordre et de transparence : aucun modèle ne
 * peut influencer la température locale avant validation historique.
 */
export function buildModelReferenceCoherence(
  references: CurrentModelReference[],
  physicalTemperatures: number[],
): ModelReferenceCoherence[] {
  const modelTemperatures = references
    .map((reference) => reference.temperature)
    .filter((temperature): temperature is number => temperature !== null);
  const localTemperature = physicalTemperatures.length > 0
    ? physicalTemperatures.reduce((sum, temperature) => sum + temperature, 0) / physicalTemperatures.length
    : null;
  const ensembleTemperature = modelTemperatures.length > 0 ? median(modelTemperatures) : null;

  return references.map((reference) => {
    if (reference.temperature === null || localTemperature === null || ensembleTemperature === null) {
      return {
        ...reference,
        localTemperature: localTemperature === null ? null : Math.round(localTemperature * 10) / 10,
        localStationCount: physicalTemperatures.length,
        localDeltaC: null,
        ensembleDeltaC: reference.temperature === null || ensembleTemperature === null ? null : Math.round((reference.temperature - ensembleTemperature) * 10) / 10,
        coherenceWeight: null,
        coherenceStatus: "unavailable" as const,
      };
    }

    const localDeltaC = reference.temperature - localTemperature;
    const ensembleDeltaC = reference.temperature - ensembleTemperature;
    const localAgreement = Math.exp(-Math.abs(localDeltaC) / 2);
    const ensembleAgreement = Math.exp(-Math.abs(ensembleDeltaC) / 1.5);
    const coherenceWeight = Math.round((localAgreement * 0.75 + ensembleAgreement * 0.25) * 100) / 100;

    return {
      ...reference,
      localTemperature: Math.round(localTemperature * 10) / 10,
      localStationCount: physicalTemperatures.length,
      localDeltaC: Math.round(localDeltaC * 10) / 10,
      ensembleDeltaC: Math.round(ensembleDeltaC * 10) / 10,
      coherenceWeight,
      coherenceStatus: "measured" as const,
    };
  }).sort((left, right) => (right.coherenceWeight ?? -1) - (left.coherenceWeight ?? -1));
}
