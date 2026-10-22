import { describe, expect, it } from "vitest";
import { dashboardTemperatureLayout } from "./dashboardTemperatureLayout";

describe("mise en page de température du Dashboard", () => {
  it("réserve une colonne non réductible aux températures maximale et minimale sur mobile", () => {
    expect(dashboardTemperatureLayout.content).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(dashboardTemperatureLayout.extremes).toContain("shrink-0");
  });

  it("borne la température principale et interdit le retour à la ligne des valeurs", () => {
    expect(dashboardTemperatureLayout.currentValue).toContain("clamp(2.8rem,14vw,3.65rem)");
    expect(dashboardTemperatureLayout.currentValue).toContain("whitespace-nowrap");
    expect(dashboardTemperatureLayout.extremeValue).toContain("whitespace-nowrap");
    expect(dashboardTemperatureLayout.extremeValue).toContain("text-xl");
    expect(dashboardTemperatureLayout.extremeValue).toContain("font-extrabold");
  });

  it("préserve une zone tactile de 44 px tout en compactant les sections mobiles", () => {
    expect(dashboardTemperatureLayout.refreshButton).toContain("min-h-11");
    expect(dashboardTemperatureLayout.compactMetrics).toContain("mt-1");
    expect(dashboardTemperatureLayout.compactMetrics).toContain("sm:mt-3");
  });
});
