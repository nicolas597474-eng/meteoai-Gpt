import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./FifteenDayChart.tsx", import.meta.url), "utf8");

describe("FifteenDayChart", () => {
  it("présente les échelles température, vent et pluie à gauche", () => {
    expect(source).toContain("ForecastScaleLabels");
    expect(source).toContain('aria-label="Échelles du graphique de prévisions"');
    expect(source).toContain("windScaleTop");
    expect(source).toContain("precipScaleTop");
    expect(source).toContain("getChartTemperatureScale");
    expect(source).toContain("text-white");
    expect(source).toContain("text-emerald-400");
    expect(source).toContain("text-sky-400");
    expect(source).toContain("km/h");
    expect(source).toContain("mm");
    expect(source).toContain("weather-chart-3d");
    expect(source).toContain("rounded-b-xl border-2 border-blue-300/65");
    expect(source).not.toContain("shadow-[0_0_18px");
    expect(source).toContain("`${Math.round(v)} km/h`");
    expect(source).toContain("ctx.fillText(degToCompass(dir), x, y + 14)");
    expect(source).toContain('ctx.font = "bold 11px system-ui"');
    expect(source).toContain("const precipLabelBand = 18");
    expect(source).toContain("ctx.fillText(p.toFixed(1), x, barTop - 5)");
    expect(source).toContain("ctx.fillText(p.toFixed(1), x, precipZoneBot - 5)");
    expect(source).not.toContain("PrecipitationConsensusSummary");
    expect(source).not.toContain("summary={day.precipitationConsensus}");
    expect(source).toContain("if (p == null) return");
    expect(source).toContain("day.precipitation == null ? \"—\"");
    expect(source).toContain('return condition ?? "Conditions indisponibles"');
    expect(source).toContain("cloudCover != null && cloudCover < 30");
    expect(source).not.toContain("getFeltLabelY");
    expect(source).toContain("TEMPERATURE_LABEL_BELOW_GAP, TEMPERATURE_WIND_CLEARANCE");
    expect(source).toContain("TEMPERATURE_LABEL_ABOVE_GAP");
    expect(source).toContain("const maxLabelY = getLabelAboveCurveY(pt.y, tempZoneTop, TEMPERATURE_LABEL_ABOVE_GAP)");
    expect(source).toContain("const tempCurveTop = tempZoneTop + 34");
    expect(source).toContain("tempCurveTop + (1 - (t - scaleBot) / scaleRange)");
    expect(source).toContain('WebkitOverflowScrolling: "touch"');
    expect(source).not.toContain('touchAction: "pan-x"');
    expect(source).not.toContain('overscrollBehavior: "contain"');
    expect(source).toContain('ctx.strokeText(`${v.toFixed(1)}`, pt.x, minLabelY)');
    expect(source).not.toContain("ctx.shadowBlur = 10");
    expect(source).not.toContain("Ressenti °C");
  });

  it("affiche la prévision détaillée au-dessus du graphique sélectionné", () => {
    expect(source).toContain("detailPanelRef");
    expect(source).toContain("behavior: reduced?'auto':'smooth'");
    expect(source).toContain("scroll-mt-20");
    expect(source).toContain("slide-in-from-top-2");
    expect(source).toContain('role="region"');
    expect(source).toContain("Fermer les détails de la prévision");
    expect(source).toContain("<span>Fermer</span>");
    expect(source).toContain("min-h-11");
  });

  it("n’affiche plus l’accord inter-modèles ni la fréquence de consensus dans le détail du jour", () => {
    expect(source).not.toContain("Accord inter-modèles · dispersions brutes");
    expect(source).not.toContain("formatAgreementSpread");
    expect(source).not.toContain("requestDayOffset");
    expect(source).not.toContain("precipitationWetAmounts");
    expect(source).not.toContain("fréquence de modèles, pas une probabilité calibrée");
    expect(source).not.toContain("Fréquence / estimation de consensus des modèles");
    expect(source).not.toContain("agreement?.horizonDays");
    expect(source).toContain("Estimation pluie (consensus)");
  });

  it("réserve une zone d’alerte séparée des libellés de date", () => {
    expect(source).toContain("chartAlerts");
    expect(source).toContain('aria-label="Alertes météo des prévisions"');
    expect(source).toContain("Alertes météo");
    expect(source).toContain("Chaleur prévue · maximum ≥ 33°C");
    expect(source).not.toContain('ctx.fillText("☀ Canicule"');
  });
});
