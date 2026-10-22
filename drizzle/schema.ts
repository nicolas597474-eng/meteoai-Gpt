import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, float, double, json, bigint, uniqueIndex, index } from "drizzle-orm/mysql-core";
import type { StationMeasurementTimes } from "../server/stationMeasurementFreshness";
import type { HourlyComparisonDiagnostic } from "../server/hourlyComparisonDiagnostics";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Weather forecasts collected from various services/models.
 * Each row = one service's forecast for one date.
 */
export const forecasts = mysqlTable("forecasts", {
  id: int("id").autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull().default("default"), // "lat_lon" rounded to 3dp, e.g. "50.781_2.544"
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  serviceName: varchar("serviceName", { length: 64 }).notNull(),
  serviceCategory: mysqlEnum("serviceCategory", ["public", "expert"]).notNull(),
  tempMax: float("tempMax"),
  tempMin: float("tempMin"),
  precipitation: float("precipitation"), // mm
  windSpeed: float("windSpeed"), // km/h
  windGust: float("windGust"), // km/h
  humidity: float("humidity"), // %
  cloudCover: float("cloudCover"), // %
  condition: varchar("condition", { length: 128 }),
  rawData: json("rawData"),
  collectedAt: timestamp("collectedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("forecasts_location_date_service_unique").on(table.locationKey, table.date, table.serviceName),
]);

export type Forecast = typeof forecasts.$inferSelect;
export type InsertForecast = typeof forecasts.$inferInsert;

/**
 * Immutable archive of each provider/model forecast emission. Unlike `forecasts`,
 * these rows are never replaced and therefore preserve the issue time required
 * for reproducible lead-time evaluation.
 */
export const forecastRuns = mysqlTable("forecast_runs", {
  id: int("id").autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  validDate: varchar("validDate", { length: 10 }).notNull(),
  serviceName: varchar("serviceName", { length: 64 }).notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 96 }),
  sourceKind: mysqlEnum("sourceKind", ["model_forecast", "service_forecast"]).notNull(),
  issuedAt: bigint("issuedAt", { mode: "number" }).notNull(),
  tempMax: float("tempMax"),
  tempMin: float("tempMin"),
  precipitation: float("precipitation"),
  windSpeed: float("windSpeed"),
  windGust: float("windGust"),
  humidity: float("humidity"),
  cloudCover: float("cloudCover"),
  condition: varchar("condition", { length: 128 }),
  rawData: json("rawData"),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("forecast_runs_unique_emission").on(table.locationKey, table.validDate, table.serviceName, table.issuedAt),
]);

export type ForecastRun = typeof forecastRuns.$inferSelect;
export type InsertForecastRun = typeof forecastRuns.$inferInsert;

/** Production-only daily model/observation pairs, keyed to the exact model run and lead horizon. */
export const dailyForecastObservationComparisons = mysqlTable("daily_forecast_observation_comparisons", {
  id: int("id").autoincrement().primaryKey(),
  comparisonKey: varchar("comparisonKey", { length: 160 }).notNull(),
  forecastRunId: int("forecastRunId").notNull(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  validDate: varchar("validDate", { length: 10 }).notNull(),
  serviceName: varchar("serviceName", { length: 64 }).notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 96 }).notNull(),
  horizonBucket: mysqlEnum("horizonBucket", ["0-6h", "6-24h", "1-3d", "4-7d", "8-15d"]).notNull(),
  leadTimeMinutes: int("leadTimeMinutes").notNull(),
  variable: mysqlEnum("variable", ["temperature_max", "temperature_min", "precipitation_sum", "wind_speed_max", "wind_gust_max"]).notNull(),
  forecastValue: float("forecastValue").notNull(),
  observedValue: float("observedValue").notNull(),
  signedError: float("signedError").notNull(),
  absoluteError: float("absoluteError").notNull(),
  evidenceType: mysqlEnum("evidenceType", ["physical_observation"]).notNull().default("physical_observation"),
  observationIsQualified: int("observationIsQualified").notNull().default(1),
  observationCoverageHours: int("observationCoverageHours").notNull(),
  /** Null on legacy rows; populated only when exact station measurement times are archived. */
  forecastAvailableAt: bigint("forecastAvailableAt", { mode: "number" }),
  observationWindowStartAt: bigint("observationWindowStartAt", { mode: "number" }),
  observationWindowEndAt: bigint("observationWindowEndAt", { mode: "number" }),
  stationEvidence: json("stationEvidence"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("daily_fc_obs_comparison_key_uq").on(table.comparisonKey),
  index("daily_fc_obs_location_date_idx").on(table.locationKey, table.validDate),
  index("daily_fc_obs_selection_idx").on(table.locationKey, table.horizonBucket, table.variable, table.validDate),
  index("daily_fc_obs_model_idx").on(table.locationKey, table.serviceName, table.variable, table.horizonBucket, table.validDate),
]);
export type DailyForecastObservationComparison = typeof dailyForecastObservationComparisons.$inferSelect;
export type InsertDailyForecastObservationComparison = typeof dailyForecastObservationComparisons.$inferInsert;

/** Append-only snapshots of distinct persisted comparison payloads; no legacy rows are backfilled. */
export const dailyForecastObservationComparisonRevisions = mysqlTable("daily_forecast_observation_comparison_revisions", {
  id: int("id").autoincrement().primaryKey(),
  comparisonKey: varchar("comparisonKey", { length: 160 }).notNull(),
  revisionHash: varchar("revisionHash", { length: 64 }).notNull(),
  forecastRunId: int("forecastRunId").notNull(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  validDate: varchar("validDate", { length: 10 }).notNull(),
  serviceName: varchar("serviceName", { length: 64 }).notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 96 }).notNull(),
  horizonBucket: mysqlEnum("horizonBucket", ["0-6h", "6-24h", "1-3d", "4-7d", "8-15d"]).notNull(),
  leadTimeMinutes: int("leadTimeMinutes").notNull(),
  variable: mysqlEnum("variable", ["temperature_max", "temperature_min", "precipitation_sum", "wind_speed_max", "wind_gust_max"]).notNull(),
  forecastValue: float("forecastValue").notNull(),
  observedValue: float("observedValue").notNull(),
  signedError: float("signedError").notNull(),
  absoluteError: float("absoluteError").notNull(),
  evidenceType: mysqlEnum("evidenceType", ["physical_observation"]).notNull().default("physical_observation"),
  observationIsQualified: int("observationIsQualified").notNull().default(1),
  observationCoverageHours: int("observationCoverageHours").notNull(),
  forecastAvailableAt: bigint("forecastAvailableAt", { mode: "number" }),
  observationWindowStartAt: bigint("observationWindowStartAt", { mode: "number" }),
  observationWindowEndAt: bigint("observationWindowEndAt", { mode: "number" }),
  stationEvidence: json("stationEvidence"),
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("daily_fc_obs_revision_hash_uq").on(table.comparisonKey, table.revisionHash),
  index("daily_fc_obs_revision_location_date_idx").on(table.locationKey, table.validDate, table.id),
  index("daily_fc_obs_revision_selection_idx").on(table.locationKey, table.horizonBucket, table.variable, table.validDate, table.id),
]);
export type DailyForecastObservationComparisonRevision = typeof dailyForecastObservationComparisonRevisions.$inferSelect;
export type InsertDailyForecastObservationComparisonRevision = typeof dailyForecastObservationComparisonRevisions.$inferInsert;

/**
 * Real weather observations from local stations.
 * Each row = one day's actual weather at Hondeghem.
 */
export const observations = mysqlTable("observations", {
  id: int("id").autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull().default("default"), // "lat_lon" rounded to 3dp
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  tempMax: float("tempMax"),
  tempMin: float("tempMin"),
  precipitation: float("precipitation"), // mm
  windSpeed: float("windSpeed"), // km/h
  windGust: float("windGust"), // km/h
  humidity: float("humidity"), // %
  cloudCover: float("cloudCover"), // %
  condition: varchar("condition", { length: 128 }),
  source: varchar("source", { length: 128 }), // e.g. "Steenvoorde/Hazebrouck"
  /** Explicitly differentiates a station-backed observation from a model reference. */
  provenanceType: mysqlEnum("provenanceType", ["physical_observation", "model_reference", "legacy_unqualified"]).notNull().default("legacy_unqualified"),
  /** Only qualified physical observations may be used by a future operational scorer. */
  isQualified: int("isQualified").notNull().default(0),
  rawData: json("rawData"),
  collectedAt: timestamp("collectedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("observations_location_date_provenance_unique").on(table.locationKey, table.date, table.provenanceType),
]);

export type Observation = typeof observations.$inferSelect;
export type InsertObservation = typeof observations.$inferInsert;

/**
 * Computed reliability scores per service per day.
 */
export const reliabilityScores = mysqlTable("reliability_scores", {
  id: int("id").autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull().default("default"), // "lat_lon" rounded to 3dp
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  serviceName: varchar("serviceName", { length: 64 }).notNull(),
  maeTemp: float("maeTemp"),
  maePrecip: float("maePrecip"),
  maeWind: float("maeWind"),
  rmseTemp: float("rmseTemp"),
  rmsePrecip: float("rmsePrecip"),
  rmseWind: float("rmseWind"),
  biasTemp: float("biasTemp"),
  biasPrecip: float("biasPrecip"),
  biasWind: float("biasWind"),
  conditionAccuracy: float("conditionAccuracy"), // 0-1
  weightedScore: float("weightedScore"), // 0-100
  regime: varchar("regime", { length: 32 }), // detected weather regime
  // 🌡️ Temperature dimension
  tempScore: float("tempScore"),
  tempMaxError: float("tempMaxError"),
  // 🌧️ Precipitation dimension
  precipScore: float("precipScore"),
  precipPod: float("precipPod"),    // Probability of Detection
  precipFar: float("precipFar"),    // False Alarm Rate
  precipCsi: float("precipCsi"),    // Critical Success Index
  precipFalsePositives: int("precipFalsePositives"),
  precipFalseNegatives: int("precipFalseNegatives"),
  // 💨 Wind dimension
  windScore: float("windScore"),
  windMaeGusts: float("windMaeGusts"),
  // ☁️ Condition dimension
  condScore: float("condScore"),
  condConcordance: float("condConcordance"),
  condMaeCloud: float("condMaeCloud"),
  /** Exact count of aligned forecast/physical-observation pairs used by this score. */
  sampleSize: int("sampleSize"),
  /** Laboratory score using the centralized six-variable weights, when all inputs exist. */
  normalizedScore: float("normalizedScore"),
  humidityScore: float("humidityScore"),
  humidityMae: float("humidityMae"),
  humidityRmse: float("humidityRmse"),
  humidityBias: float("humidityBias"),
  pressureScore: float("pressureScore"),
  pressureMae: float("pressureMae"),
  pressureRmse: float("pressureRmse"),
  pressureBias: float("pressureBias"),
  evidenceType: mysqlEnum("evidenceType", ["physical_observation", "model_reference", "legacy_unqualified"]).notNull().default("legacy_unqualified"),
  computedAt: timestamp("computedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("reliability_scores_location_date_service_evidence_unique").on(table.locationKey, table.date, table.serviceName, table.evidenceType),
]);

export type ReliabilityScore = typeof reliabilityScores.$inferSelect;
export type InsertReliabilityScore = typeof reliabilityScores.$inferInsert;

/**
 * MeteoAI synthesized forecasts.
 * The AI-generated forecast combining all services with dynamic weights.
 */
export const meteoaiForecast = mysqlTable("meteoai_forecast", {
  id: int("id").autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull().default("default"), // "lat_lon" rounded to 3dp
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  tempMax: float("tempMax"),
  tempMin: float("tempMin"),
  precipitation: float("precipitation"),
  windSpeed: float("windSpeed"),
  /** Nullable for historical rows created before humidity joined the official fusion. */
  humidity: float("humidity"),
  condition: varchar("condition", { length: 128 }),
  /** Legacy nullable column; no current UI/API may interpret it as forecast reliability. */
  stabilityIndex: float("stabilityIndex"),
  /** Legacy NOT NULL storage contract retained until a separately reviewed schema migration. */
  stabilityLabel: mysqlEnum("stabilityLabel", ["stable", "unstable"]).notNull(),
  confidenceScore: float("confidenceScore"), // 0-100
  weights: json("weights"), // { serviceName: weight% }
  explanation: text("explanation"), // AI-generated explanation
  computedAt: timestamp("computedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("meteoai_forecast_location_date_unique").on(table.locationKey, table.date),
]);

export type MeteoAIForecast = typeof meteoaiForecast.$inferSelect;
export type InsertMeteoAIForecast = typeof meteoaiForecast.$inferInsert;

/**
 * Collection jobs tracking (for heartbeat scheduling).
 */
export const collectionJobs = mysqlTable("collection_jobs", {
  id: int("id").autoincrement().primaryKey(),
  jobType: mysqlEnum("jobType", ["forecast", "observation"]).notNull(),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed"]).notNull(),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
  scheduleRunKey: varchar("scheduleRunKey", { length: 48 }),
  servicesCollected: int("servicesCollected"),
  dailyModelsCollected: int("dailyModelsCollected").default(0).notNull(),
  dailyModelsExpected: int("dailyModelsExpected").default(0).notNull(),
  hourlyModelsCollected: int("hourlyModelsCollected").default(0).notNull(),
  hourlyModelsExpected: int("hourlyModelsExpected").default(0).notNull(),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => [uniqueIndex("collection_jobs_schedule_run_key_unique").on(table.scheduleRunKey)]);

/** Ephemeral compare-and-set leases; rows are removed on release and reused after expiry. */
export const forecastRefreshLocks = mysqlTable("forecast_refresh_locks", {
  lockKey: varchar("lockKey", { length: 64 }).primaryKey(),
  ownerToken: varchar("ownerToken", { length: 64 }).notNull(),
  leaseExpiresAt: timestamp("leaseExpiresAt").notNull(),
});

export type CollectionJob = typeof collectionJobs.$inferSelect;
export type InsertCollectionJob = typeof collectionJobs.$inferInsert;

/**
 * Weather stations discovered near a location.
 * Multi-source: Open-Meteo, Météo-France, Netatmo, WUnderground, NOAA, etc.
 */
export const weatherStations = mysqlTable("weather_stations", {
  id: int("id").autoincrement().primaryKey(),
  stationId: varchar("stationId", { length: 128 }).notNull().unique(), // external ID (e.g. "MF-07690", "LFQQ")
  source: varchar("source", { length: 64 }).notNull(), // "meteofrance", "netatmo", "wunderground", "noaa", "openmeteo"
  name: varchar("name", { length: 256 }).notNull(),
  lat: float("lat").notNull(),
  lon: float("lon").notNull(),
  altitude: float("altitude"), // meters
  // Reference location (user's chosen position)
  refLat: float("refLat").notNull(),
  refLon: float("refLon").notNull(),
  distanceKm: float("distanceKm").notNull(), // km from reference
  // Quality metrics
  reliabilityScore: float("reliabilityScore").default(50), // 0-100
  updateFrequencyMin: int("updateFrequencyMin"), // typical update interval in minutes
  dataAvailability: float("dataAvailability").default(1), // 0-1 fraction of expected updates received
  // Status
  isActive: int("isActive").default(1), // 1=active, 0=excluded
  exclusionReason: varchar("exclusionReason", { length: 256 }), // reason if excluded
  qualificationStatus: varchar("qualificationStatus", { length: 24 }).notNull().default("validated"), // candidate, validated, excluded
  sourceTier: int("sourceTier"), // 1=très haute confiance, 2=haute confiance, 3=ultra local
  firstSeen: timestamp("firstSeen").defaultNow().notNull(),
  lastSeen: timestamp("lastSeen").defaultNow().notNull(),
});

export type WeatherStation = typeof weatherStations.$inferSelect;
export type InsertWeatherStation = typeof weatherStations.$inferInsert;

/**
 * Observations collected from individual weather stations.
 * Each row = one station's reading at a given timestamp.
 */
export const stationObservations = mysqlTable("station_observations", {
  id: int("id").autoincrement().primaryKey(),
  stationId: varchar("stationId", { length: 128 }).notNull(), // FK to weatherStations.stationId
  observedAt: bigint("observedAt", { mode: "number" }).notNull(), // UTC ms timestamp
  temperature: float("temperature"), // °C
  humidity: float("humidity"), // %
  pressure: float("pressure"), // hPa
  windSpeed: float("windSpeed"), // km/h
  windGust: float("windGust"), // km/h
  windDirection: float("windDirection"), // degrees
  precipitation: float("precipitation"), // mm
  measurementTimes: json("measurementTimes").$type<StationMeasurementTimes | null>(),
  collectedAt: timestamp("collectedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("station_observations_station_time_unique").on(table.stationId, table.observedAt),
]);

export type StationObservation = typeof stationObservations.$inferSelect;
export type InsertStationObservation = typeof stationObservations.$inferInsert;

/**
 * Measured historical quality of a physical station. This profile documents
 * continuity and data quality; it never changes operational fusion weights by
 * itself. A status of "reliable" is therefore evidence metadata, not a new
 * source tier.
 */
export const stationQualityProfiles = mysqlTable("station_quality_profiles", {
  id: int("id").autoincrement().primaryKey(),
  stationId: varchar("stationId", { length: 128 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("en_observation"),
  observationCount: int("observationCount").notNull().default(0),
  temperatureObservationCount: int("temperatureObservationCount").notNull().default(0),
  continuityScore: float("continuityScore"),
  completenessScore: float("completenessScore"),
  stabilityScore: float("stabilityScore"),
  windowHours: int("windowHours").notNull().default(0),
  firstObservedAt: bigint("firstObservedAt", { mode: "number" }),
  lastObservedAt: bigint("lastObservedAt", { mode: "number" }),
  evaluatedAt: timestamp("evaluatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [uniqueIndex("station_quality_profile_station_unique").on(table.stationId)]);

export type StationQualityProfile = typeof stationQualityProfiles.$inferSelect;
export type InsertStationQualityProfile = typeof stationQualityProfiles.$inferInsert;

/**
 * Physical-station synthesis captured for one location and Paris hour.
 * It is separate from model references and is the sole eligible input for
 * a later daily observation used in model scoring.
 */
export const qualifiedObservationSnapshots = mysqlTable("qualified_observation_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  hour: int("hour").notNull(),
  stationCount: int("stationCount").notNull(),
  confidenceScore: float("confidenceScore"),
  temperature: float("temperature"),
  humidity: float("humidity"),
  pressure: float("pressure"),
  windSpeed: float("windSpeed"),
  windGust: float("windGust"),
  precipitation: float("precipitation"),
  stationsUsed: json("stationsUsed"),
  collectedAt: timestamp("collectedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("qualified_observation_snapshot_location_date_hour_unique").on(table.locationKey, table.date, table.hour),
]);
export type QualifiedObservationSnapshot = typeof qualifiedObservationSnapshots.$inferSelect;
export type InsertQualifiedObservationSnapshot = typeof qualifiedObservationSnapshots.$inferInsert;

/**
 * Ground truth computed from multiple nearby stations (weighted average).
 * Stored per location + date for use in forecast accuracy scoring.
 */
export const groundTruth = mysqlTable("ground_truth", {
  id: int("id").autoincrement().primaryKey(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  refLat: float("refLat").notNull(),
  refLon: float("refLon").notNull(),
  radiusKm: float("radiusKm").notNull(),
  stationsUsed: json("stationsUsed"), // array of { stationId, name, distance, weight, contribution }
  stationsIgnored: json("stationsIgnored"), // array of { stationId, name, reason }
  // Weighted average values
  temperature: float("temperature"),
  humidity: float("humidity"),
  pressure: float("pressure"),
  windSpeed: float("windSpeed"),
  windGust: float("windGust"),
  precipitation: float("precipitation"),
  // Quality
  stationCount: int("stationCount").notNull(),
  confidenceScore: float("confidenceScore"), // 0-100
  computedAt: timestamp("computedAt").defaultNow().notNull(),
});

export type GroundTruth = typeof groundTruth.$inferSelect;
export type InsertGroundTruth = typeof groundTruth.$inferInsert;

/**
 * Availability and coverage record for a physical-station and model collection
 * cycle. Empty station discoveries are recorded explicitly.
 */
export const stationCollectionSnapshots = mysqlTable("station_collection_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  radiusKm: int("radiusKm").notNull(),
  physicalStationCount: int("physicalStationCount").notNull(),
  dailyModelCount: int("dailyModelCount").notNull(),
  hourlyModelCount: int("hourlyModelCount").notNull(),
  dailyMissingModels: json("dailyMissingModels"),
  hourlyMissingModels: json("hourlyMissingModels"),
  dailyVariableCoverage: json("dailyVariableCoverage"),
  status: mysqlEnum("status", ["completed", "partial", "failed"]).notNull(),
  collectedAt: timestamp("collectedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("station_collection_snapshots_location_date_unique").on(table.locationKey, table.date),
]);

export type StationCollectionSnapshot = typeof stationCollectionSnapshots.$inferSelect;
export type InsertStationCollectionSnapshot = typeof stationCollectionSnapshots.$inferInsert;

/**
 * Per-location, per-hour execution trace for the physical-station snapshot
 * collector. This additive table keeps future collection attempts explainable
 * without rewriting historical snapshots, observations, stations or scores.
 */
export const physicalSnapshotCollectionTraces = mysqlTable("physical_snapshot_collection_traces", {
  id: int("id").autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  locationName: varchar("locationName", { length: 256 }),
  date: varchar("date", { length: 10 }).notNull(),
  hour: int("hour").notNull(),
  radiusKm: int("radiusKm").notNull(),
  status: mysqlEnum("status", ["stored", "no_station", "failed"]).notNull(),
  attempts: int("attempts").notNull(),
  stationCount: int("stationCount").notNull(),
  reason: text("reason"),
  collectedAt: timestamp("collectedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("physical_snapshot_trace_location_date_hour_unique").on(table.locationKey, table.date, table.hour),
]);

export type PhysicalSnapshotCollectionTrace = typeof physicalSnapshotCollectionTraces.$inferSelect;
export type InsertPhysicalSnapshotCollectionTrace = typeof physicalSnapshotCollectionTraces.$inferInsert;

/**
 * OAuth Netatmo connection for a MeteoAI user. Only the refresh token is
 * retained, encrypted at rest; each access token is renewed server-side.
 */
export const netatmoOAuthTokens = mysqlTable("netatmo_oauth_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  encryptedRefreshToken: text("encryptedRefreshToken").notNull(),
  scopes: varchar("scopes", { length: 256 }).notNull().default("read_station"),
  connectedAt: timestamp("connectedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NetatmoOAuthToken = typeof netatmoOAuthTokens.$inferSelect;
export type InsertNetatmoOAuthToken = typeof netatmoOAuthTokens.$inferInsert;

/** One-time OAuth states prevent callback forgery without relying on mobile cookies. */
export const netatmoOAuthStates = mysqlTable("netatmo_oauth_states", {
  stateHash: varchar("stateHash", { length: 64 }).primaryKey(),
  userId: int("userId").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  consumedAt: timestamp("consumedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * User favorite locations (max 8 per user).
 * Each location stores coordinates, custom settings, and display preferences.
 */
export const favoriteLocations = mysqlTable("favorite_locations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // FK to users.id
  name: varchar("name", { length: 256 }).notNull(), // geocoded name
  customName: varchar("customName", { length: 256 }), // user-defined label
  lat: float("lat").notNull(),
  lon: float("lon").notNull(),
  isDefault: int("isDefault").default(0), // 1 = default location on app start
  position: int("position").notNull().default(0), // ordering 0-7
  // Per-location settings
  localMode: mysqlEnum("localMode", ["standard", "local", "ultra-local"]).default("standard"),
  radiusKm: int("radiusKm").default(20), // station search radius
  preferredModels: json("preferredModels"), // array of model names
  tempUnit: mysqlEnum("tempUnit", ["celsius", "fahrenheit"]).default("celsius"),
  alertsEnabled: int("alertsEnabled").default(1), // 1=on, 0=off
  alertThresholds: json("alertThresholds"), // { precipMm, windKmh, tempMin, tempMax }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FavoriteLocation = typeof favoriteLocations.$inferSelect;
export type InsertFavoriteLocation = typeof favoriteLocations.$inferInsert;

/**
 * Pre-fetched forecasts for each favorite location.
 * Populated by the favorites forecast schedule (05:00 default; every 4h when enabled).
 * Allows instant display without waiting for API calls.
 */
export const locationForecasts = mysqlTable("location_forecasts", {
  id: int("id").autoincrement().primaryKey(),
  favoriteLocationId: int("favoriteLocationId").notNull(), // FK to favorite_locations.id
  userId: int("userId").notNull(),
  lat: float("lat").notNull(),
  lon: float("lon").notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  // MeteoAI synthesized values
  tempMax: float("tempMax"),
  tempMin: float("tempMin"),
  tempCurrent: float("tempCurrent"),
  precipitation: float("precipitation"),
  windSpeed: float("windSpeed"),
  condition: varchar("condition", { length: 128 }),
  // AI scores
  aiScore: float("aiScore"),       // Weather AI Score 0-100
  confidenceScore: float("confidenceScore"), // Weather Confidence Score 0-100
  stabilityIndex: float("stabilityIndex"),
  // Raw forecast data per model (JSON array)
  modelsData: json("modelsData"),
  // Explanation
  explanation: text("explanation"),
  collectedAt: timestamp("collectedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LocationForecast = typeof locationForecasts.$inferSelect;
export type InsertLocationForecast = typeof locationForecasts.$inferInsert;

/**
 * Hourly forecasts collected per location per model.
 * Populated by the favorites forecast schedule (05:00 default; every 4h when enabled).
 * Stores 24h of hourly data per model per location.
 */
export const hourlyForecasts = mysqlTable("hourly_forecasts", {
  id: int("id").autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD (forecast day)
  hour: int("hour").notNull(), // 0-23
  modelName: varchar("modelName", { length: 64 }).notNull(), // e.g. "AROME", "ECMWF", "best_match"
  temperature: float("temperature"), // °C
  apparentTemperature: float("apparentTemperature"), // °C ressenti
  precipitation: float("precipitation"), // mm
  windSpeed: float("windSpeed"), // km/h
  windGusts: float("windGusts"), // km/h
  windDirection: int("windDirection"), // degrees 0-360
  humidity: float("humidity"), // %
  pressure: float("pressure"), // hPa
  cloudCover: float("cloudCover"), // %
  weatherCode: int("weatherCode"), // WMO code
  collectedAt: timestamp("collectedAt").defaultNow().notNull(),
});
export type HourlyForecast = typeof hourlyForecasts.$inferSelect;
export type InsertHourlyForecast = typeof hourlyForecasts.$inferInsert;

/** Immutable per-run, per-variable archive used for leakage-safe hourly verification. */
export const hourlyForecastRunValues = mysqlTable("hourly_forecast_run_values", {
  id: int("id").autoincrement().primaryKey(),
  captureRunId: varchar("captureRunId", { length: 36 }).notNull(), // Local capture UUID; not an upstream model-run identifier.
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  targetDate: varchar("targetDate", { length: 10 }).notNull(), // Europe/Paris calendar date for lookup only.
  sourceName: varchar("sourceName", { length: 64 }).notNull(),
  modelName: varchar("modelName", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 96 }), // Null when the upstream aggregator does not expose a specific model ID.
  requestStartedAt: bigint("requestStartedAt", { mode: "number" }).notNull(),
  availableAt: bigint("availableAt", { mode: "number" }).notNull(), // Receipt time on this application host.
  validTime: bigint("validTime", { mode: "number" }).notNull(), // Absolute UTC epoch milliseconds.
  variable: varchar("variable", { length: 32 }).notNull(),
  value: float("value"),
  unit: varchar("unit", { length: 32 }),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("hourly_run_values_identity").on(table.captureRunId, table.locationKey, table.modelName, table.validTime, table.variable),
  index("hourly_run_values_location_target_idx").on(table.locationKey, table.targetDate),
  index("hourly_run_values_series_idx").on(table.locationKey, table.modelName, table.variable, table.validTime),
]);
export type HourlyForecastRunValue = typeof hourlyForecastRunValues.$inferSelect;
export type InsertHourlyForecastRunValue = typeof hourlyForecastRunValues.$inferInsert;

/** Idempotent daily verification output, split by source/model/variable/lead-time bucket. */
export const hourlyForecastEvaluationScores = mysqlTable("hourly_forecast_evaluation_scores", {
  id: int("id").autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(), // Physical-observation date in Europe/Paris.
  sourceName: varchar("sourceName", { length: 64 }).notNull(),
  modelName: varchar("modelName", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 96 }),
  variable: varchar("variable", { length: 32 }).notNull(),
  horizonBucket: varchar("horizonBucket", { length: 16 }).notNull(), // Shared Phase 3 horizon key.
  observationCount: int("observationCount").notNull().default(0), // Qualified physical observations, independent of model availability.
  evaluableObservationCount: int("evaluableObservationCount").notNull().default(0), // Exact validTime runs received before observation; no-run horizons are excluded.
  sampleSize: int("sampleSize").notNull().default(0),
  coverageRatio: float("coverageRatio").notNull().default(0), // Finite forecast pairs / recorded exact-time run opportunities; not a skill score.
  mae: float("mae"),
  rmse: float("rmse"),
  bias: float("bias"), // Forecast minus observation.
  computedAt: timestamp("computedAt").defaultNow().notNull(),
  scoringValidationVersion: int("scoringValidationVersion"),
}, (table) => [
  uniqueIndex("hourly_eval_score_day_model_variable_horizon_unique").on(table.locationKey, table.date, table.sourceName, table.modelName, table.variable, table.horizonBucket),
  index("hourly_eval_score_location_date_idx").on(table.locationKey, table.date),
]);
export type HourlyForecastEvaluationScore = typeof hourlyForecastEvaluationScores.$inferSelect;
export type InsertHourlyForecastEvaluationScore = typeof hourlyForecastEvaluationScores.$inferInsert;

/** Immutable run/observation pairs retained at the exact, unrounded lead time. */
export const hourlyForecastExactComparisons = mysqlTable("hourly_forecast_exact_comparisons", {
  id: int("id").autoincrement().primaryKey(),
  forecastRunValueId: int("forecastRunValueId").notNull(),
  observationSnapshotId: int("observationSnapshotId").notNull(),
  captureRunId: varchar("captureRunId", { length: 36 }).notNull(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  sourceName: varchar("sourceName", { length: 64 }).notNull(),
  modelName: varchar("modelName", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 96 }),
  variable: varchar("variable", { length: 32 }).notNull(),
  validTime: bigint("validTime", { mode: "number" }).notNull(),
  availableAt: bigint("availableAt", { mode: "number" }).notNull(),
  horizonMilliseconds: bigint("horizonMilliseconds", { mode: "number" }).notNull(),
  horizonMinutes: double("horizonMinutes").notNull(),
  horizonBucket: varchar("horizonBucket", { length: 16 }).notNull(),
  forecastValue: float("forecastValue").notNull(),
  forecastUnit: varchar("forecastUnit", { length: 32 }),
  observedValue: float("observedValue").notNull(),
  observedUnit: varchar("observedUnit", { length: 32 }).notNull(),
  signedError: float("signedError").notNull(),
  absoluteError: float("absoluteError").notNull(),
  observationDate: varchar("observationDate", { length: 10 }).notNull(),
  observationHour: int("observationHour").notNull(),
  observationReferenceAt: bigint("observationReferenceAt", { mode: "number" }).notNull(),
  observationCollectedAt: bigint("observationCollectedAt", { mode: "number" }),
  stationCount: int("stationCount").notNull(),
  confidenceScore: float("confidenceScore"),
  stationsUsed: json("stationsUsed"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("hourly_exact_comparison_run_snapshot_uq").on(table.forecastRunValueId, table.observationSnapshotId),
  index("hourly_exact_comparison_location_time_idx").on(table.locationKey, table.validTime),
  index("hourly_exact_comparison_model_lead_idx").on(table.locationKey, table.modelName, table.variable, table.horizonMilliseconds, table.observationDate),
]);
export type HourlyForecastExactComparison = typeof hourlyForecastExactComparisons.$inferSelect;
export type InsertHourlyForecastExactComparison = typeof hourlyForecastExactComparisons.$inferInsert;

/** Daily exact-lead aggregates, separate from the existing bucket score rows. */
export const hourlyForecastExactEvaluationScores = mysqlTable("hourly_forecast_exact_evaluation_scores", {
  id: int("id").autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  sourceName: varchar("sourceName", { length: 64 }).notNull(),
  modelName: varchar("modelName", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 96 }),
  variable: varchar("variable", { length: 32 }).notNull(),
  horizonMilliseconds: bigint("horizonMilliseconds", { mode: "number" }).notNull(),
  horizonMinutes: double("horizonMinutes").notNull(),
  horizonBucket: varchar("horizonBucket", { length: 16 }).notNull(),
  observationCount: int("observationCount").notNull().default(0),
  evaluableObservationCount: int("evaluableObservationCount").notNull().default(0),
  sampleSize: int("sampleSize").notNull().default(0),
  coverageRatio: float("coverageRatio").notNull().default(0),
  mae: float("mae"),
  rmse: float("rmse"),
  bias: float("bias"),
  computedAt: timestamp("computedAt").defaultNow().notNull(),
  scoringValidationVersion: int("scoringValidationVersion"),
}, (table) => [
  uniqueIndex("hourly_exact_eval_day_model_variable_lead_uq").on(table.locationKey, table.date, table.sourceName, table.modelName, table.variable, table.horizonMilliseconds),
  index("hourly_exact_eval_location_date_idx").on(table.locationKey, table.date),
  index("hourly_exact_eval_model_lead_date_idx").on(table.locationKey, table.modelName, table.variable, table.horizonMilliseconds, table.date),
]);
export type HourlyForecastExactEvaluationScore = typeof hourlyForecastExactEvaluationScores.$inferSelect;
export type InsertHourlyForecastExactEvaluationScore = typeof hourlyForecastExactEvaluationScores.$inferInsert;

/** Per-provider scheduled collection evidence; it never participates in scoring or fusion. */
export const hourlyForecastCollectionResults = mysqlTable("hourly_forecast_collection_results", {
  id: int("id").autoincrement().primaryKey(),
  collectionJobId: int("collectionJobId").notNull(),
  scheduleRunKey: varchar("scheduleRunKey", { length: 48 }).notNull(),
  batchAttemptId: varchar("batchAttemptId", { length: 36 }).notNull(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  targetDate: varchar("targetDate", { length: 10 }).notNull(),
  modelName: varchar("modelName", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 96 }),
  isOfficialModel: int("isOfficialModel").notNull().default(0),
  sourceName: varchar("sourceName", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["attempting", "succeeded", "partial", "failed", "safe_error"]).notNull(),
  requestAttempts: int("requestAttempts").notNull().default(0),
  hoursReceived: int("hoursReceived").notNull().default(0),
  valuesReceived: int("valuesReceived").notNull().default(0),
  expectedValueCount: int("expectedValueCount").notNull().default(0),
  archiveRowsWritten: int("archiveRowsWritten").notNull().default(0),
  projectionRowsWritten: int("projectionRowsWritten").notNull().default(0),
  variableCoverage: json("variableCoverage"),
  errorCode: varchar("errorCode", { length: 32 }),
  attemptedAt: bigint("attemptedAt", { mode: "number" }).notNull(),
  completedAt: bigint("completedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("hourly_collection_attempt_source_unique").on(table.batchAttemptId, table.locationKey, table.modelName),
  index("hourly_collection_location_time_idx").on(table.locationKey, table.attemptedAt),
  index("hourly_collection_schedule_slot_idx").on(table.scheduleRunKey, table.locationKey),
]);
export type HourlyForecastCollectionResult = typeof hourlyForecastCollectionResults.$inferSelect;
export type InsertHourlyForecastCollectionResult = typeof hourlyForecastCollectionResults.$inferInsert;

/** Exact Single Runs requests and application receipt times; never used by live projections. */
export const hourlyForecastProviderRunCaptures = mysqlTable("hourly_forecast_provider_run_captures", {
  id: int("id").autoincrement().primaryKey(),
  captureRunId: varchar("captureRunId", { length: 36 }).notNull(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  targetDate: varchar("targetDate", { length: 10 }).notNull(),
  modelName: varchar("modelName", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 96 }).notNull(),
  leadBasis: varchar("leadBasis", { length: 32 }).notNull().default("provider_run"),
  status: varchar("status", { length: 48 }).notNull(),
  reasonCode: varchar("reasonCode", { length: 64 }),
  metadataUrl: varchar("metadataUrl", { length: 512 }),
  metadataHttpStatus: int("metadataHttpStatus"),
  metadataAvailableAt: bigint("metadataAvailableAt", { mode: "number" }),
  providerRunAt: bigint("providerRunAt", { mode: "number" }),
  requestStartedAt: bigint("requestStartedAt", { mode: "number" }),
  availableAt: bigint("availableAt", { mode: "number" }),
  collectionLatencyMilliseconds: bigint("collectionLatencyMilliseconds", { mode: "number" }),
  requestUrl: text("requestUrl"),
  responseStatus: int("responseStatus"),
  responsePayload: json("responsePayload"),
  valuesStored: int("valuesStored").notNull().default(0),
  minimumForecastLeadMilliseconds: bigint("minimumForecastLeadMilliseconds", { mode: "number" }),
  maximumForecastLeadMilliseconds: bigint("maximumForecastLeadMilliseconds", { mode: "number" }),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("provider_run_capture_id_uq").on(table.captureRunId),
  index("provider_run_capture_location_time_idx").on(table.locationKey, table.capturedAt),
  index("provider_run_capture_model_time_idx").on(table.locationKey, table.modelName, table.capturedAt),
]);
export type HourlyForecastProviderRunCapture = typeof hourlyForecastProviderRunCaptures.$inferSelect;
export type InsertHourlyForecastProviderRunCapture = typeof hourlyForecastProviderRunCaptures.$inferInsert;

/** Immutable values from one exact Single Runs request; timestamps are not conflated. */
export const hourlyForecastProviderRunValues = mysqlTable("hourly_forecast_provider_run_values", {
  id: int("id").autoincrement().primaryKey(),
  captureRunId: varchar("captureRunId", { length: 36 }).notNull(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  targetDate: varchar("targetDate", { length: 10 }).notNull(),
  modelName: varchar("modelName", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 96 }).notNull(),
  leadBasis: varchar("leadBasis", { length: 32 }).notNull().default("provider_run"),
  metadataAvailableAt: bigint("metadataAvailableAt", { mode: "number" }).notNull(),
  providerRunAt: bigint("providerRunAt", { mode: "number" }).notNull(),
  requestStartedAt: bigint("requestStartedAt", { mode: "number" }).notNull(),
  availableAt: bigint("availableAt", { mode: "number" }).notNull(),
  validTime: bigint("validTime", { mode: "number" }).notNull(),
  forecastLeadTimeMilliseconds: bigint("forecastLeadTimeMilliseconds", { mode: "number" }).notNull(),
  collectionLatencyMilliseconds: bigint("collectionLatencyMilliseconds", { mode: "number" }).notNull(),
  variable: varchar("variable", { length: 32 }).notNull(),
  value: float("value"),
  unit: varchar("unit", { length: 32 }),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("provider_run_value_identity_uq").on(table.captureRunId, table.validTime, table.variable),
  index("provider_run_value_location_target_idx").on(table.locationKey, table.targetDate),
  index("provider_run_value_series_idx").on(table.locationKey, table.modelName, table.variable, table.validTime),
]);
export type HourlyForecastProviderRunValue = typeof hourlyForecastProviderRunValues.$inferSelect;
export type InsertHourlyForecastProviderRunValue = typeof hourlyForecastProviderRunValues.$inferInsert;

/** Immutable provider-run/physical-observation pairs with explicit issue lead and anti-leak receipt time. */
export const hourlyForecastProviderRunComparisons = mysqlTable("hourly_forecast_provider_run_comparisons", {
  id: int("id").autoincrement().primaryKey(),
  forecastRunValueId: int("forecastRunValueId").notNull(),
  observationSnapshotId: int("observationSnapshotId").notNull(),
  captureRunId: varchar("captureRunId", { length: 36 }).notNull(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  modelName: varchar("modelName", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 96 }).notNull(),
  leadBasis: varchar("leadBasis", { length: 32 }).notNull().default("provider_run"),
  variable: varchar("variable", { length: 32 }).notNull(),
  metadataAvailableAt: bigint("metadataAvailableAt", { mode: "number" }).notNull(),
  providerRunAt: bigint("providerRunAt", { mode: "number" }).notNull(),
  requestStartedAt: bigint("requestStartedAt", { mode: "number" }).notNull(),
  availableAt: bigint("availableAt", { mode: "number" }).notNull(),
  validTime: bigint("validTime", { mode: "number" }).notNull(),
  forecastLeadTimeMilliseconds: bigint("forecastLeadTimeMilliseconds", { mode: "number" }).notNull(),
  forecastLeadTimeMinutes: double("forecastLeadTimeMinutes").notNull(),
  collectionLatencyMilliseconds: bigint("collectionLatencyMilliseconds", { mode: "number" }).notNull(),
  forecastValue: float("forecastValue").notNull(),
  forecastUnit: varchar("forecastUnit", { length: 32 }),
  observedValue: float("observedValue").notNull(),
  observedUnit: varchar("observedUnit", { length: 32 }).notNull(),
  signedError: float("signedError").notNull(),
  absoluteError: float("absoluteError").notNull(),
  observationDate: varchar("observationDate", { length: 10 }).notNull(),
  observationHour: int("observationHour").notNull(),
  observationReferenceAt: bigint("observationReferenceAt", { mode: "number" }).notNull(),
  observationCollectedAt: bigint("observationCollectedAt", { mode: "number" }),
  stationCount: int("stationCount").notNull(),
  confidenceScore: float("confidenceScore"),
  stationsUsed: json("stationsUsed"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("provider_run_comparison_run_snapshot_uq").on(table.forecastRunValueId, table.observationSnapshotId),
  index("provider_run_comparison_location_time_idx").on(table.locationKey, table.validTime),
  index("provider_run_comparison_model_lead_idx").on(table.locationKey, table.modelName, table.variable, table.forecastLeadTimeMilliseconds, table.observationDate),
]);
export type HourlyForecastProviderRunComparison = typeof hourlyForecastProviderRunComparisons.$inferSelect;
export type InsertHourlyForecastProviderRunComparison = typeof hourlyForecastProviderRunComparisons.$inferInsert;

/** Daily exact provider-run lead metrics; kept separate from `availableAt` bucket scores. */
export const hourlyForecastProviderRunScores = mysqlTable("hourly_forecast_provider_run_scores", {
  id: int("id").autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  modelName: varchar("modelName", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 96 }).notNull(),
  leadBasis: varchar("leadBasis", { length: 32 }).notNull().default("provider_run"),
  variable: varchar("variable", { length: 32 }).notNull(),
  forecastLeadTimeMilliseconds: bigint("forecastLeadTimeMilliseconds", { mode: "number" }).notNull(),
  forecastLeadTimeMinutes: double("forecastLeadTimeMinutes").notNull(),
  observationCount: int("observationCount").notNull().default(0),
  evaluableObservationCount: int("evaluableObservationCount").notNull().default(0),
  sampleSize: int("sampleSize").notNull().default(0),
  coverageRatio: float("coverageRatio").notNull().default(0),
  mae: float("mae"),
  rmse: float("rmse"),
  bias: float("bias"),
  computedAt: timestamp("computedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("provider_run_score_day_model_variable_lead_uq").on(table.locationKey, table.date, table.modelName, table.modelId, table.leadBasis, table.variable, table.forecastLeadTimeMilliseconds),
  index("provider_run_score_location_date_idx").on(table.locationKey, table.date),
  index("provider_run_score_model_lead_date_idx").on(table.locationKey, table.modelName, table.variable, table.forecastLeadTimeMilliseconds, table.date),
]);
export type HourlyForecastProviderRunScore = typeof hourlyForecastProviderRunScores.$inferSelect;
export type InsertHourlyForecastProviderRunScore = typeof hourlyForecastProviderRunScores.$inferInsert;

/** Last scheduled hourly-comparison diagnostic cycle per location; not used by scoring. */
export const hourlyComparisonDiagnosticSnapshots = mysqlTable("hourly_comparison_diagnostic_snapshots", {
  locationKey: varchar("locationKey", { length: 32 }).primaryKey(),
  cycleDate: varchar("cycleDate", { length: 10 }).notNull(),
  diagnostics: json("diagnostics").$type<HourlyComparisonDiagnostic[]>().notNull(),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
});
export type HourlyComparisonDiagnosticSnapshot = typeof hourlyComparisonDiagnosticSnapshots.$inferSelect;
export type InsertHourlyComparisonDiagnosticSnapshot = typeof hourlyComparisonDiagnosticSnapshots.$inferInsert;

/**
 * Lead-time scoring — per-model, per-location, per-horizon error metrics.
 * Populated during observation collection by comparing forecasts issued N days
 * before the observation date with the actual observation.
 * Buckets: 0-6h, 6-24h, 1-3d, 4-7d, 8-15d
 */
export const leadTimeScores = mysqlTable("lead_time_scores", {
  id: int("id").autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull().default("default"),
  date: varchar("date", { length: 10 }).notNull(), // observation date YYYY-MM-DD
  serviceName: varchar("serviceName", { length: 64 }).notNull(),
  bucket: varchar("bucket", { length: 10 }).notNull(), // "0-6h", "6-24h", "1-3d", "4-7d", "8-15d"
  maeTemp: float("maeTemp"),
  rmseTemp: float("rmseTemp"),
  biasTemp: float("biasTemp"),
  maePrecip: float("maePrecip"),
  rmsePrecip: float("rmsePrecip"),
  maeWind: float("maeWind"),
  rmseWind: float("rmseWind"),
  sampleSize: int("sampleSize").notNull().default(0),
  evidenceType: mysqlEnum("evidenceType", ["physical_observation", "model_reference", "legacy_unqualified"]).notNull().default("legacy_unqualified"),
  computedAt: timestamp("computedAt").defaultNow().notNull(),
});
export type LeadTimeScore = typeof leadTimeScores.$inferSelect;
export type InsertLeadTimeScore = typeof leadTimeScores.$inferInsert;

/**
 * Observations renseignées par un utilisateur pour son lieu actif.
 * Elles sont une preuve complémentaire, distincte des stations physiques.
 */
export const personalWeatherObservations = mysqlTable("personal_weather_observations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  lat: float("lat").notNull(),
  lon: float("lon").notNull(),
  observedAt: bigint("observedAt", { mode: "number" }).notNull(),
  temperature: float("temperature"),
  condition: varchar("condition", { length: 32 }).notNull(),
  windSpeed: float("windSpeed"),
  precipitation: float("precipitation"), // mm observés durant le créneau en cours
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("personal_weather_observation_user_time_unique").on(table.userId, table.locationKey, table.observedAt),
]);
export type PersonalWeatherObservation = typeof personalWeatherObservations.$inferSelect;
export type InsertPersonalWeatherObservation = typeof personalWeatherObservations.$inferInsert;

/** Une trace par modèle permet d’expliquer chaque évolution de calibration. */
export const personalModelObservationScores = mysqlTable("personal_model_observation_scores", {
  id: int("id").autoincrement().primaryKey(),
  observationId: int("observationId").notNull(),
  modelName: varchar("modelName", { length: 64 }).notNull(),
  temperatureError: float("temperatureError"),
  temperatureScore: float("temperatureScore"),
  conditionScore: float("conditionScore"),
  precipitationError: float("precipitationError"),
  precipitationScore: float("precipitationScore"),
  windScore: float("windScore"),
  overallScore: float("overallScore").notNull(),
  forecastSnapshot: json("forecastSnapshot").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [uniqueIndex("personal_model_score_observation_model_unique").on(table.observationId, table.modelName)]);
export type PersonalModelObservationScore = typeof personalModelObservationScores.$inferSelect;
export type InsertPersonalModelObservationScore = typeof personalModelObservationScores.$inferInsert;

/** État lissé par modèle, lieu et utilisateur ; jamais promu sans preuve suffisante. */
export const personalModelCalibrations = mysqlTable("personal_model_calibrations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  modelName: varchar("modelName", { length: 64 }).notNull(),
  comparisonCount: int("comparisonCount").notNull().default(0),
  scoreEma: float("scoreEma"),
  temperatureMaeEma: float("temperatureMaeEma"),
  conditionScoreEma: float("conditionScoreEma"),
  precipitationScoreEma: float("precipitationScoreEma"),
  windScoreEma: float("windScoreEma"),
  weightMultiplier: float("weightMultiplier").notNull().default(1),
  evidenceState: varchar("evidenceState", { length: 24 }).notNull().default("insufficient"),
  lastObservationAt: bigint("lastObservationAt", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("personal_model_calibration_user_location_model_unique").on(table.userId, table.locationKey, table.modelName),
]);
export type PersonalModelCalibration = typeof personalModelCalibrations.$inferSelect;
export type InsertPersonalModelCalibration = typeof personalModelCalibrations.$inferInsert;

/**
 * Local temperature nowcasting candidates. These records are administrative
 * shadow evidence only: public forecasts, weights and scores never read them.
 * The archived baseline must be available no later than the physical snapshot
 * reference hour, making temporal leakage mechanically auditable.
 */
export const shadowLocalTemperatureNowcasts = mysqlTable("shadow_local_temperature_nowcasts", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  observationDate: varchar("observationDate", { length: 10 }).notNull(),
  observationHour: int("observationHour").notNull(),
  observationReferenceAt: bigint("observationReferenceAt", { mode: "number" }).notNull(),
  observationCollectedAt: bigint("observationCollectedAt", { mode: "number" }).notNull(),
  observedTemperature: float("observedTemperature"),
  stationCount: int("stationCount").notNull().default(0),
  confidenceScore: float("confidenceScore"),
  validTime: bigint("validTime", { mode: "number" }).notNull(),
  horizonMinutes: int("horizonMinutes"),
  candidateStatus: varchar("candidateStatus", { length: 24 }).notNull(),
  baselineTemperature: float("baselineTemperature"),
  rawResidual: float("rawResidual"),
  boundedResidual: float("boundedResidual"),
  correctionFactor: float("correctionFactor").notNull().default(0),
  appliedCorrection: float("appliedCorrection"),
  correctedTemperature: float("correctedTemperature"),
  correctionClamped: int("correctionClamped").notNull().default(0),
  forecastAvailableAt: bigint("forecastAvailableAt", { mode: "number" }),
  forecastEvidence: json("forecastEvidence").notNull(),
  reasons: json("reasons").notNull(),
  productionReadsEnabled: int("productionReadsEnabled").notNull().default(0),
  shadowMode: int("shadowMode").notNull().default(1),
  appliedToProduction: int("appliedToProduction").notNull().default(0),
  evaluatedAt: bigint("evaluatedAt", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("shadow_local_nowcast_obs_time_valid_uq").on(
    table.locationKey,
    table.observationReferenceAt,
    table.validTime,
  ),
  index("shadow_local_nowcast_location_evaluated_idx").on(table.locationKey, table.evaluatedAt),
  index("shadow_local_nowcast_status_idx").on(table.candidateStatus),
  index("shadow_local_nowcast_applied_idx").on(table.appliedToProduction),
]);
export type ShadowLocalTemperatureNowcast = typeof shadowLocalTemperatureNowcasts.$inferSelect;
export type InsertShadowLocalTemperatureNowcast = typeof shadowLocalTemperatureNowcasts.$inferInsert;

/**
 * Local precipitation nowcasting candidates. The physical precipitation
 * interval is not normalized across stations, so this table stores a
 * categorical occurrence signal only and never a corrected amount in mm.
 * Public forecasts, scores and production weights never read these rows.
 */
export const shadowLocalPrecipitationNowcasts = mysqlTable("shadow_local_precipitation_nowcasts", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  observationDate: varchar("observationDate", { length: 10 }).notNull(),
  observationHour: int("observationHour").notNull(),
  observationReferenceAt: bigint("observationReferenceAt", { mode: "number" }).notNull(),
  observationCollectedAt: bigint("observationCollectedAt", { mode: "number" }).notNull(),
  observedPrecipitation: float("observedPrecipitation"),
  stationCount: int("stationCount").notNull().default(0),
  confidenceScore: float("confidenceScore"),
  validTime: bigint("validTime", { mode: "number" }).notNull(),
  horizonMinutes: int("horizonMinutes"),
  candidateStatus: varchar("candidateStatus", { length: 24 }).notNull(),
  baselinePrecipitation: float("baselinePrecipitation"),
  baselineWet: int("baselineWet"),
  observedWet: int("observedWet"),
  localWetSignal: int("localWetSignal").notNull().default(0),
  continuationFactor: float("continuationFactor").notNull().default(0),
  forecastAvailableAt: bigint("forecastAvailableAt", { mode: "number" }),
  forecastEvidence: json("forecastEvidence").notNull(),
  reasons: json("reasons").notNull(),
  productionReadsEnabled: int("productionReadsEnabled").notNull().default(0),
  shadowMode: int("shadowMode").notNull().default(1),
  appliedToProduction: int("appliedToProduction").notNull().default(0),
  evaluatedAt: bigint("evaluatedAt", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("shadow_local_precip_nowcast_obs_time_valid_uq").on(
    table.locationKey,
    table.observationReferenceAt,
    table.validTime,
  ),
  index("shadow_local_precip_nowcast_location_evaluated_idx").on(table.locationKey, table.evaluatedAt),
  index("shadow_local_precip_nowcast_status_idx").on(table.candidateStatus),
  index("shadow_local_precip_nowcast_applied_idx").on(table.appliedToProduction),
]);
export type ShadowLocalPrecipitationNowcast = typeof shadowLocalPrecipitationNowcasts.$inferSelect;
export type InsertShadowLocalPrecipitationNowcast = typeof shadowLocalPrecipitationNowcasts.$inferInsert;

/** Immutable shadow-only record of a composed local-precipitation forecast emission. */
export const shadowLocalPrecipitationForecastEmissions = mysqlTable("shadow_local_precipitation_forecast_emissions", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  observationDate: varchar("observationDate", { length: 10 }).notNull(),
  observationHour: int("observationHour").notNull(),
  observationReferenceAt: bigint("observationReferenceAt", { mode: "number" }).notNull(),
  referenceSnapshotId: int("referenceSnapshotId").notNull(),
  referenceCollectedAt: bigint("referenceCollectedAt", { mode: "number" }).notNull(),
  referenceSnapshot: json("referenceSnapshot").notNull(),
  /** Actual shadow candidate composition/availability time; never reconstructed from a later evaluation. */
  emittedAt: bigint("emittedAt", { mode: "number" }).notNull(),
  availableAt: bigint("availableAt", { mode: "number" }).notNull(),
  validTime: bigint("validTime", { mode: "number" }).notNull(),
  horizonMinutes: int("horizonMinutes").notNull(),
  candidateStatus: varchar("candidateStatus", { length: 24 }).notNull(),
  baselinePrecipitation: float("baselinePrecipitation"),
  baselineWet: int("baselineWet"),
  localWetSignal: int("localWetSignal").notNull().default(0),
  candidateWet: int("candidateWet"),
  continuationFactor: float("continuationFactor").notNull().default(0),
  forecastAvailableAt: bigint("forecastAvailableAt", { mode: "number" }),
  forecastAccumulationWindow: json("forecastAccumulationWindow"),
  forecastProvenance: json("forecastProvenance").notNull(),
  productionReadsEnabled: int("productionReadsEnabled").notNull().default(0),
  shadowMode: int("shadowMode").notNull().default(1),
  appliedToProduction: int("appliedToProduction").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  uniqueIndex("shadow_local_precip_emission_ref_valid_uq").on(
    table.locationKey,
    table.observationReferenceAt,
    table.validTime,
  ),
  index("shadow_local_precip_emission_location_valid_idx").on(table.locationKey, table.validTime),
  index("shadow_local_precip_emission_location_emitted_idx").on(table.locationKey, table.emittedAt),
]);
export type ShadowLocalPrecipitationForecastEmission = typeof shadowLocalPrecipitationForecastEmissions.$inferSelect;
export type InsertShadowLocalPrecipitationForecastEmission = typeof shadowLocalPrecipitationForecastEmissions.$inferInsert;

/** Future-label linkage lives separately from the immutable forecast emission. */
export const shadowLocalPrecipitationForecastOutcomes = mysqlTable("shadow_local_precipitation_forecast_outcomes", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  emissionId: bigint("emissionId", { mode: "number" }).notNull(),
  locationKey: varchar("locationKey", { length: 32 }).notNull(),
  validTime: bigint("validTime", { mode: "number" }).notNull(),
  horizonMinutes: int("horizonMinutes").notNull(),
  outcomeStatus: varchar("outcomeStatus", { length: 64 }).notNull(),
  futureSnapshotId: int("futureSnapshotId"),
  futureReferenceAt: bigint("futureReferenceAt", { mode: "number" }),
  futureCollectedAt: bigint("futureCollectedAt", { mode: "number" }),
  futureObservedAt: bigint("futureObservedAt", { mode: "number" }),
  sourceObservationIds: json("sourceObservationIds").notNull(),
  sourceObservations: json("sourceObservations").notNull(),
  observedPrecipitation: float("observedPrecipitation"),
  observedWet: int("observedWet"),
  accumulationWindow: json("accumulationWindow"),
  unavailabilityReason: varchar("unavailabilityReason", { length: 128 }),
  productionReadsEnabled: int("productionReadsEnabled").notNull().default(0),
  shadowMode: int("shadowMode").notNull().default(1),
  appliedToProduction: int("appliedToProduction").notNull().default(0),
  evaluatedAt: bigint("evaluatedAt", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  uniqueIndex("shadow_local_precip_outcome_emission_uq").on(table.emissionId),
  index("shadow_local_precip_outcome_location_status_idx").on(table.locationKey, table.outcomeStatus),
  index("shadow_local_precip_outcome_location_valid_idx").on(table.locationKey, table.validTime),
]);
export type ShadowLocalPrecipitationForecastOutcome = typeof shadowLocalPrecipitationForecastOutcomes.$inferSelect;
export type InsertShadowLocalPrecipitationForecastOutcome = typeof shadowLocalPrecipitationForecastOutcomes.$inferInsert;
