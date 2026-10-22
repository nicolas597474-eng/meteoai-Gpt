import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./HourlyChart.tsx", import.meta.url), "utf8");

describe("HourlyChart", () => {
  it("présente les échelles avec une seule courbe de température par heure", () => {
    expect(source).toContain("HourlyScaleLabels");
    expect(source).toContain('aria-label="Échelles du graphique horaire"');
    expect(source).toContain("windScaleTop");
    expect(source).toContain("precipScaleTop");
    expect(source).toContain("getChartTemperatureScale");
    expect(source).toContain("text-white");
    expect(source).toContain("text-emerald-400");
    expect(source).toContain("text-sky-400");
    expect(source).toContain("const temperatureLabel = `${v.toFixed(1)}°`");
    expect(source).toContain("ctx.fillText(temperatureLabel, pt.x, temperatureLabelY)");
    expect(source).toContain("getLabelAboveCurveY(pt.y, tempZoneTop, TEMPERATURE_LABEL_ABOVE_GAP)");
    expect(source).toContain("const tempCurveTop = tempZoneTop + 34");
    expect(source).toContain("tempCurveTop + (1 - (t - scaleBot) / scaleRange)");
    expect(source).toContain('WebkitOverflowScrolling: "touch"');
    expect(source).not.toContain('touchAction: "pan-x"');
    expect(source).not.toContain('overscrollBehavior: "contain"');
    expect(source).not.toContain("ctx.shadowBlur = 10");
    expect(source).not.toContain("Ressenti immédiatement sous sa courbe bleue");
    expect(source).not.toContain("apparentLabelY");
    expect(source).not.toContain('> Ressenti</span>');
    expect(source).toContain("ctx.font = `700 ${sel ? 14 : 12}px system-ui`");
    expect(source).toContain("p-2 sm:p-3");
    expect(source).toContain("weather-chart-3d");
    expect(source).toContain("ctx.fillRect(x, 0, COL_W, TOTAL_H)");
    expect(source).toContain('ctx.fillStyle = "#05070a"');
    expect(source).toContain("const visibleN = N");
    expect(source).toContain("Toutes les données sont dessinées immédiatement");
    expect(source).not.toContain("const [animProgress, setAnimProgress]");
    expect(source).toContain("const windLabel = `${Math.round(v)} km/h`");
    expect(source).toContain("`${Math.round(v)} km/h`");
    expect(source).toContain("ctx.fillText(degToCompass(dir), x, y + 14)");
    expect(source).toContain('ctx.font = "700 13px system-ui"');
    expect(source).toContain("const precipLabelBand = 16");
    expect(source).toContain("const drawPrecipLabel");
    expect(source).toContain("drawPrecipLabel(barTop - 5)");
    expect(source).toContain("drawPrecipLabel(precipZoneBot - 5)");
    expect(source).toContain("if (p == null)");
    expect(source).toContain('ctx.fillText("—", x, precipZoneBot - 5)');
    expect(source).toContain("cloudCover != null && cloudCover < 30");
    expect(source).not.toContain("rounded-b-xl border border-blue-300/70");
    expect(source).not.toContain("ctx.strokeRect(x + 0.5, 0.5, COL_W - 1, CHART_H - 1)");
    expect(source).not.toContain("ctx.strokeRect(pt.x - labelWidth / 2 - 4");
    expect(source).not.toContain("ctx.fillRect(pt.x - labelWidth / 2 - 4");
    expect(source).not.toContain("rgba(12, 30, 50, 0.82)");
  });

  it("affiche les détails horaires au-dessus du graphique sélectionné", () => {
    expect(source).toContain("detailPanelRef");
    expect(source).toContain('scrollIntoView({ behavior: "smooth", block: "start" })');
    expect(source).toContain("scroll-mt-3");
    expect(source).toContain("slide-in-from-top-2");
    expect(source).toContain('aria-labelledby="hour-detail-title"');
    expect(source).toContain("Fermer les détails de la prévision horaire");
    expect(source).toContain("<span>Fermer</span>");
    expect(source).toContain("min-h-11");
  });

  it("ancre toujours le début du graphique sur l’heure actuelle", () => {
    expect(source).toContain("Toujours démarrer la zone visible sur l’heure actuelle");
    expect(source).toContain("nowHour * COL_W");
    expect(source).toContain('behavior: "auto"');
    expect(source).toContain("[hours, nowHour, COL_W]");
  });

  it("distingue les créneaux portant la même heure sur des jours consécutifs", () => {
    expect(source).toContain('key={hourlyDetailKey(h)}');
    expect(source).not.toContain("key={h.hour}");
    expect(source).toContain("{N} h");
    expect(source).not.toContain(">24h⌄</span>");
  });

  it("distingue visuellement les deux 02:00 du retour DST quand leurs instants UTC diffèrent", () => {
    expect(source).toContain("formatHourlyDisplay");
    expect(source).toContain("displayPoints");
    expect(source).toContain("displayLabel?.offsetLabel");
    expect(source).toContain("displayLabel.offsetLabel.replace(\"Europe/Paris \", \"\")");
  });

  it("marque clairement le passage à demain dans les prévisions 48 h", () => {
    expect(source).toContain("const dayBoundaryIndexes = useMemo");
    expect(source).toContain('index > 0 && hour.hour === "00:00"');
    expect(source).toContain("ctx.setLineDash([6, 4])");
    expect(source).toContain("rgba(96, 165, 250, 0.88)");
    expect(source).toContain('isNewDay && <span');
    expect(source).toContain(">Demain</span>");
  });

  it("présente tous les paramètres horaires réellement fournis dans le panneau détaillé", () => {
    expect(source).toContain("dewPoint?: number | null");
    expect(source).toContain("pressure?: number | null");
    expect(source).toContain("visibility?: number | null");
    expect(source).toContain("solarRadiation?: number | null");
    expect(source).toContain("cloudLow?: number | null");
    expect(source).toContain("precipIntensity?: string | null");
    expect(source).toContain("Point de rosée");
    expect(source).toContain("Pression de surface");
    expect(source).toContain("Portée {visibilityLabel");
    expect(source).not.toContain("Régime opérationnel");
    expect(source).toContain('MeteoIcon name="wind_param" size={17}');
    expect(source).toContain('MeteoIcon name="humidity" size={17}');
  });

  it("n’affiche plus l’accord inter-modèles ni la fréquence de consensus dans le panneau horaire", () => {
    expect(source).not.toContain("Accord inter-modèles · dispersions brutes");
    expect(source).not.toContain("Accord inter-modèles par dispersion brute");
    expect(source).not.toContain("PrecipitationConsensusSummary");
    expect(source).not.toContain("Fréquence / estimation de consensus des modèles");
    expect(source).toContain("rainModelCount");
    expect(source).toContain("Ce n’est pas une probabilité de pluie calibrée");
    expect(source).not.toContain("dispersion circulaire");
    expect(source).not.toContain("wetPrecipitationStandardDeviation");
    expect(source).not.toContain("metrics?.dispersion");
    expect(source).toContain("multiModelMetrics");
    expect(source).toContain("Dispersion thermique");
    expect(source).toContain("Estimation de consensus");
    expect(source).not.toContain("tempSpread");
    expect(source).not.toContain("precipAgreement");
    expect(source).not.toContain("windAgreementParts");
    expect(source).not.toContain("Repères d’accord");
    expect(source).not.toContain("Indice d’accord des modèles");
    expect(source).not.toContain("frequencyPercent.toFixed");
    expect(source).not.toContain("80–100 %");
    expect(source).not.toContain("60–79 %");
  });

  it("retire les sections de régime et d’évolution à court terme du panneau détaillé", () => {
    expect(source).not.toContain("getHourlyDetailInsights");
    expect(source).not.toContain("Évolution à court terme");
    expect(source).not.toContain("Température à +3 h");
    expect(source).not.toContain("Cumul de pluie à +3 h");
    expect(source).not.toContain("Rafale maximale à +3 h");
    expect(source).not.toContain("Tendance de pression");
    expect(source).not.toContain("Écart temp. / rosée");
  });

  it("signale quand le point actuel du graphique est une mesure des stations physiques", () => {
    expect(source).toContain("activeHourMeasurementLabel");
    expect(source).toContain("Point actuel : mesure des stations physiques Netatmo");
  });
});
