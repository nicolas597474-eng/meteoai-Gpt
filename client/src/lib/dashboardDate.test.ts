import { describe, expect, it } from "vitest";
import { formatDashboardCompactDate, formatDashboardDate } from "./dashboardDate";

describe("formatDashboardDate", () => {
  it("affiche une date ISO dans le format français complet demandé", () => {
    expect(formatDashboardDate("2026-08-13")).toBe("Jeudi 13 Août 2026");
  });

  it("préserve la sécurité d’affichage lorsque la date métier est absente ou invalide", () => {
    expect(formatDashboardDate(null)).toBe("—");
    expect(formatDashboardDate("13/08/2026")).toBe("—");
  });

  it("fournit une date complète et lisible pour la pancarte principale", () => {
    expect(formatDashboardCompactDate("2026-08-15")).toBe("Samedi 15 Août 2026");
  });
});
