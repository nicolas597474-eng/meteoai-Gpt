import { buildNormalizedSpatialWeights } from "./spatialFusionCore";

export type LocalHistoryReading = {
  stationId: string;
  observedAt: number;
  temperature: number | null;
  distanceKm: number;
  reliabilityScore: number;
};

export type OfficialHourlyTemperaturePoint = {
  validAt: number;
  temperature: number | null;
};

/**
 * Point officiel reconstruit depuis une capture archivée. `availableAt` est
 * l'instant auquel cette capture est devenue disponible, pas le validAt de la
 * prévision. Le raccordeur fournit un point par capture/run.
 */
export type AvailableOfficialHourlyTemperaturePoint = OfficialHourlyTemperaturePoint & {
  availableAt: number | null;
};

export type LocalOfficialForecastSelection = {
  validAt: number;
  /** Première mesure physique comparable de l'heure UTC concernée. */
  earliestPhysicalMeasurementAt: number;
  status: "selected" | "unavailable";
  reason: "selected_before_measurement" | "forecast_missing" | "forecast_availability_unknown" | "forecast_available_after_measurement";
  forecast: AvailableOfficialHourlyTemperaturePoint | null;
};

export type LocalOfficialDeltaPoint = {
  key: string;
  label: string;
  validAt: number;
  observedAt: string;
  localTemperature: number;
  officialTemperature: number;
  deltaC: number;
  stationCount: number;
};

function formatParisHour(timestamp: number) {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(new Date(timestamp));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "??";
  const timeZone = parts.find((part) => part.type === "timeZoneName")?.value;
  return timeZone ? `${hour}h ${timeZone}` : `${hour}h`;
}

function hourStartAt(timestamp: number): number {
  return Math.floor(timestamp / 3_600_000) * 3_600_000;
}

/**
 * Sélection anti-fuite pour le panneau local/officiel historique. Pour chaque
 * heure UTC ayant une mesure physique, seul le dernier point officiel déjà
 * disponible *strictement avant* la première mesure de cette heure est retenu.
 *
 * Cette fonction est pure et ne reconstruit pas les runs : le raccordeur doit
 * lui passer une série de points par capture, avec leur `availableAt` réel. Une
 * disponibilité absente ou égale/postérieure à la mesure échoue fermée afin de
 * ne jamais afficher une comparaison rétrospective.
 */
export function selectOfficialHourlyTemperaturesBeforeLocalMeasurements(
  readings: readonly LocalHistoryReading[],
  forecastCandidates: readonly AvailableOfficialHourlyTemperaturePoint[],
): LocalOfficialForecastSelection[] {
  const earliestMeasurementByValidAt = new Map<number, number>();
  for (const reading of readings) {
    if (reading.temperature == null || !Number.isFinite(reading.temperature) || !Number.isFinite(reading.observedAt)) continue;
    const validAt = hourStartAt(reading.observedAt);
    const earliest = earliestMeasurementByValidAt.get(validAt);
    if (earliest == null || reading.observedAt < earliest) earliestMeasurementByValidAt.set(validAt, reading.observedAt);
  }

  return Array.from(earliestMeasurementByValidAt.entries())
    .sort(([left], [right]) => left - right)
    .map(([validAt, earliestPhysicalMeasurementAt]) => {
      const candidates = forecastCandidates.filter((candidate) => candidate.validAt === validAt);
      const withKnownAvailability = candidates.filter((candidate) =>
        candidate.availableAt != null && Number.isFinite(candidate.availableAt),
      );
      const eligible = withKnownAvailability
        .filter((candidate) => candidate.availableAt! < earliestPhysicalMeasurementAt)
        .sort((left, right) => right.availableAt! - left.availableAt!);
      const forecast = eligible[0] ?? null;
      if (forecast) {
        return {
          validAt,
          earliestPhysicalMeasurementAt,
          status: "selected" as const,
          reason: "selected_before_measurement" as const,
          forecast,
        };
      }
      return {
        validAt,
        earliestPhysicalMeasurementAt,
        status: "unavailable" as const,
        reason: candidates.length === 0
          ? "forecast_missing"
          : withKnownAvailability.length === 0
            ? "forecast_availability_unknown"
            : "forecast_available_after_measurement",
        forecast: null,
      };
    });
}

/**
 * Adaptateur pur prêt pour le panneau : après sélection stricte, n'expose que
 * les températures finies. Les indisponibilités restent lisibles via le
 * sélecteur ci-dessus pour que le routeur puisse en préserver la provenance.
 */
export function selectedOfficialHourlyTemperaturePoints(
  selections: readonly LocalOfficialForecastSelection[],
): OfficialHourlyTemperaturePoint[] {
  return selections.flatMap((selection) => {
    const forecast = selection.forecast;
    return selection.status === "selected" && forecast?.temperature != null && Number.isFinite(forecast.temperature)
      ? [{ validAt: selection.validAt, temperature: forecast.temperature }]
      : [];
  });
}

/**
 * Compares admitted physical observations only with the already-computed official
 * seven-model hourly series. Both sides are aligned by UTC hour, so the repeated
 * local hour at the autumn DST transition remains two distinct observations.
 */
export function buildLocalOfficialDeltaHistory(
  readings: LocalHistoryReading[],
  officialForecasts: OfficialHourlyTemperaturePoint[],
): LocalOfficialDeltaPoint[] {
  const officialByValidAt = new Map<number, number>();
  for (const forecast of officialForecasts) {
    if (Number.isFinite(forecast.validAt) && forecast.temperature != null && Number.isFinite(forecast.temperature)) {
      officialByValidAt.set(forecast.validAt, forecast.temperature);
    }
  }

  const byValidAt = new Map<number, LocalHistoryReading[]>();
  for (const reading of readings) {
    if (reading.temperature == null || !Number.isFinite(reading.temperature) || !Number.isFinite(reading.observedAt)) continue;
    const validAt = hourStartAt(reading.observedAt);
    if (!officialByValidAt.has(validAt)) continue;
    const group = byValidAt.get(validAt) ?? [];
    group.push(reading);
    byValidAt.set(validAt, group);
  }

  return Array.from(byValidAt.entries())
    .map(([validAt, group]) => {
      const officialTemperature = officialByValidAt.get(validAt);
      if (officialTemperature == null) return null;
      const validReadings = group.filter((reading) =>
        Number.isFinite(reading.distanceKm) && reading.distanceKm >= 0 && Number.isFinite(reading.reliabilityScore),
      );
      const weights = buildNormalizedSpatialWeights(
        validReadings.map((reading, index) => ({
          id: `${reading.stationId}:${index}`,
          distanceKm: reading.distanceKm,
          reliabilityScore: reading.reliabilityScore,
          updatedAt: new Date(reading.observedAt),
          temperature: reading.temperature,
        })),
        // Les mesures sont prises après le début de leur heure UTC. L'instant
        // de pondération doit donc être une mesure réellement observée, jamais
        // le validAt du créneau, sinon elles paraîtraient artificiellement
        // futures après le durcissement temporel du noyau spatial.
        { now: Math.max(...validReadings.map((reading) => reading.observedAt)) },
      );
      const weighted = weights.reduce((acc, weight, index) => ({
        sum: acc.sum + validReadings[index].temperature! * weight.finalWeight,
        weights: acc.weights + weight.finalWeight,
      }), { sum: 0, weights: 0 });
      if (weighted.weights <= 0) return null;
      const localTemperature = Math.round((weighted.sum / weighted.weights) * 10) / 10;
      const deltaC = Math.round((localTemperature - officialTemperature) * 10) / 10;
      const latestObservedAt = Math.max(...group.map((reading) => reading.observedAt));
      return {
        key: String(validAt),
        label: formatParisHour(validAt),
        validAt,
        observedAt: new Date(latestObservedAt).toISOString(),
        localTemperature,
        officialTemperature,
        deltaC,
        stationCount: new Set(group.map((reading) => reading.stationId)).size,
      };
    })
    .filter((point): point is LocalOfficialDeltaPoint => point !== null)
    .sort((left, right) => left.validAt - right.validAt);
}
