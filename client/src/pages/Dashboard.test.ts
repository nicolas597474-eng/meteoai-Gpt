import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Dashboard avec état courant sourcé par variable", () => {
  it("préserve les prévisions et affiche la sélection physique ou le snapshot modèle avec sa provenance", () => {
    const source = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
    const metricDefinitions = readFileSync(new URL("../components/weather/ForecastMetricDefinitions.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("Prévision officielle consolidée");
    expect(source).toContain("Moyenne locale pondérée");
    expect(source).toContain("<LocalModelContributionNotice");
    expect(source).toContain("<AltitudeCorrectionNotice correction={locationWeather.ultraLocal.altitudeCorrection}");
    expect(source).toContain('"alt. corrigée" : "brute"');
    expect(source).toContain("isPlaceholderData={locationWeatherIsPlaceholder}");
    expect(source).toContain("modelContribution={locationWeather.ultraLocal.modelContribution}");
    expect(source).toContain("modelWeight={locationWeather.ultraLocal.modelWeight}");
    expect(source).toContain("usesModelFallback={locationWeather.ultraLocal.usesModelFallback}");
    expect(source).toContain("Mes observations");
    expect(source).toContain('<Wind className={"h-3.5 w-3.5 shrink-0 " + WIND_VALUE_COLOR} />Vent actuel');
    expect(source).toContain('MeteoIcon name="humidity" size={16}');
    expect(source).toContain("Précipitations observées (mm)");
    expect(source).toContain("acceptsPersonalPrecipitation");
    expect(source).toContain("Très nuageux");
    expect(source).toContain("Quelques gouttes");
    expect(source).toContain("Forte pluie");
    expect(source).toContain("Enregistrer mon observation");
    expect(source).toContain("personalObservations.submit.useMutation");
    expect(source).toContain("Données insuffisantes");
    expect(source).not.toContain("PrecipitationConsensusChart");
    expect(source).toContain("showCoverageDistribution={false}");
    expect(source).toContain("showFallbackDetails={false}");
    expect(source).not.toContain("<ForecastProvenanceBadge");
    expect(source).toContain("aria-expanded={isPersonalObservationOpen}");
    expect(source).toContain("Consulter mes observations");
    expect(source).toContain("Modifier mon observation");
    expect(source).toContain("deletePersonalObservation.mutate");
    expect(source).toContain("Écart du calcul local avec le snapshot du modèle");
    expect(source).toContain("hasMaterialLocalDelta");
    expect(source).toContain("getCurrentDashboardWeather.useQuery");
    expect(source).toContain("formatCurrentStateProvenance");
    expect(source).toContain("L’indicateur principal utilise les stations physiques retenues ou, champ par champ, le snapshot Open-Meteo");
    expect(source).toContain("Contrôles calculés à cette requête : distance, fraîcheur, fiabilité, cohérence et altitude seulement avec une référence explicite.");
    expect(source).toContain("Couverture locale");
    expect(source).toContain("Stations contributrices");
    expect(source).toContain("localCoverageBands");
    expect(source).toContain("band.effectiveWeight");
    expect(source).toContain("Aucune station contributrice n’est disponible dans ce rayon.");
    expect(source).toContain("showAllLocalContributors");
    expect(source).toContain('localMode: loc.localMode ?? "standard"');
    expect(source).toContain("Tous les régimes");
    expect(source).not.toContain("Comment est calculée la fusion officielle ?");
    expect(source).toContain("Voir les 20 régimes");
    expect(source).not.toContain("max-h-72 overflow-y-auto");
    expect(source).toContain("weightRows");
    expect(source).toContain('role="progressbar"');
    expect(source).toContain("expandedRegimeIds");
    expect(source).toContain("aria-expanded={isExpanded}");
    expect(source).toContain('const needsLocalStations = localMode !== "standard"');
    expect(source).toContain("enabled: !!selectedLocation && needsLocalStations");
    expect(source).toContain("gcTime: 10 * 60 * 1000");
    expect(source).toContain("gcTime: 10 * 60 * 1000");
    expect(source).toContain("Filtre local en cours…");
    expect(source).toContain('onClick={() => handleModeChange("standard")}');
    expect(source).toContain('aria-label="Fermer le contexte local et revenir au mode Officiel"');
    expect(source).toContain("Données horaires temporairement indisponibles.");
    expect(source).toContain("useOfficialForecast(selectedLocation)");
    expect(source).toContain("const officialHours = officialForecast?.hours ?? []");
    expect(source).toContain("const hours = officialHours");
    expect(source).not.toContain("const officialHours: any[]");
    expect(source).not.toContain("personalizedByHour");
    expect(source).toContain("const hours = officialHours");
    expect(source).not.toContain("trpc.weather.getHourlyForecast.useQuery");
    expect(source).not.toContain('refetchOnReconnect: "always"');
    expect(source).not.toContain("refetchInterval: (query) => (query.state.data?.hours?.length ? 5 * 60 * 1000 : 30 * 1000)");
    expect(source).toContain('disabled={hourlyFetching}');
    expect(source).toContain('"Relance en cours…"');
    expect(source).toContain("const isLoading = officialLoading && hourlyLoading");
    expect(source).not.toContain("refetchHourlySnapshot()");
    expect(source).toContain("BackToTopButton");
    expect(source).not.toContain("Hondeghem, Nord");
    expect(source).not.toContain("MapPin");
    expect(source).toContain("candidate?.weights");
    expect(source).toContain("Régime de prévision dominant");
    const contextIndex = source.indexOf('aria-label="Mode de contexte local"');
    const heroRegimeIndex = source.indexOf("/* ── Regime badge ── */");
    const observationsIndex = source.indexOf('aria-labelledby="personal-observation-title"');
    expect(heroRegimeIndex).toBeLessThan(contextIndex);
    expect(observationsIndex).toBeGreaterThan(contextIndex);
    expect(source).not.toContain("{regime && (\n          <DominantRegimePanel");
    expect(source).toContain("currentSnapshot?.condition");
    expect(source).toContain("{regimeSourceLabel} · {regimeFreshnessLabel}");
    // La provenance est conditionnée au réglage « Paramètres Application » de l’AI Lab.
    expect(source).toContain("useProvenanceDisplay");
    expect(source).toContain("const { showProvenance } = useProvenanceDisplay();");
    expect(source).toContain("const regimeSourceLabel = showProvenance ? regimeProvenance.sourceLabel : \"\";");
    expect(source).toContain("const currentProvenanceLabel = (field?: CurrentStateFieldLike | null) =>");
    expect(source).not.toContain("Synthèse horaire");
    expect(source).toContain("Observations actuelles");
    expect(source).not.toContain("Prévisions du jour");
    expect(source).toContain('aria-label="Observations actuelles et valeurs prévisionnelles"');
    expect(source).not.toContain('aria-label="Prévisions horaires, distinctes des observations actuelles"');
    expect(source).toContain("UV prévu pour cette heure");
    expect(source).toContain("Visibilité prévue");
    expect(source).toContain("Visibilité météo, pas spécifique aux nuages");
    expect(source).toContain("formatHourlyForecastValidAt(uvForecastHour?.validAt)");
    expect(source).toContain('uvForecastHour && uvForecastHour !== currentHour ? "UV prévu à l’échéance suivante" : "UV prévu pour cette heure"');
    expect(source).toContain("formatHourlyForecastSource(hourlyForecastSource)");
    expect(source).toContain("formatHourlyForecastComputedAt(hourlyForecastComputedAt)");
    expect(source).toContain("currentProvenanceLabel(windDirectionField)");
    expect(source).toContain("WindRose direction={windDir} />");
    expect(source).toContain("nord en haut. ${directionDescription}");
    expect(source).toContain('size-[5.5rem]');
    expect(source).toContain('sm:size-[6.5rem]');
    expect(source).toContain("labelPositions.map(({ label, x, y, size })");
    expect(source).toContain('"N", "NE", "E", "SE", "S", "SO", "O", "NO"');
    expect(source).toContain("const directionDescription =");
    expect(source).toContain("maximumFractionDigits: 1");
    expect(source).toContain("wind-compass-bezel");
    expect(source).toContain("wind-compass-neon");
    expect(source).not.toContain("speed={windSpeed}");
    expect(source).toContain("title={currentProvenanceTitle(windSpeedField)}");
    expect(source).toContain("formatDashboardNumber(currentHumidity)");
    expect(source).toContain("getRegimeProvenancePresentation({");
    expect(source).not.toContain("officialDataUpdatedAt");
    expect(source).toContain("whitespace-nowrap text-[15px] font-medium leading-tight");
    expect(source).toContain('nextRegimeChange.hour.replace(":00", "h")');
    expect(source).toContain('Évolution · {nextRegimeChange');
    expect(source).toContain('text-white">{displayedCondition');
    expect(source).toContain('text-white">{nextRegimeChange ? nextRegimeChange.label');
    expect(source).not.toContain("Confiance prévision");
    expect(metricDefinitions).toContain("Couverture et qualité physiques");
    expect(metricDefinitions).toContain("Incertitude statistique</strong> : non mesurée dans cette vue");
    expect(metricDefinitions).toContain("Fiabilité historique");
    expect(source).not.toContain('id="forecast-information-panel"');
    expect(source).toContain("Créneaux horaires indisponibles");
    expect(source).toContain("Dernière fusion quotidienne réelle");
    expect(source).toContain('isDailyFallback ? "Tendance quotidienne · " : currentSnapshot || hasAvailableCurrentState ? "État actuel · " : "État courant indisponible · "');
    expect(source).toContain('text-[15px] font-medium leading-tight text-slate-100/90 sm:text-lg');
    expect(source).toContain('formatDashboardCompactDate');
    expect(source).not.toContain('<WeatherStatusBadge dense tone="info"');
    expect(source).not.toContain('CalendarDays className="h-4 w-4 text-sky-300 sm:h-4.5 sm:w-4.5"');
    expect(source).toContain('text-lg font-bold tracking-tight text-slate-50 sm:text-xl');
    expect(source).toContain('space-y-2 px-1 pb-3 pt-[max(env(safe-area-inset-top),0.25rem)]');
    expect(source).toContain('min-h-dvh w-full overflow-x-clip bg-background');
    expect(source).toContain('w-full min-w-0 max-w-none space-y-2');
    expect(source).toContain('sm:max-w-2xl');
    expect(source).toContain('px-3 pb-3 pt-1 sm:p-6');
    expect(source).not.toContain('mb-0.5 flex justify-center sm:mb-3');
    expect(source).toContain('mb-1 flex justify-center sm:mb-1.5');
    expect(source).toContain("État du ciel</p>");
    expect(source).toContain("Open-Meteo");
    expect(source).toContain("Précipitations actuelles");
    expect(source).not.toContain("Pression mesurée localement");
    expect(source).toContain("Pression de surface estimée (modèle)");
    expect(source).toContain("surface_pressure");
    expect(source).toContain("non ramenée au niveau de la mer");
    expect(source).not.toContain("références barométriques des stations non comparables.");
    expect(source).toContain("const currentTemp = currentNumber(temperatureField)");
    expect(source).toContain("withCurrentSnapshotFallback(currentFields?.condition, currentSnapshot?.condition, snapshotCapturedAt)");
    expect(source).toContain("withCurrentSnapshotFallback(currentFields?.temperature, currentSnapshot?.temp, snapshotCapturedAt)");
    expect(source).toContain('aria-label="Condition météo indisponible"');
    expect(source).toContain("Cumul station non comparable");
    expect(source).toContain('{panelDate}');
    expect(source).not.toContain('Tendance · {regimeSourceLabel}');
    expect(source).not.toContain('aria-label="Actualiser la météo maintenant"');
    expect(source).toContain('getExtremeTemperatureTone("max", maxTemperature)');
    expect(source).toContain('getExtremeTemperatureTone("min", minTemperature)');
    expect(source).toContain('maxTemperatureTone.container');
    expect(source).toContain('minTemperatureTone.container');
    expect(source).not.toContain("formatDashboardDate");
    expect(source).toContain("Tout développer");
    expect(source).toContain("Tout réduire");
    expect(source).toContain("overflow-visible rounded-[22px]");
    expect(source).toContain("dashboard-sky-card");
    expect(source).toContain('<div className="dashboard-sky-card relative overflow-hidden');
    expect(source).toContain("dashboard-sky-image");
    expect(source).toContain("getDashboardWeatherImage");
    expect(source).toContain("dashboardSkyStyle");
    expect(source).not.toContain("storeDashboardWeatherEffectsMode(nextWeatherEffectsMode)");
    expect(source).not.toContain("Effets 3D · {getDashboardWeatherEffectsModeLabel(weatherEffectsMode)}");
    expect(source).toContain("displayedCondition");
    expect(source).toContain("currentPrecipitation");
    expect(source).toContain("regime?.label");
    expect(source).toContain("currentTemp");
    expect(source).toContain("currentHour?.visibility");
    expect(source).toContain("windDir");
    expect(source).toContain("currentWindGust");
    expect(source).not.toContain("Voir les prévisions détaillées");
    expect(source).not.toContain('href="/details"');
    expect(source).toContain("dashboardSkyImage");
    expect(source).toContain('temp: pf.forecast.tempCurrent ?? null');
    expect(source).toContain("const activeFavoriteWeather = {");
    expect(source).toContain("activeWeather={activeFavoriteWeather}");
    expect(source).not.toContain('alt="Paysage météo"');
    expect(source).toContain('w-[4.75rem] shrink-0 pt-0.5');
    expect(source).toContain('size={64}');
    expect(source.match(/<MeteoIcon name=\{dashboardCurrentIcon\(displayedCondition,queryInput,forecastNowMs\)\}/g)?.length).toBe(1);
    // Les sections « Santé du dernier lot global » et « Couverture du lieu choisi »
    // sont déplacées en bas de la page Stations (CollectionObservabilitySections).
    expect(source).toContain("Europe/Paris");
    expect(source).not.toContain("Santé du dernier lot global");
    expect(source).not.toContain("Couverture du lieu choisi");
    expect(source).not.toContain("collection-health-panel");
    expect(source).not.toContain("getForecastCollectionReport");
    expect(source).not.toContain("latestCollectionTraceKeyRef");
    expect(source).not.toContain("forecast-collection-title");
    expect(source).toContain("UV prévu pour cette heure");
    expect(source).toContain("Visibilité prévue");
    expect(source).not.toContain("Prévisions du jour");
  });

  it("regroupe observations et prévisions dans un bloc unique sans masquer leur provenance", () => {
    const source = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
    const observationsStart = source.indexOf('<section aria-label="Observations actuelles et valeurs prévisionnelles"');
    expect(observationsStart).toBeGreaterThanOrEqual(0);
    const observationsEnd = source.indexOf("</section>", observationsStart);
    expect(observationsEnd).toBeGreaterThan(observationsStart);
    const observationsSection = source.slice(observationsStart, observationsEnd);
    for (const metric of [
      "Ressenti",
      "Direction du vent",
      "Humidité actuelle",
      "Précipitations actuelles",
      "Vent actuel",
      "Rafales actuelles",
      "Pression de surface estimée (modèle)",
      "Nuages actuels",
      "{currentUVLabel}",
      "Visibilité prévue",
    ]) {
      expect(observationsSection).toContain(metric);
    }
    expect(observationsSection).toContain("formatHourlyForecastValidAt(uvForecastHour?.validAt)");
    expect(observationsSection).toContain("formatHourlyForecastSource(hourlyForecastSource)");
    expect(observationsSection).not.toContain(">Prévisions horaires");
    expect(source).not.toContain('<ForecastProvenanceBadge');
    expect(source).toContain('<HourlyWeightingNotice');
    expect(source).toContain('showCoverageDistribution={false}');
    expect(source).toContain('showFallbackDetails={false}');
    expect(source).not.toContain("<PrecipitationConsensusChart");
    expect(observationsSection).not.toContain("Autres observations actuelles");
    expect(observationsSection.indexOf("Vent actuel")).toBeLessThan(observationsSection.indexOf("Rafales actuelles"));
    expect(observationsSection.indexOf("Humidité actuelle")).toBeLessThan(observationsSection.indexOf("Précipitations actuelles"));
    expect(source.match(/aria-label="Observations actuelles et valeurs prévisionnelles"/g)).toHaveLength(1);
  });

  it("diffère le panneau environnemental lourd jusqu’à l’approche du viewport sans le retirer", () => {
    const source = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
    expect(source).toContain('import("@/components/EnvironmentalPanels")');
    expect(source).toContain('rootMargin: "800px 0px"');
    expect(source).toContain('typeof IntersectionObserver === "undefined"');
    const deferred = source.slice(source.indexOf("function DeferredEnvironmentalPanels"), source.indexOf("function DeferredEnvironmentalPanels") + 2000);
    expect(deferred).toContain("getEnvironmentalSnapshot.useQuery");
    expect(deferred).toContain("enabled: shouldLoad");
    expect(deferred).toContain("<EnvironmentalPanels");
    expect(source).toContain("<DeferredEnvironmentalPanels coords={coordsInput} />");
    expect(source).not.toContain('import { EnvironmentalPanels } from "@/components/EnvironmentalPanels"');
  });

  it("garde les graphiques en rendu différé via leurs imports dynamiques", () => {
    const source = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");

    expect(source).toContain('lazy(() => import("@/components/HourlyChart"))');
    expect(source).toContain('lazy(() => import("@/components/FifteenDayChart"))');
  });

  it("affiche l’état actuel sans attendre le recalcul de l’horizon multi-modèles", () => {
    const source = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");

    expect(source).toContain("trpc.weather.getCurrentModelSnapshot.useQuery");
    expect(source).toContain("!fastCurrentSnapshot");
    expect(source).toContain("officialForecast?.currentSnapshot ?? fastCurrentSnapshot ?? null");
  });

  it("alimente vent, rafales et direction avec la prévision horaire de la page Prévisions, sans les stations", () => {
    const source = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");

    expect(source).toContain("getDashboardWind({");
    expect(source).toContain("hour: currentHour,");
    expect(source).toContain("const windSpeed = dashboardWind.speed;");
    expect(source).toContain("const currentWindGust = dashboardWind.gust;");
    expect(source).toContain("const windDir = dashboardWind.direction;");
    expect(source).not.toContain("currentFields?.windSpeed");
    expect(source).not.toContain("currentFields?.windGust");
    expect(source).not.toContain("currentFields?.windDirection");
    // Même fonction et même arrondi que la page Prévisions : « 33 km/h », pas « 33.0 km/h ».
    expect(source).toContain('formatOptionalForecastValue(windSpeed, 0, " km/h")');
    expect(source).toContain('formatOptionalForecastValue(currentWindGust, 0, " km/h")');
    expect(source).not.toContain("windSpeed.toFixed(1)");
    expect(source).not.toContain("currentWindGust.toFixed(1)");
  });

  it("alimente l’état actuel et les nuages avec la prévision horaire de la page Prévisions", () => {
    const source = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");

    expect(source).toContain("getDashboardSky({");
    expect(source).toContain("const conditionField = dashboardSky.conditionField;");
    expect(source).toContain("const cloudCoverField = dashboardSky.cloudCoverField;");
    expect(source).toContain("const weatherCodeField = dashboardSky.weatherCodeField;");
    // Le snapshot best_match ne reste que le repli hors échéance active, jamais une
    // source mélangée : le hero affichait « Ensoleillé » contre « Partiellement nuageux ».
    expect(source).toContain("condition: withCurrentSnapshotFallback(currentFields?.condition, currentSnapshot?.condition, snapshotCapturedAt)");
    expect(source).toContain("cloudCover: withCurrentSnapshotFallback(currentFields?.cloudCover, currentSnapshot?.cloudCover, snapshotCapturedAt)");
    expect(source).not.toContain("const cloudCoverField = withCurrentSnapshotFallback(");
    expect(source).not.toContain("const weatherCodeField = withCurrentSnapshotFallback(");
    // L’icône du hero et la pastille du lieu actif suivent le même libellé.
    expect(source).toContain("<MeteoIcon name={dashboardCurrentIcon(displayedCondition,queryInput,forecastNowMs)} size={64} />");
    expect(source).toContain("condition: displayedCondition,");
    expect(source).not.toContain("condition: currentSnapshot?.condition ?? (isDailyFallback");
    // Température et humidité gardent leur lecture propre (stations, puis snapshot).
    expect(source).toContain("const humidityField = withCurrentSnapshotFallback(currentFields?.humidity, currentSnapshot?.humidity, snapshotCapturedAt)");
  });

  it("ancre la température du point actuel du graphique horaire sur la mesure des stations physiques", () => {
    const source = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
    expect(source).toContain("getCurrentStationTemperature(temperatureField");
    expect(source).toContain("const chartHours = withCurrentStationTemperature(hours, currentHourIndex, stationTemperature)");
    expect(source).toContain("hours={chartHours}");
    expect(source).toContain("activeHourMeasurementLabel={stationTemperature?.provenanceLabel ?? null}");
  });
});
