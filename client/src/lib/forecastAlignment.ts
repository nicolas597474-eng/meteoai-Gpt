import type { HourlyFusionTrace, HourlyPrecipitationAgreementTrace } from "@shared/hourlyModelMetrics";

export type AlignmentStatus = "comparable" | "non_comparable" | "unavailable";

export type ForecastAlignmentReadModel = {
  timeZone: string;
  coordinates: { lat: number; lon: number };
  assembledAt: string;
  currentSnapshotSource: { sourceKind: "model_current_snapshot"; source: string };
  currentSnapshot: {
    sourceKind: "model_current_snapshot";
    source: string;
    capturedAt: string;
    temp: number | null;
  } | null;
  hourlyForecast: {
    sourceKind: string;
    source: string;
    computedAt: string;
    modelsConsidered: string[];
    bestMatchIncluded: boolean;
    points: Array<{
      date: string | null;
      hour: string;
      validAt: number | null;
      temp: number | null;
      finalValues: Array<{ variable: string; value: number | null; unit: string }>;
      modelsWithData: string[];
      weighting?: HourlyFusionTrace | null;
      precipitationAgreement?: HourlyPrecipitationAgreementTrace | null;
    }>;
  };
  dailyForecast: {
    source: string;
    computedAt: string;
    modelsUsed: string[];
    days: Array<{ date: string; tempMax: number | null; tempMin: number | null }>;
  };
};

export type ForecastAlignmentReport = {
  locationAligned: boolean;
  timeZoneAligned: boolean;
  unavailableReason: string | null;
  snapshotVsHourly: {
    status: AlignmentStatus;
    reason: string;
    snapshotAt: string | null;
    snapshotTemp: number | null;
    hourlyAt: number | null;
    hourlyTemp: number | null;
    hourlyModelsWithData: string[];
    difference: number | null;
  };
  snapshotVsDaily: {
    status: AlignmentStatus;
    reason: string;
    snapshotAt: string | null;
    snapshotTemp: number | null;
    dailyDate: string | null;
    dailyTempMin: number | null;
    dailyTempMax: number | null;
  };
  hourlyVsDaily: Array<{
    date: string;
    status: AlignmentStatus;
    reason: string;
    coveredHours: number;
    expectedHours: number;
    hourlyTempMin: number | null;
    hourlyTempMax: number | null;
    dailyTempMin: number | null;
    dailyTempMax: number | null;
    differenceMin: number | null;
    differenceMax: number | null;
  }>;
};

const PARIS_TIME_ZONE = "Europe/Paris";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const parisDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PARIS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function finiteValue(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function localParisDate(timestamp: number): string | null {
  if (!Number.isFinite(timestamp)) return null;
  const fields = Object.fromEntries(
    parisDateFormatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]),
  );
  if (!fields.year || !fields.month || !fields.day) return null;
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
}

/** Returns every absolute hourly instant belonging to a Europe/Paris local day. */
export function getExpectedParisHourTimestamps(date: string): number[] {
  if (!isCalendarDate(date)) return [];
  const anchor = Date.parse(`${date}T00:00:00.000Z`);
  const expected: number[] = [];
  for (let timestamp = anchor - DAY_MS; timestamp < anchor + 2 * DAY_MS; timestamp += HOUR_MS) {
    if (localParisDate(timestamp) === date) expected.push(timestamp);
  }
  return expected;
}

function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function emptyReport(reason: string, locationAligned: boolean, timeZoneAligned: boolean): ForecastAlignmentReport {
  return {
    locationAligned,
    timeZoneAligned,
    unavailableReason: reason,
    snapshotVsHourly: {
      status: "non_comparable",
      reason,
      snapshotAt: null,
      snapshotTemp: null,
      hourlyAt: null,
      hourlyTemp: null,
      hourlyModelsWithData: [],
      difference: null,
    },
    snapshotVsDaily: {
      status: "non_comparable",
      reason,
      snapshotAt: null,
      snapshotTemp: null,
      dailyDate: null,
      dailyTempMin: null,
      dailyTempMax: null,
    },
    hourlyVsDaily: [],
  };
}

export function buildForecastAlignmentReport(
  data: ForecastAlignmentReadModel,
  requestedLocation?: { lat: number; lon: number } | null,
): ForecastAlignmentReport {
  const locationAligned = !requestedLocation || (
    data.coordinates.lat === requestedLocation.lat && data.coordinates.lon === requestedLocation.lon
  );
  const timeZoneAligned = data.timeZone === PARIS_TIME_ZONE;
  if (!locationAligned || !timeZoneAligned) {
    const reason = !locationAligned
      ? "Les données chargées ne correspondent pas au lieu actif ; aucune valeur n’est rapprochée."
      : "Le fuseau horaire de ces données n’est pas Europe/Paris ; aucune valeur n’est rapprochée.";
    return emptyReport(reason, locationAligned, timeZoneAligned);
  }

  const currentSnapshot = data.currentSnapshot;
  const snapshotTimestamp = parseInstant(currentSnapshot?.capturedAt);
  const snapshotDate = snapshotTimestamp == null ? null : localParisDate(snapshotTimestamp);
  const snapshotTemp = finiteValue(currentSnapshot?.temp);
  const hourlyCandidates = snapshotDate == null
    ? []
    : data.hourlyForecast.points
      .filter((point) => Number.isFinite(point.validAt) && localParisDate(point.validAt as number) === snapshotDate)
      .sort((left, right) => Math.abs((left.validAt as number) - (snapshotTimestamp as number)) - Math.abs((right.validAt as number) - (snapshotTimestamp as number)));
  const exactHourlyPoint = snapshotTimestamp == null
    ? undefined
    : hourlyCandidates.find((point) => point.validAt === snapshotTimestamp);
  const displayedHourlyPoint = exactHourlyPoint ?? hourlyCandidates[0];
  const displayedHourlyTemp = finiteValue(displayedHourlyPoint?.temp);

  let snapshotVsHourlyStatus: AlignmentStatus = "unavailable";
  let snapshotVsHourlyReason = "Le snapshot courant, son horodatage ou la série horaire est indisponible.";
  let snapshotHourlyDifference: number | null = null;
  if (currentSnapshot && snapshotTimestamp != null && data.hourlyForecast.points.length > 0) {
    if (!displayedHourlyPoint) {
      snapshotVsHourlyStatus = "non_comparable";
      snapshotVsHourlyReason = "Aucune échéance horaire n’est disponible pour la date locale du snapshot.";
    } else if (displayedHourlyPoint.validAt !== snapshotTimestamp) {
      snapshotVsHourlyStatus = "non_comparable";
      snapshotVsHourlyReason = "Les deux valeurs ont des instants de validité distincts ; aucun écart n’est calculé.";
    } else if (snapshotTemp == null || displayedHourlyTemp == null) {
      snapshotVsHourlyStatus = "unavailable";
      snapshotVsHourlyReason = "L’instant s’aligne, mais une température manque.";
    } else {
      snapshotVsHourlyStatus = "comparable";
      snapshotVsHourlyReason = "Même lieu et même instant Europe/Paris ; écart brut de température uniquement.";
      snapshotHourlyDifference = displayedHourlyTemp - snapshotTemp;
    }
  }

  const matchingDaily = snapshotDate == null
    ? undefined
    : data.dailyForecast.days.find((day) => day.date === snapshotDate);
  let snapshotVsDailyStatus: AlignmentStatus = "unavailable";
  let snapshotVsDailyReason = "Aucune prévision quotidienne horodatée au même jour local n’est disponible.";
  if (currentSnapshot && snapshotTimestamp != null && matchingDaily) {
    snapshotVsDailyStatus = "non_comparable";
    snapshotVsDailyReason = "Une température instantanée de snapshot n’a pas la même sémantique que les Tmin/Tmax d’une journée.";
  }

  const hourlyVsDaily = data.dailyForecast.days.flatMap((day) => {
    const expectedTimestamps = getExpectedParisHourTimestamps(day.date);
    if (expectedTimestamps.length === 0) return [];
    const pointsOnLocalDate = data.hourlyForecast.points.filter((point) => (
      Number.isFinite(point.validAt) && localParisDate(point.validAt as number) === day.date
    ));
    if (pointsOnLocalDate.length === 0) return [];

    const expectedSet = new Set(expectedTimestamps);
    const pointsByInstant = new Map<number, typeof pointsOnLocalDate>();
    for (const point of pointsOnLocalDate) {
      const timestamp = point.validAt as number;
      if (!expectedSet.has(timestamp)) continue;
      const points = pointsByInstant.get(timestamp) ?? [];
      points.push(point);
      pointsByInstant.set(timestamp, points);
    }

    const coveredTimestamps = expectedTimestamps.filter((timestamp) => {
      const points = pointsByInstant.get(timestamp);
      return points?.length === 1 && finiteValue(points[0]?.temp) != null;
    });
    const duplicateTimestamp = Array.from(pointsByInstant.values()).some((points) => points.length > 1);
    const availableHourlyValues = Array.from(pointsByInstant.values())
      .flat()
      .map((point) => finiteValue(point.temp))
      .filter((value): value is number => value != null);
    const hourlyTempMin = availableHourlyValues.length > 0 ? Math.min(...availableHourlyValues) : null;
    const hourlyTempMax = availableHourlyValues.length > 0 ? Math.max(...availableHourlyValues) : null;
    const dailyTempMin = finiteValue(day.tempMin);
    const dailyTempMax = finiteValue(day.tempMax);
    const fullCoverage = expectedTimestamps.length > 0
      && coveredTimestamps.length === expectedTimestamps.length
      && !duplicateTimestamp;
    const differenceMin = fullCoverage && hourlyTempMin != null && dailyTempMin != null
      ? hourlyTempMin - dailyTempMin
      : null;
    const differenceMax = fullCoverage && hourlyTempMax != null && dailyTempMax != null
      ? hourlyTempMax - dailyTempMax
      : null;
    const hasComparableDailyExtrema = differenceMin != null || differenceMax != null;
    const status: AlignmentStatus = fullCoverage
      ? hasComparableDailyExtrema ? "comparable" : "unavailable"
      : "non_comparable";
    const reason = fullCoverage
      ? hasComparableDailyExtrema
        ? "Même lieu, même date Europe/Paris et couverture horaire complète ; les différences restent descriptives."
        : "La couverture horaire est complète, mais les extrema quotidiens nécessaires sont indisponibles."
      : duplicateTimestamp
        ? "Au moins une échéance horaire est dupliquée ; aucun écart journalier n’est calculé."
        : `Couverture horaire incomplète (${coveredTimestamps.length}/${expectedTimestamps.length} échéances locales) ; aucun écart journalier n’est calculé.`;

    return [{
      date: day.date,
      status,
      reason,
      coveredHours: coveredTimestamps.length,
      expectedHours: expectedTimestamps.length,
      hourlyTempMin,
      hourlyTempMax,
      dailyTempMin,
      dailyTempMax,
      differenceMin,
      differenceMax,
    }];
  });

  return {
    locationAligned,
    timeZoneAligned,
    unavailableReason: null,
    snapshotVsHourly: {
      status: snapshotVsHourlyStatus,
      reason: snapshotVsHourlyReason,
      snapshotAt: currentSnapshot?.capturedAt ?? null,
      snapshotTemp,
      hourlyAt: displayedHourlyPoint?.validAt ?? null,
      hourlyTemp: displayedHourlyTemp,
      hourlyModelsWithData: displayedHourlyPoint?.modelsWithData ?? [],
      difference: snapshotHourlyDifference,
    },
    snapshotVsDaily: {
      status: snapshotVsDailyStatus,
      reason: snapshotVsDailyReason,
      snapshotAt: currentSnapshot?.capturedAt ?? null,
      snapshotTemp,
      dailyDate: matchingDaily?.date ?? null,
      dailyTempMin: finiteValue(matchingDaily?.tempMin),
      dailyTempMax: finiteValue(matchingDaily?.tempMax),
    },
    hourlyVsDaily,
  };
}
