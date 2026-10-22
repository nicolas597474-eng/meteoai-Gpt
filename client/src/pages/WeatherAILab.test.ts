import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Weather AI Lab — transparence de fusion", () => {
  it("centralise la méthode et les sources de fusion hors du Dashboard", () => {
    const source = readFileSync(new URL("./WeatherAILab.tsx", import.meta.url), "utf8");
    expect(source).toContain("Simulation de la fusion");
    expect(source).toContain("Pondération finale");
    expect(source).toContain("Poids réellement appliqués par paramètre");
    expect(source).toContain('key: "humidity"');
    expect(source).toContain("Aucune trace disponible.");
    expect(source).toContain("Résultat officiel");
    expect(source).toContain("Données exploitables");
    expect(source).not.toContain("Régime de prévision dominant");
    expect(source).not.toContain("Le Dashboard indique séparément le phénomène immédiat");
    expect(source).toContain("Lexique, méthode et sources");
    expect(source).toContain("AI_LAB_GLOSSARY");
    expect(source).toContain("MeteoAI en quelques mots");
    expect(source).toContain("Comparer avant de privilégier");
    expect(source).toContain("Apprendre sans réécrire le passé");
    expect(source).toContain("Expliquer les limites");
    expect(source).toContain("Accord inter-modèles");
    expect(source).toContain("Fiabilité historique");
    expect(source).toContain("Poids du régime, en clair");
    expect(source).toContain("Exemple : Ciel couvert");
    expect(source).toContain("ne veut pas dire 30 % de nuages");
    expect(source).toContain("Poids moyen d’un modèle");
    expect(source).toContain("Pourquoi plusieurs flux ont le même poids moyen");
    expect(source).toContain("Ce n’est ni une note, ni une chance qu’il ait raison");
    expect(source).toContain("ce n’est pas un classement ni une probabilité");
    expect(source).toContain("AI_LAB_GLOSSARY_EXAMPLES");
    expect(source).toContain("Sources appliquées par paramètre");
    expect(source).toContain("AROME peut aider pour la température");
    expect(source).toContain("Si les modèles prévoient entre 19 et 20 °C");
    expect(source).toContain("Exemple ·");
    expect(source).not.toContain("Exemple simple ·");
    expect(source).toContain("Fermer le Lexique");
    expect(source).toContain("setIsOpen(false)");
    expect(source).toContain("Accord inter-modèles");
    expect(source).toContain("Fiabilité historique");
    expect(source).toContain("Données insuffisantes / —");
    expect(source).toContain("group-open:rotate-180");
    expect(source).toContain("Horizon de prévision");
    expect(source).toContain("MAE");
    expect(source).toContain("RMSE");
    expect(source).toContain("Seuils de décision");
    expect(source).toContain("Observations réelles et analyse nocturne");
    expect(source).toContain("Prévisions de référence · cycle 4 h");
    expect(source).toContain("Analyse de nuit · 00 h 30");
    expect(source).toContain("Journée qualifiée");
    expect(source).toContain("Comparaison et métriques");
    expect(source).toContain("ce n’est donc pas un score immédiat affiché au soir");
    expect(source).toContain("Biais signé · diagnostic non appliqué");
    expect(source).toContain("elle n’est jamais appliquée aux prévisions officielles futures");
    expect(source).not.toContain("Correction de biais");
    expect(source).toContain("Maille et microclimat");
    expect(source).toContain("Sources, provenance et cartes");
    expect(source).toContain("Netatmo Weather API");
    expect(source).toContain("Google Maps JavaScript API");
    expect(source).toContain("Astronomy Engine");
    expect(source).toContain("Visibilité d’éclipse");
    expect(source).toContain("Ces modèles sont archivés pour une validation historique");
    expect(source).toContain("gain de fiabilité n’est pas mesuré");
    expect(source).toContain("Définition de la mesure");
    expect(source).toContain("formatAgreementRange");
    expect(source).toContain("σ population");
    expect(source).toContain("precipitationWetAmounts");
    expect(source).toContain("fréquence non calibrée");
    expect(source).not.toContain("40 % accord des modèles");
    expect(source).not.toContain("60 % de stabilité des températures maximales");
    expect(source).not.toContain("stabilityScore");
    expect(source).toContain("PopoverClose");
    expect(source).toContain("h-6 w-6");
    expect(source).toContain("Simulation de la fusion");
    expect(source).toContain("Snapshot retenu");
    expect(source).toContain("Collecte des flux");
    expect(source).toContain("Pondération finale");
    expect(source).toContain("Résultat officiel");
    expect(source).not.toContain("Résultat final · contexte des stations locales");
    expect(source).not.toContain("Aucune station physique locale active");
    expect(source).toContain("grid-cols-[minmax(90px,0.72fr)_minmax(0,1.5fr)]");
    expect(source).toContain("before:bg-sky-300/20");
    expect(source).toContain("Étape {activeStep + 1} sur {steps.length}");
    expect(source).toContain("Branche complémentaire · Stations locales");
    expect(source).toContain("Recherche locale");
    expect(source).toContain("Filtre physique");
    expect(source).toContain("Synthèse locale");
    expect(source).toContain("Preuve qualifiée");
    expect(source).toContain("getEvidenceStatus");
    expect(source).toContain("getForecastCollectionReport");
    expect(source).toContain("CollectionOperations");
    expect(source).toContain("Derniers succès de collecte");
    expect(source).toContain("formatCollectionTimestamp");
    expect(source).toContain('collectionMomentLabel(physical, "physical")');
    expect(source).toContain('physicalCollectionSummary(physical)');
    expect(source).toContain("Créneaux sans station qualifiée");
    expect(source).toContain("lastForecastSuccess");
    expect(source).toContain("lastPhysicalCollection");
    expect(source).toContain("noQualifiedStationSlots");
    expect(source).toContain("scheduleCoverage");
    expect(source).toContain("staleTime: 2 * 60_000");
    expect(source).toContain("staleTime: 5 * 60_000");
    expect(source).toContain("Prévisions · 7 modèles horaires officiels + 1 agrégateur de référence");
    expect(source).toContain("scheduleCoverage");
    expect(source).toContain("expectedHourlyModels");
    expect(source).toContain("Stations météorologiques ·");
    expect(source).toContain("relevés physiques");
    expect(source).toContain("expectedForecastModels.map");
    expect(source).toContain("Q = prévision quotidienne archivée ; H = archive horaire reçue");
    expect(source).toContain("Le total horaire ne compte que les sept modèles officiels");
    expect(source).toContain("const expectedHourlyModels = forecastCollectionReport?.expectedHourlyModels");
    expect(source).toContain("forecastCollectionSnapshot.hourlyModelCount");
    expect(source).toContain("forecastNamedModelCount");
    expect(source).toContain("forecastCompositionLabel");
    expect(source).toContain("Open-Meteo · Best Match");
    expect(source).toContain("getForecastModelGuide");
    expect(source).toContain("Ouvrir la fiche du flux");
    expect(source).toContain("Comprendre le modèle");
    expect(source).toContain("Comment il fonctionne");
    expect(source).toContain("Ce que MeteoAI en fait");
    expect(source).toContain("Limite à connaître");
    expect(source).toContain("Touchez un nom pour connaître son rôle");
    expect(source).toContain("ForecastFlowStatusLegend");
    expect(source).toContain("ForecastFlowStatusBadge");
    expect(source).toContain("Statut opérationnel de tous les flux de prévision");
    expect(source).toContain('operationalStatus?.status ?? "FAILED"');
    expect(source).toContain("Couverture quotidienne par champ");
    expect(source).toContain("Confirmations d’écriture horaire par champ");
    expect(source).toContain("ancienneté mesurée");
    expect(source).toContain("projection précédente conservée");
    expect(source).toContain("currentProjection");
    expect(source).toContain("currentProjection.complete");
    expect(source).toContain("lot incomplet ou complétude non confirmée");
    expect(source).toContain("Aucune limite de péremption n’est appliquée.");
    expect(source).toContain("sourceStatusCounts");
    expect(source).toContain("sourceIssues");
    expect(source).toContain("valeur présente mais invalide");
    expect(source).toContain("instant reçu sous une autre heure/offset local");
    expect(source).toContain("Prévisions quotidiennes des modèles officiels");
    expect(source).not.toContain("Prévisions quotidiennes des contributeurs");
    expect(source).toContain("Limite du produit documentée");
    expect(source).toContain("Support de cette moyenne quotidienne non confirmé");
    expect(source).toContain("Open-Meteo · Best Match");
    expect(source).toContain("hors des sept modèles officiels");
    expect(source).toContain("dailyVariableCoverage");
    expect(source).toContain("variableCoverage");
    expect(source).toContain('import { BackToTopButton } from "@/components/BackToTopButton"');
    expect(source).toContain("<BackToTopButton />");
    expect(source).toContain('className="order-[-2] grid grid-cols-2 gap-2 sm:grid-cols-4"');
    expect(source).toContain('className="order-[-4] flex items-center justify-between gap-2"');
    expect(source).toContain("getLocalNowcastingReports");
    expect(source).toContain('enabled: diagnosticsEnabled && user?.role === "admin"');
    expect(source).toContain("setDiagnosticsEnabled(true)");
    expect(source).toContain("LocalTemperatureNowcastingPanel");
    expect(source).toContain("LocalPrecipitationNowcastingPanel");
    expect(source).toContain('user?.role === "admin" && localNowcastingReports?.temperature');
    expect(source).toContain('user?.role === "admin" && localNowcastingReports?.precipitation');
    expect(source).toContain("HourlyComparisonDiagnosticsPanel");
    expect(source).not.toContain("getShadowDataHubReport");
    expect(source).not.toContain("Data Hub canonique shadow");
    expect(source).not.toContain("Observation P1.6");
  });

  it("expose un bloc Paramètres qui lit la trace de fusion sans inventer de valeur", () => {
    const source = readFileSync(new URL("./WeatherAILab.tsx", import.meta.url), "utf8");
    expect(source).toContain('aria-labelledby="lab-parameters-title"');
    expect(source).toContain(">Paramètres<");
    expect(source).toContain("parameterOfficialValues");
    expect(source).toContain("Poids réellement appliqués par paramètre");
    expect(source).toContain("Valeur officielle fusionnée :");
    expect(source).toContain("Valeur officielle non exposée pour ce paramètre.");
    expect(source).toContain("Aucune source appliquée dans la trace.");
    expect(source).toContain("Aucune trace disponible.");
    expect(source).toContain("poids cumulé");
    expect(source).toContain("Paramètres de la fusion");
    // Le bloc reste en haut de la page : avant la grille de statistiques.
    expect(source).toContain(
      'className="order-[-2] rounded-2xl border border-violet-400/20 bg-violet-400/[0.045] p-4" aria-labelledby="lab-parameters-title"',
    );
    const parametersIndex = source.indexOf('aria-labelledby="lab-parameters-title"');
    const statisticsIndex = source.indexOf(
      'className="order-[-2] grid grid-cols-2 gap-2 sm:grid-cols-4"',
    );
    expect(parametersIndex).toBeGreaterThan(-1);
    expect(parametersIndex).toBeLessThan(statisticsIndex);
  });

  it("propose un bloc Paramètres Application tout en haut avec effets 3D et boussole / capteurs", () => {
    const source = readFileSync(new URL("./WeatherAILab.tsx", import.meta.url), "utf8");
    expect(source).toContain('aria-labelledby="app-settings-title"');
    expect(source).toContain("Paramètres Application");
    expect(source).toContain("Effets 3D de l’application");
    expect(source).toContain("Mouvement et orientation");
    expect(source).toContain("storeDashboardWeatherEffectsMode");
    expect(source).toContain("getDashboardWeatherEffectsModeLabel");
    expect(source).toContain("useDeviceOrientation");
    expect(source).toContain("Autoriser l’orientation");
    expect(source).toContain("Brave, Safari, Chrome");

    // Vérifie que le bloc est tout en haut de la page (ordre -3, avant la fusion et les statistiques)
    expect(source).toContain('className="order-[-3] rounded-2xl border border-sky-400/25');
  });

  it("permet de masquer la provenance des données météo sur toutes les pages", () => {
    const source = readFileSync(new URL("./WeatherAILab.tsx", import.meta.url), "utf8");

    // Le réglage est branché sur la préférence partagée, pas sur un état local au bloc.
    expect(source).toContain('import { useProvenanceDisplay } from "@/contexts/ProvenanceDisplayContext"');
    expect(source).toContain("const { showProvenance, toggleShowProvenance } = useProvenanceDisplay();");
    expect(source).toContain("Provenance des données météo");
    expect(source).toContain("onClick={toggleShowProvenance}");
    expect(source).toContain("Masque sur toutes les pages météo les mentions de source et de fraîcheur");
    expect(source).toContain("Open-Meteo · 09:00 · il y a 11 min");
    expect(source).toContain("Provenance · {showProvenance ? \"affichée\" : \"masquée\"}");
    expect(source).toContain("aria-pressed={!showProvenance}");
    // Le réglage est un masque d’affichage : aucune donnée n’est modifiée.
    expect(source).toContain("Les données, sources et traces restent identiques");
  });

  it("applique le réglage de provenance aux pages météo et au graphe horaire", () => {
    const dashboard = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
    const hourlyChart = readFileSync(new URL("../components/HourlyChart.tsx", import.meta.url), "utf8");
    const byDay = readFileSync(new URL("../components/weather/ForecastByDaySection.tsx", import.meta.url), "utf8");
    const calculationTimes = readFileSync(
      new URL("../components/weather/OfficialForecastCalculationTimes.tsx", import.meta.url),
      "utf8",
    );

    expect(dashboard).toContain('import { useProvenanceDisplay } from "@/contexts/ProvenanceDisplayContext"');
    expect(dashboard).toContain("const currentProvenanceLabel = (field?: CurrentStateFieldLike | null) =>");
    expect(dashboard).toContain("const regimeSourceLabel = showProvenance ? regimeProvenance.sourceLabel : \"\";");

    expect(hourlyChart).toContain("const { showProvenance } = useProvenanceDisplay();");
    expect(hourlyChart).toContain("{showProvenance && activeHourMeasurementLabel && (");

    expect(byDay).toContain("const { showProvenance } = useProvenanceDisplay();");
    expect(byDay).toContain("{showProvenance && <span className=\"min-w-0 rounded-full border border-sky-100/15");
    expect(byDay).toContain("{showProvenance && <details className=\"group px-1 text-xs text-slate-300\">");

    expect(calculationTimes).toContain("const { showProvenance } = useProvenanceDisplay();");
    expect(calculationTimes).toContain("if (!showProvenance) return null;");
  });

  it("sépare la disponibilité réelle de la calibration et des scores historiques", () => {
    const source = readFileSync(new URL("./WeatherAILab.tsx", import.meta.url), "utf8");
    expect(source).toContain("Une absence hors portée n’est pas un échec de performance");
    expect(source).toContain("L’incertitude statistique n’est pas mesurée ici.");
    expect(source).toContain("Un contributeur reste affiché en statut SINGLE_MODEL");
    expect(source).toContain("UNCALIBRATED_ROBUST");
    expect(source).toContain("UNCALIBRATED_ROBUST");
    expect(source).not.toContain("Aucune valeur n’est affichée lorsqu’il manque une trace, plusieurs contributeurs ou des preuves physiques qualifiées.");
  });

  it("présente explicitement la dernière fusion archivée sans la confondre avec la prévision actuelle", () => {
    const source = readFileSync(new URL("./WeatherAILab.tsx", import.meta.url), "utf8");
    expect(source).toContain("snapshotStatus");
    expect(source).not.toContain("Dernière fusion archivée");
    expect(source).toContain("photo enregistrée à un moment précis");
    expect(source).toContain("photo conservée des modèles reçus");
    expect(source).not.toContain("Débuter dans l’AI Lab");
    expect(source).not.toContain("Lire l’écran en trois gestes");
    expect(source).not.toContain("SnapshotPhotoGuide");
    expect(source).not.toContain(">Actualiser</button>");
    expect(source).toContain('"Réessayer"');
  });

  it("intègre le panneau d’écarts descriptifs sans confondre snapshot modèle, prévisions et stations", () => {
    const page = readFileSync(new URL("./WeatherAILab.tsx", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../components/weather/ForecastAlignmentPanel.tsx", import.meta.url), "utf8");

    expect(page).toContain("ForecastAlignmentPanel");
    expect(page).toContain("data.forecastComparison");
    expect(panel).toContain("Instantané courant du modèle");
    expect(panel).toContain("pas un relevé physique");
    expect(panel).toContain("Heure d’émission fournisseur exacte : non archivée");
    expect(panel).toContain("Écart brut (prévision horaire − snapshot modèle)");
    expect(panel).toContain("ni une erreur vérifiée");
    expect(panel).toContain("ne corrigent pas les prévisions futures");
    expect(panel).not.toContain("confidenceScore");
    expect(panel).not.toContain("stationData");
  });

  it("rafraîchit les stations avant les preuves puis relit les pages, même si un flux échoue", async () => {
    const {refreshAILabInOrder}=await import('../lib/aiLabRefresh');
    const calls:string[]=[];
    const result=await refreshAILabInOrder({stations:async()=>{calls.push('stations');throw Error('fixture');},references:async()=>{calls.push('references');},readers:[async()=>{calls.push('daily');return 1;},async()=>{calls.push('hourly');return 2;}]});
    expect(calls).toEqual(['stations','references','daily','hourly']);
    expect(result.map(row=>row.status)).toEqual(['fulfilled','fulfilled']);
  });
});
