export type CurrentStateFieldLike = {
  value: number | string | null;
  provenance: {
    kind:
      | "physical_stations"
      | "open_meteo_snapshot"
      | "official_hourly_forecast"
      | "unavailable";
    label: string;
    stationCount: number;
    stationSources: string[];
    /** Pour une prévision horaire, c’est l’échéance (validTime) affichée. */
    observedAt: string | null;
    ageMinutes: number | null;
    /** Prévision horaire officielle : instant de calcul du run affiché. */
    computedAt?: string | null;
    reason: string | null;
    measurements: Array<{
      stationName: string;
      source: string;
      observedAt: string;
      ageMinutes: number;
    }>;
  };
};

export type RegimeProvenanceInput = {
  source?: string | null;
  sourceLabel?: string | null;
  sourceUpdatedAt?: string | null;
  hasRegime: boolean;
  nowMs?: number;
};

function parsedTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parisTimeLabel(timestamp: number | null): string | null {
  return timestamp == null
    ? null
    : new Date(timestamp).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Paris",
      });
}

/** Use the separately loaded current Open-Meteo snapshot only when this field is absent. */
export function withCurrentSnapshotFallback(
  field: CurrentStateFieldLike | null | undefined,
  snapshotValue: number | string | null | undefined,
  snapshotAt?: string | null,
  nowMs = Date.now()
): CurrentStateFieldLike | null {
  const fieldValue = field?.value;
  const hasFieldValue =
    fieldValue !== null &&
    fieldValue !== undefined &&
    (typeof fieldValue !== "number" || Number.isFinite(fieldValue)) &&
    (typeof fieldValue !== "string" || fieldValue.trim().length > 0);
  if (hasFieldValue) return field ?? null;

  const hasSnapshotValue =
    snapshotValue !== null &&
    snapshotValue !== undefined &&
    (typeof snapshotValue !== "number" || Number.isFinite(snapshotValue)) &&
    (typeof snapshotValue !== "string" || snapshotValue.trim().length > 0);
  if (!hasSnapshotValue) return field ?? null;

  const capturedAt = parsedTimestamp(snapshotAt);
  return {
    value: snapshotValue,
    provenance: {
      kind: "open_meteo_snapshot",
      label: "Snapshot modèle Open-Meteo",
      stationCount: 0,
      stationSources: ["Open-Meteo"],
      observedAt: snapshotAt ?? null,
      ageMinutes:
        capturedAt != null && capturedAt <= nowMs
          ? Math.floor((nowMs - capturedAt) / 60_000)
          : null,
      reason:
        "Repli sur le snapshot courant Open-Meteo : le champ consolidé n’était pas disponible.",
      measurements: [],
    },
  };
}

function formatAgeMinutes(age: number | null): string {
  if (age == null || !Number.isFinite(age) || age < 0) return "âge inconnu";
  if (age === 0) return "à l’instant";
  return `il y a ${age} min`;
}

/** Affiche une valeur arrondie sans modifier la valeur météo conservée en mémoire. */
export function formatDashboardNumber(
  value: number | null | undefined,
  maximumFractionDigits = 1
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits }).format(
    value
  );
}

/** La provenance et la fraîcheur visibles proviennent du champ lui-même. */
export function formatCurrentStateProvenance(
  field?: CurrentStateFieldLike | null,
  snapshotAt?: string | null,
  nowMs = Date.now()
): string {
  const provenance = field?.provenance;
  const observedAt = provenance?.observedAt ?? snapshotAt ?? null;
  const parsedAt = parsedTimestamp(observedAt);
  const age = provenance
    ? provenance.ageMinutes
    : parsedAt != null && parsedAt <= nowMs
      ? Math.floor((nowMs - parsedAt) / 60_000)
      : null;
  const ageLabel = formatAgeMinutes(age);
  const timeLabel = parisTimeLabel(parsedAt);

  if (!provenance) {
    return timeLabel
      ? `Open-Meteo · ${timeLabel} · ${ageLabel}`
      : "Source/horodatage indisponible";
  }
  if (provenance.kind === "physical_stations") {
    const sources =
      provenance.stationSources.join(" + ") || "stations physiques";
    const stationLabel = `${provenance.stationCount} station${provenance.stationCount > 1 ? "s" : ""}`;
    const oldestAge = `plus ancien : ${ageLabel}`;
    return `${stationLabel} · ${sources} · ${oldestAge}${timeLabel ? ` · relevé à ${timeLabel}` : ""}`;
  }
  if (provenance.kind === "open_meteo_snapshot") {
    return `Open-Meteo · ${timeLabel ?? "heure inconnue"} · ${ageLabel}`;
  }
  if (provenance.kind === "official_hourly_forecast") {
    const source = provenance.stationSources.join(" + ") || "Source non documentée";
    const computedLabel = parisTimeLabel(parsedTimestamp(provenance.computedAt));
    return `Prévu · ${source} · ${timeLabel ?? "échéance inconnue"}${computedLabel ? ` · calcul ${computedLabel}` : ""}`;
  }
  return "Indisponible";
}

/** Renvoie le libellé et l’heure de la source réellement retenue pour le régime. */
export function getRegimeProvenancePresentation(input: RegimeProvenanceInput) {
  const suppliedLabel = input.sourceLabel?.trim() || null;
  let sourceLabel = suppliedLabel ?? "Source du régime non indiquée";

  if (input.source === "official_snapshot" && !input.hasRegime) {
    sourceLabel = "Snapshot officiel · régime indisponible";
  } else if (input.source === "official_snapshot" && !suppliedLabel) {
    sourceLabel = "Snapshot officiel";
  } else if (input.source === "hourly_forecast_partial" && !suppliedLabel) {
    sourceLabel = "Prévision horaire partielle · régime non calculé";
  } else if (input.source === "hourly_forecast" && !suppliedLabel) {
    sourceLabel = "Prévision horaire actualisée";
  } else if (input.source === "fresh_observation" && !suppliedLabel) {
    sourceLabel = "Observation récente validée";
  }

  const timestamp = parsedTimestamp(input.sourceUpdatedAt);
  const nowMs = input.nowMs ?? Date.now();
  if (timestamp == null || timestamp > nowMs) {
    return {
      sourceLabel,
      sourceTimeLabel: null,
      freshnessLabel: "Horodatage de source indisponible",
    };
  }

  const ageMinutes = Math.floor((nowMs - timestamp) / 60_000);
  const freshnessLabel =
    ageMinutes === 0
      ? "mis à jour à l’instant"
      : `mis à jour il y a ${ageMinutes} min`;
  return {
    sourceLabel,
    sourceTimeLabel: parisTimeLabel(timestamp),
    freshnessLabel,
  };
}
