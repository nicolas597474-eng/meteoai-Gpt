import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LocalModelContributionNotice,
  type LocalModelContributionNoticeProps,
} from "./LocalModelContributionNotice";

const baseProps: LocalModelContributionNoticeProps = {
  localMode: "local",
  isPlaceholderData: false,
  estimateTemperature: 18.4,
  stationCount: 3,
  modelContribution: 18.1,
  modelWeight: 0.07,
  usesOfficialFallback: false,
  usesModelFallback: false,
};

function renderNotice(overrides: Partial<LocalModelContributionNoticeProps> = {}): string {
  return renderToStaticMarkup(createElement(LocalModelContributionNotice, { ...baseProps, ...overrides }));
}

describe("notice de contribution modèle du contexte local", () => {
  it("présente le réglage Local sans le qualifier de part effective ni d’observation", () => {
    const markup = renderNotice();

    expect(markup).toContain("CONTEXTE COURANT · ESTIMATION LOCALE");
    expect(markup).toContain("Snapshot de modèle Open-Meteo inclus (pas une observation)");
    expect(markup).toContain("Réglage modèle : 7 %");
    expect(markup).toContain("part finale appliquée : indisponible");
    expect(markup).toContain("Distinct de la prévision officielle");
  });

  it("affiche le réglage Ultra-local de 2 %", () => {
    const markup = renderNotice({ localMode: "ultra-local", modelWeight: 0.02 });

    expect(markup).toContain("Réglage modèle : 2 %");
  });

  it.each([
    ["snapshot modèle absent", { modelContribution: null }],
    ["température locale absente", { estimateTemperature: null }],
    ["aucune station de température admise", { stationCount: 0, usesOfficialFallback: true }],
    ["repli sur la fusion de modèles", { stationCount: 0, usesModelFallback: true, modelWeight: 0 }],
    ["poids désactivé", { modelWeight: 0 }],
    ["mode Standard", { localMode: "standard" as const }],
    ["données placeholder d’un autre mode ou lieu", { isPlaceholderData: true }],
  ])("ne montre aucune part modèle pour %s", (_scenario, overrides) => {
    expect(renderNotice(overrides)).toBe("");
  });
});
