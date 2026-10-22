import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DailyPhysicalComparisonsPanel.tsx", import.meta.url), "utf8");

describe("DailyPhysicalComparisonsPanel", () => {
  it("attribue provider au fournisseur de prévision et ne prétend pas connaître la station d’observation", () => {
    expect(source).toContain("Fournisseur de la prévision : {row.provider}");
    expect(source).toContain("la source de l’observation physique n’est pas enregistrée");
    expect(source).not.toContain("Provenance enregistrée : {row.provider}");
  });

  it("explique neutralement l’indisponibilité de l’archive sans conclure sur la migration", () => {
    expect(source).toContain("la cause de cette indisponibilité n’est pas déterminée");
    expect(source).not.toContain("0045_daily_fusion_performance.sql");
    expect(source).toContain("Aucune table Phase 8 shadow ne sert de substitut.");
  });
});
