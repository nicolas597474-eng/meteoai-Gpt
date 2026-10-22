export type StationDisplayStatus = "physical" | "reference" | "excluded";

type QualifiableStation = {
  isActive: boolean;
  source?: string | null;
  sourceKind?: "physical" | "reference";
  exclusionReason?: string | null;
};

/**
 * Statut affiché d'une station, partagé par le classement, la carte et les
 * badges : une seule définition du statut, donc aucune divergence possible
 * entre le compteur et la pastille.
 */
export function getStationDisplayStatus(station: {
  isActive: boolean;
  source?: string | null;
  sourceKind?: "physical" | "reference";
}): StationDisplayStatus {
  if (!station.isActive) return "excluded";
  return station.sourceKind === "physical" ? "physical" : "reference";
}

export type StationQualificationBadgeKind =
  | "official"
  | "excluded"
  | "netatmo"
  | "reference";

export type StationQualificationBadge = {
  kind: StationQualificationBadgeKind;
  label: string;
  /** Motif d'exclusion persisté, affiché tel quel : jamais réécrit ni inventé. */
  detail?: string;
};

/**
 * Badge de statut public : Station officielle, Station Netatmo, Référence de
 * modèle ou Exclu. Une station Netatmo n'est jamais étiquetée officielle.
 */
export function getStationQualificationBadge(station: QualifiableStation): StationQualificationBadge {
  const displayStatus = getStationDisplayStatus(station);
  if (displayStatus === "excluded") {
    return { kind: "excluded", label: "Exclu", ...(station.exclusionReason ? { detail: station.exclusionReason } : {}) };
  }
  if (displayStatus === "reference") {
    return { kind: "reference", label: "Référence de modèle" };
  }
  if (station.source === "netatmo") {
    return { kind: "netatmo", label: "Station Netatmo" };
  }
  return { kind: "official", label: "Station officielle" };
}
