import { buildNormalizedSpatialWeights } from "./spatialFusionCore";
import { calculateUltraLocal, getUltraLocalConfig } from "./ultraLocalService";
import { getPhysicalActiveStations, getStationSourceKind, type StationData, type StationSource } from "./stationService";
import type { CurrentWeatherSnapshot } from "./weatherServices";
import { getStationMeasurementAgeState, hasFreshStationMeasurement } from "./stationMeasurementFreshness";

export type CurrentDashboardFieldKey =
  | "temperature"
  | "apparentTemperature"
  | "precipitation"
  | "windSpeed"
  | "windGust"
  | "windDirection"
  | "cloudCover"
  | "humidity"
  | "weatherCode"
  | "condition"
  | "pressure";

export type CurrentDashboardField = {
  value: number | string | null;
  /** Raw finite station observations, including those with unknown/stale field age. */
  observations?: Array<{
    stationId: string;
    stationName: string;
    source: StationSource;
    value: number;
    observedAt: string | null;
    ageMinutes: number | null;
    ageStatus: "known" | "unknown";
    contributes: boolean;
  }>;
  provenance: {
    kind: "physical_stations" | "open_meteo_snapshot" | "unavailable";
    label: string;
    stationCount: number;
    stationSources: string[];
    /** For model fields, this is the provider snapshot instant. */
    observedAt: string | null;
    /** For a station aggregate, age of the oldest contributing field measurement. */
    ageMinutes: number | null;
    reason: string | null;
    measurements: Array<{
      stationId: string;
      stationName: string;
      source: StationSource;
      observedAt: string;
      ageMinutes: number;
    }>;
  };
};

export type CurrentDashboardWeatherState = {
  computedAt: string;
  fields: Record<CurrentDashboardFieldKey, CurrentDashboardField>;
};

const LOCAL_CONFIG = getUltraLocalConfig("local").config;
const MAX_LOCAL_FRESHNESS_MINUTES = LOCAL_CONFIG.maxFreshnessMin;
const MAX_LOCAL_DISTANCE_KM = Math.max(...LOCAL_CONFIG.radiusBands.map((band) => band.maxKm));
const MIN_LOCAL_SOURCE_RELIABILITY = LOCAL_CONFIG.minReliability;
const SOURCE_LABELS: Record<StationSource, string> = {
  meteofrance: "Météo-France",
  netatmo: "Netatmo",
  wunderground: "Weather Underground",
  noaa: "NOAA",
  openmeteo: "Open-Meteo",
  synop: "Référence SYNOP",
  davis: "Davis",
  infoclimat: "Infoclimat",
};

type PhysicalField = "temperature" | "humidity" | "windSpeed" | "windGust" | "windDirection";
type FieldStation = { station: StationData; observedAt: string; ageMinutes: number };

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ageMinutes(value: string | null | undefined, nowMs: number): number | null {
  const timestamp = timestampMs(value);
  if (timestamp === null || timestamp > nowMs) return null;
  return Math.floor((nowMs - timestamp) / 60_000);
}

function validStationValue(field: PhysicalField, value: number | null): value is number {
  if (value == null || !Number.isFinite(value)) return false;
  switch (field) {
    case "humidity":
      return value >= 0 && value <= 100;
    case "windSpeed":
    case "windGust":
      return value >= 0;
    case "windDirection":
      return value >= 0 && value <= 360;
    case "temperature":
      return true;
  }
}

function getEligibleFieldStations(
  field: PhysicalField,
  stations: StationData[],
  nowMs: number,
  requireAltitude: boolean,
): { eligible: FieldStation[]; reason: string } {
  const physical = getPhysicalActiveStations(stations);
  const withValue = physical.filter((station) => validStationValue(field, station[field]));
  if (withValue.length === 0) {
    return { eligible: [], reason: "Aucune valeur physique exploitable pour ce champ." };
  }
  const withTime = withValue.flatMap((station) => {
    const age = getStationMeasurementAgeState(station.measurementTimes, field, nowMs);
    if (age.status !== "known" || age.observedAt == null || age.ageMinutes == null) return [];
    return [{ station, observedAt: age.observedAt, ageMinutes: age.ageMinutes }];
  });
  if (withTime.length === 0) {
    return { eligible: [], reason: "Horodatage propre à la mesure absent, futur ou non fiable." };
  }
  const fresh = withTime.filter((entry) => hasFreshStationMeasurement(
    entry.station.measurementTimes,
    field,
    MAX_LOCAL_FRESHNESS_MINUTES,
    nowMs,
  ));
  if (fresh.length === 0) {
    return { eligible: [], reason: `Toutes les mesures dépassent la fraîcheur Locale établie (${MAX_LOCAL_FRESHNESS_MINUTES} min).` };
  }
  const nearby = fresh.filter((entry) => entry.station.distanceKm <= MAX_LOCAL_DISTANCE_KM);
  if (nearby.length === 0) {
    return { eligible: [], reason: `Aucune mesure dans le rayon Local établi de ${MAX_LOCAL_DISTANCE_KM} km.` };
  }
  const reliable = nearby.filter((entry) => entry.station.reliabilityScore >= MIN_LOCAL_SOURCE_RELIABILITY);
  if (reliable.length === 0) {
    return { eligible: [], reason: `Aucune source n’atteint le seuil de fiabilité Local établi (${MIN_LOCAL_SOURCE_RELIABILITY}/100).` };
  }
  if (requireAltitude) {
    const knownAltitude = reliable.filter((entry) => Number.isFinite(entry.station.altitude));
    if (knownAltitude.length === 0) {
      return { eligible: [], reason: "Altitude de station absente : aucune correction d’altitude vérifiable." };
    }
    return { eligible: knownAltitude, reason: "Aucune station physique ne passe les contrôles température/altitude existants." };
  }
  return { eligible: reliable, reason: "Aucune source physique ne passe les contrôles établis de champ, temps, rayon et fiabilité." };
}

function unavailable(reason: string): CurrentDashboardField {
  return {
    value: null,
    provenance: {
      kind: "unavailable",
      label: "Indisponible",
      stationCount: 0,
      stationSources: [],
      observedAt: null,
      ageMinutes: null,
      reason,
      measurements: [],
    },
  };
}

function modelField(
  value: number | string | null,
  capturedAt: string | null | undefined,
  nowMs: number,
  reason: string,
): CurrentDashboardField {
  const validValue = typeof value === "number"
    ? Number.isFinite(value)
    : typeof value === "string" && value.trim().length > 0;
  if (!validValue) return unavailable(`${reason} La valeur du snapshot Open-Meteo est absente ou invalide.`);
  return {
    value,
    provenance: {
      kind: "open_meteo_snapshot",
      label: "Snapshot modèle Open-Meteo",
      stationCount: 0,
      stationSources: ["Open-Meteo"],
      observedAt: capturedAt ?? null,
      ageMinutes: ageMinutes(capturedAt, nowMs),
      reason,
      measurements: [],
    },
  };
}

function weightedCircularMean(values: Array<{ degrees: number; weight: number }>): number | null {
  const usable = values.filter(({ degrees, weight }) => Number.isFinite(degrees) && Number.isFinite(weight) && weight > 0);
  if (usable.length === 0) return null;
  const totalWeight = usable.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return null;
  const radians = usable.map(({ degrees }) => (degrees * Math.PI) / 180);
  const sin = radians.reduce((sum, value, index) => sum + Math.sin(value) * usable[index].weight, 0) / totalWeight;
  const cos = radians.reduce((sum, value, index) => sum + Math.cos(value) * usable[index].weight, 0) / totalWeight;
  if (Math.hypot(sin, cos) < 1e-8) return null;
  return Math.round((((Math.atan2(sin, cos) * 180) / Math.PI + 360) % 360) * 10) / 10;
}

function makeProvenance(
  contributions: Array<{ station: StationData; observedAt: string; ageMinutes: number }>,
): CurrentDashboardField["provenance"] {
  const measurements = contributions.map(({ station, observedAt, ageMinutes: age }) => ({
    stationId: station.stationId,
    stationName: station.name,
    source: station.source,
    observedAt,
    ageMinutes: age,
  }));
  const stationSources = Array.from(new Set(measurements.map(({ source }) => SOURCE_LABELS[source])));
  const oldestAge = Math.max(...measurements.map(({ ageMinutes: age }) => age));
  return {
    kind: "physical_stations",
    label: "Stations physiques qualifiées",
    stationCount: measurements.length,
    stationSources,
    observedAt: measurements.length === 1 ? measurements[0].observedAt : null,
    ageMinutes: oldestAge,
    reason: null,
    measurements,
  };
}

function aggregateTemperature(
  eligible: FieldStation[],
  options: { lat: number; lon: number; elevationM: number | null; nowMs: number },
): CurrentDashboardField | null {
  if (options.elevationM == null) return null;
  const stations = eligible.map(({ station, observedAt }) => ({
    ...station,
    // L’horodatage température propre au champ gouverne le test de fraîcheur partagé.
    updatedAt: observedAt,
  }));
  const result = calculateUltraLocal(
    stations,
    "local",
    options.lat,
    options.lon,
    options.elevationM,
    null,
    { recordStationReadings: false, inferReferenceAltitude: false },
  );
  const originalById = new Map(eligible.map((entry) => [entry.station.stationId, entry]));
  const contributions = result.stationsUsed
    .filter((contribution) => contribution.weight > 0)
    .flatMap((contribution) => {
      const entry = originalById.get(contribution.stationId);
      if (!entry || !validStationValue("temperature", entry.station.temperature)) return [];
      return [{ station: entry.station, observedAt: entry.observedAt, ageMinutes: entry.ageMinutes }];
    });
  if (contributions.length === 0 || result.temperature == null || !Number.isFinite(result.temperature)) return null;
  return { value: result.temperature, provenance: makeProvenance(contributions) };
}

function aggregateOtherPhysicalField(
  field: Exclude<PhysicalField, "temperature">,
  eligible: FieldStation[],
  nowMs: number,
): CurrentDashboardField | null {
  if (eligible.length === 0) return null;
  const sources = eligible.map(({ station, observedAt }) => ({
    ...station,
    id: station.stationId,
    // Le poids de fraîcheur existant est calculé sur le temps propre à la variable.
    updatedAt: observedAt,
  }));
  const weights = buildNormalizedSpatialWeights(sources, { now: nowMs });
  const weightByStationId = new Map(weights.map((weight) => [weight.source.stationId, weight.finalWeight]));
  const contributions = eligible.filter(({ station }) => {
    const weight = weightByStationId.get(station.stationId) ?? 0;
    return weight > 0 && validStationValue(field, station[field]);
  });
  const totalWeight = contributions.reduce((sum, entry) => sum + (weightByStationId.get(entry.station.stationId) ?? 0), 0);
  if (totalWeight <= 0) return null;

  const value = field === "windDirection"
    ? weightedCircularMean(contributions.map(({ station }) => ({
      degrees: station.windDirection!,
      weight: weightByStationId.get(station.stationId) ?? 0,
    })))
    : contributions.reduce((sum, entry) => sum + entry.station[field]! * (weightByStationId.get(entry.station.stationId) ?? 0), 0) / totalWeight;
  if (value == null || !Number.isFinite(value)) return null;
  return {
    value,
    provenance: makeProvenance(contributions),
  };
}

function aggregatePhysicalField(
  field: PhysicalField,
  allStations: StationData[],
  options: { lat: number; lon: number; elevationM: number | null; nowMs: number },
): CurrentDashboardField | null {
  const requireAltitude = field === "temperature";
  if (requireAltitude && options.elevationM == null) return null;
  const { eligible } = getEligibleFieldStations(field, allStations, options.nowMs, requireAltitude);
  if (eligible.length === 0) return null;
  if (field === "temperature") return aggregateTemperature(eligible, options);
  return aggregateOtherPhysicalField(field, eligible, options.nowMs);
}

function rawFieldObservations(field: PhysicalField, stations: StationData[], nowMs: number) {
  return stations
    .filter((station) => getStationSourceKind(station.source, station.stationId) === "physical")
    .flatMap((station) => {
      const value = station[field];
      if (typeof value !== "number" || !Number.isFinite(value)) return [];
      const age = getStationMeasurementAgeState(station.measurementTimes, field, nowMs);
      return [{
        stationId: station.stationId,
        stationName: station.name,
        source: station.source,
        value,
        observedAt: age.observedAt,
        ageMinutes: age.ageMinutes,
        ageStatus: age.status,
      }];
    });
}

/**
 * Read-model for Dashboard present conditions only. Every physical field is
 * validated against its own value and measurement time; only temperature uses
 * the temperature-specific Ultra-local coherence and altitude checks. Model
 * fields are fallback values, never blended into station estimates.
 */
export function buildCurrentDashboardWeatherState(input: {
  lat: number;
  lon: number;
  snapshot: CurrentWeatherSnapshot | null;
  stations: StationData[];
  /** Altitude du lieu obtenue séparément ; aucune valeur de snapshot fabriquée. */
  referenceElevation?: {value:number;source:string;retrievedAt:string} | null;
  nowMs?: number;
}): CurrentDashboardWeatherState {
  const nowMs = input.nowMs ?? Date.now();
  const snapshot = input.snapshot;
  const elevationM = typeof snapshot?.elevationM === "number" && Number.isFinite(snapshot.elevationM)
    ? snapshot.elevationM
    : input.referenceElevation&&Number.isFinite(input.referenceElevation.value)
      ? input.referenceElevation.value
      : null;
  const physicalOptions = { lat: input.lat, lon: input.lon, elevationM, nowMs };
  const fallback = (value: number | string | null, reason: string) => modelField(value, snapshot?.capturedAt, nowMs, reason);
  const localOrFallback = (field: PhysicalField, modelValue: number | null, reason: string): CurrentDashboardField => {
    const aggregate = aggregatePhysicalField(field, input.stations, physicalOptions);
    const contributingIds = new Set(aggregate?.provenance.kind === "physical_stations"
      ? aggregate.provenance.measurements.map((measurement) => measurement.stationId)
      : []);
    const observations = rawFieldObservations(field, input.stations, nowMs).map((observation) => ({
      ...observation,
      contributes: contributingIds.has(observation.stationId),
    }));
    return { ...(aggregate ?? fallback(modelValue, reason)), observations };
  };
  const tempReason = elevationM == null
    ? "Altitude du lieu absente du snapshot : le contrôle/correctif d’altitude n’est pas deviné."
    : "Aucune station physique ne passe les contrôles température/altitude existants.";
  const fieldReason = "Aucune source physique ne passe les contrôles établis de validité, horodatage propre, fraîcheur Locale, rayon et fiabilité de source.";

  const fields: Record<CurrentDashboardFieldKey, CurrentDashboardField> = {
    temperature: localOrFallback("temperature", snapshot?.temp ?? null, tempReason),
    apparentTemperature: fallback(snapshot?.apparentTemp ?? null, "Aucun champ physique de température ressentie n’est disponible."),
    // Les sources physiques exposent des périodes d’accumulation différentes ou
    // non déclarées par relevé; elles ne sont pas comparables au snapshot courant.
    precipitation: fallback(snapshot?.precipitation ?? null, "Repli Open-Meteo : les périodes d’accumulation physiques ne sont pas assez documentées pour une comparaison sûre."),
    windSpeed: localOrFallback("windSpeed", snapshot?.windSpeed ?? null, fieldReason),
    windGust: localOrFallback("windGust", snapshot?.windGust ?? null, fieldReason),
    windDirection: localOrFallback("windDirection", snapshot?.windDirection ?? null, "Aucune direction physique valide, horodatée et comparable ne passe les règles Local existantes."),
    cloudCover: fallback(snapshot?.cloudCover ?? null, "Aucun champ physique de nébulosité n’est fourni par les sources de stations reconnues."),
    humidity: localOrFallback("humidity", snapshot?.humidity ?? null, fieldReason),
    weatherCode: fallback(snapshot?.weatherCode ?? null, "Le code météo est fourni uniquement par le snapshot modèle."),
    condition: fallback(snapshot?.condition ?? null, "La condition météo est dérivée du code du snapshot modèle; les stations ne fournissent pas ce champ."),
    pressure: unavailable("Pressions physiques exclues : pres, altim et Pressure n’indiquent pas une référence barométrique comparable; le snapshot courant Open-Meteo ne fournit pas ce champ."),
  };

  if(fields.temperature.provenance.kind==='physical_stations'&&input.referenceElevation&&snapshot?.elevationM==null){
    fields.temperature.provenance.reason=`Altitude du lieu : ${input.referenceElevation.value} m · ${input.referenceElevation.source} · obtenue le ${input.referenceElevation.retrievedAt}. Correction d’altitude du moteur original.`;
  }

  return { computedAt: new Date(nowMs).toISOString(), fields };
}
