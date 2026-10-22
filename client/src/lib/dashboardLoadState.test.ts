import { describe, expect, it } from "vitest";
import { DASHBOARD_LOAD_TIMEOUT_MS, DASHBOARD_PREVIEW_MESSAGE } from "./dashboardLoadState";

describe("états de chargement du Dashboard", () => {
  it("borne l’attente des prévisions", () => {
    expect(DASHBOARD_LOAD_TIMEOUT_MS).toBe(8_000);
  });

  it("explique le mode aperçu sans confondre la prévision officielle et les favoris", () => {
    expect(DASHBOARD_PREVIEW_MESSAGE).toContain("favoris");
    expect(DASHBOARD_PREVIEW_MESSAGE).toContain("prévisions officielles");
  });
});
