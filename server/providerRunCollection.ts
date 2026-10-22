import { randomUUID } from "node:crypto";
import { OFFICIAL_HOURLY_MODELS } from "./officialModels";
import { fetchWeather } from "./weatherFetch";
import {readProviderRateLimit, type ProviderRateLimit} from "./providerRateLimit";
import {SINGLE_RUN_MODEL_IDS, COMPOSITE_METADATA_IDS, COMPOSITE_METADATA_LOCATION, SINGLE_RUN_CALIBRATION_VARIABLE_IDS} from "./providerRunCapabilities";
import {collectProviderModelMetadata} from "./providerRunMetadata";
import {
  buildSingleRunRequestUrl,
  parseProviderRunHourlyResponse,
  resolveProviderRunSelection,
  singleRunMetadataUrl,
  type ProviderRunCaptureAttempt,
  type ProviderRunForecastValue,
} from "./providerRunHorizon";

export type ProviderRunCollectionBatch = {
  captures: ProviderRunCaptureAttempt[];
  values: ProviderRunForecastValue[];
  rateLimit?: ProviderRateLimit;
};

function emptyAttempt(input: {
  captureRunId: string;
  locationKey: string;
  targetDate: string;
  modelName: string;
  modelId: string;
  status: string;
  reasonCode: string | null;
  metadataUrl?: string | null;
  metadataHttpStatus?: number | null;
}): ProviderRunCaptureAttempt {
  return {
    ...input,
    metadataHttpStatus: input.metadataHttpStatus ?? null,
    metadataUrl: input.metadataUrl ?? null,
    metadataAvailableAt: null,
    providerRunAt: null,
    requestStartedAt: null,
    availableAt: null,
    collectionLatencyMilliseconds: null,
    requestUrl: null,
    responseStatus: null,
    responsePayload: null,
    valuesStored: 0,
    minimumForecastLeadMilliseconds: null,
    maximumForecastLeadMilliseconds: null,
  };
}

/**
 * Best-effort append-only sidecar. It never replaces the existing Forecast API
 * collection and intentionally returns per-model unknown states rather than
 * rejecting the scheduled favorite-location batch.
 */
export async function collectProviderRunBatch(input: {
  targetDate: string;
  locationKey: string;
  latitude: number;
  longitude: number;
  hasCapturedRun?: (modelName: string, modelId: string, providerRunAt: number) => Promise<boolean>;
}): Promise<ProviderRunCollectionBatch> {
  const attempts = await Promise.all(OFFICIAL_HOURLY_MODELS.map(async (model) => {
    const captureRunId = randomUUID();
    const directMetadataId = SINGLE_RUN_MODEL_IDS[model.name as keyof typeof SINGLE_RUN_MODEL_IDS];
    if (!directMetadataId || directMetadataId !== model.modelId) {
      return { capture: emptyAttempt({ captureRunId, locationKey: input.locationKey, targetDate: input.targetDate, modelName: model.name, modelId: model.modelId, status: "unmapped_model_id", reasonCode: "official_metadata_id_unmapped" }), values: [] as ProviderRunForecastValue[] };
    }
    const compositeIds = COMPOSITE_METADATA_IDS[model.modelId];
    const metadataUrl = singleRunMetadataUrl(compositeIds?.[0] ?? directMetadataId);
    if (compositeIds && (input.locationKey !== COMPOSITE_METADATA_LOCATION || input.latitude !== 50.7567 || input.longitude !== 2.5204)) {
      return {capture: emptyAttempt({captureRunId, locationKey: input.locationKey, targetDate: input.targetDate,
        modelName: model.name, modelId: model.modelId, status: "unmapped_model_id", reasonCode: "composite_location_not_verified"}), values: [] as ProviderRunForecastValue[]};
    }
    if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90
      || !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
      return { capture: emptyAttempt({ captureRunId, locationKey: input.locationKey, targetDate: input.targetDate, modelName: model.name, modelId: model.modelId, status: "metadata_invalid", reasonCode: "invalid_location_coordinates" }), values: [] as ProviderRunForecastValue[] };
    }

    const metadataResult = await collectProviderModelMetadata(model.modelId);
    if (!metadataResult.metadata) {
      return {capture: emptyAttempt({captureRunId, locationKey: input.locationKey, targetDate: input.targetDate,
        modelName: model.name, modelId: model.modelId, status: "metadata_unavailable", reasonCode: metadataResult.reasonCode,
        metadataUrl: metadataResult.url, metadataHttpStatus: metadataResult.httpStatus}), values: [] as ProviderRunForecastValue[]};
    }
    const metadata = metadataResult.metadata;

    const selection = resolveProviderRunSelection({ modelName: model.name, modelId: model.modelId, metadata, now: Date.now(), locationKey: input.locationKey });
    if (selection.status !== "selected" || selection.providerRunAt == null || selection.metadataAvailableAt == null) {
      return {
        capture: {
          ...emptyAttempt({ captureRunId, locationKey: input.locationKey, targetDate: input.targetDate, modelName: model.name, modelId: model.modelId, status: selection.status, reasonCode: selection.reasonCode, metadataUrl: selection.metadataUrl, metadataHttpStatus: metadataResult.httpStatus }),
          metadataAvailableAt: selection.metadataAvailableAt,
        },
        values: [] as ProviderRunForecastValue[],
      };
    }

    const capture = {
      ...emptyAttempt({captureRunId, locationKey: input.locationKey, targetDate: input.targetDate,
        modelName: model.name, modelId: model.modelId, status: "selected", reasonCode: null,
        metadataUrl: selection.metadataUrl, metadataHttpStatus: metadataResult.httpStatus}),
      metadataAvailableAt: selection.metadataAvailableAt, providerRunAt: selection.providerRunAt,
      ...(selection.metadataPublicationBasis ? {metadataPublicationBasis: selection.metadataPublicationBasis} : {}),
    };
    try {
      if (await input.hasCapturedRun?.(model.name, model.modelId, selection.providerRunAt)) capture.status = "already_archived";
    } catch {capture.status = "archive_unavailable"; capture.reasonCode = "stored_cycle_verification_failed";}
    return {capture, values: [] as ProviderRunForecastValue[]};
  }));

  const groups = new Map<number, typeof attempts>();
  for (const attempt of attempts) if (attempt.capture.status === "selected") {
    const run = attempt.capture.providerRunAt!;
    groups.set(run, [...(groups.get(run) ?? []), attempt]);
  }
  let rateLimit: ProviderRateLimit|undefined;
  // Un lot par cycle reel. Les lots sont sequentiels : un 429 arrete le passage.
  const pendingGroups = Array.from(groups.entries());
  for (const [providerRunAt, group] of pendingGroups) {
    if (rateLimit) {
      for (const item of group) Object.assign(item.capture, {status: "rate_limited", reasonCode: "provider_quota_wait", responseStatus: 429});
      continue;
    }
    const first = group[0].capture;
    const url = new URL(buildSingleRunRequestUrl({modelName: first.modelName, modelId: first.modelId,
      latitude: input.latitude, longitude: input.longitude, providerRunAt}));
    url.searchParams.set("models", group.map(item => item.capture.modelId).join(","));
    const requestUrl = url.toString(), requestStartedAt = Date.now();
    for (const item of group) Object.assign(item.capture, {requestUrl, requestStartedAt});
    let response: Response;
    try {response = await fetchWeather(requestUrl, {}, {timeoutMs: 12000, attempts: 1, cacheTtlMs: 0});}
    catch {
      for (const item of group) Object.assign(item.capture, {status: "request_failed", reasonCode: "single_run_network_error"});
      continue;
    }
    const availableAt = Date.now();
    for (const item of group) Object.assign(item.capture, {availableAt, collectionLatencyMilliseconds: availableAt-providerRunAt, responseStatus: response.status});
    if (!response.ok) {
      rateLimit = await readProviderRateLimit(response, availableAt) ?? undefined;
      // Une erreur de paramètre/modèle est isolée une seule fois. Aucun
      // découpage ni nouvel essai après un refus de quota.
      if (response.status === 400 && group.length > 1) {
        for (const item of group) pendingGroups.push([providerRunAt, [item]]);
        continue;
      }
      for (const item of group) Object.assign(item.capture, {status: rateLimit ? "rate_limited" : "request_failed",
        reasonCode: rateLimit ? "provider_quota_wait" : response.status >= 500 ? "single_run_http_5xx" : "single_run_http_4xx"});
      continue;
    }
    let data: any;
    try {data = await response.json();} catch {
      for (const item of group) Object.assign(item.capture, {status: "invalid_response", reasonCode: "single_run_invalid_json"});
      continue;
    }
    for (const item of group) {
      const capture = item.capture;
      // Les suffixes sont obligatoires pour plusieurs modeles : aucune copie de la serie voisine.
      const hourly: Record<string,unknown> = {time: data?.hourly?.time}, units: Record<string,unknown> = {};
      for (const key of SINGLE_RUN_CALIBRATION_VARIABLE_IDS) {
        const source = group.length === 1 ? key : key + "_" + capture.modelId;
        if (Array.isArray(data?.hourly?.[source])) hourly[key] = data.hourly[source];
        if (data?.hourly_units?.[source] != null) units[key] = data.hourly_units[source];
      }
      const parsed = parseProviderRunHourlyResponse({responseData: {hourly, hourly_units: units},
        ...(capture.metadataPublicationBasis ? {metadataPublicationBasis: capture.metadataPublicationBasis} : {}),
        captureRunId: capture.captureRunId, locationKey: input.locationKey, modelName: capture.modelName,
        modelId: capture.modelId, metadataAvailableAt: capture.metadataAvailableAt!, providerRunAt, requestStartedAt, availableAt});
      item.values = parsed.values;
      const leads = parsed.values.map(value => value.forecastLeadTimeMilliseconds);
      Object.assign(capture, {status: parsed.nonNullValueCount > 0 ? "succeeded" : "no_usable_values",
        reasonCode: parsed.nonNullValueCount > 0 ? null : "single_run_contains_no_finite_values",
        responsePayload: parsed.responsePayload, valuesStored: parsed.values.length,
        minimumForecastLeadMilliseconds: leads.length ? Math.min(...leads) : null,
        maximumForecastLeadMilliseconds: leads.length ? Math.max(...leads) : null});
    }
  }
  return {captures: attempts.map(item => item.capture), values: attempts.flatMap(item => item.values), ...(rateLimit ? {rateLimit} : {})};
}
