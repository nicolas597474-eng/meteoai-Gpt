import { describe, expect, it } from "vitest";
import { COLLECTION_TIME_ZONE, formatCollectionTimestamp } from "./collectionTimestamp";

describe("formatCollectionTimestamp", () => {
  it("affiche la date et l’heure UTC converties explicitement en heure de Paris", () => {
    expect(formatCollectionTimestamp("2026-08-31T03:04:49.000Z")).toBe("31 août 2026 à 05:04 (Europe/Paris)");
  });

  it("respecte le changement d’heure saisonnier du fuseau Europe/Paris", () => {
    expect(formatCollectionTimestamp("2026-01-31T04:04:49.000Z")).toBe("31 janvier 2026 à 05:04 (Europe/Paris)");
  });

  it("signale un horodatage absent ou invalide sans inventer de date", () => {
    expect(formatCollectionTimestamp(null)).toBe("Horodatage indisponible");
    expect(formatCollectionTimestamp("date invalide")).toBe("Horodatage indisponible");
  });

  it("centralise le fuseau utilisé par l’interface", () => {
    expect(COLLECTION_TIME_ZONE).toBe("Europe/Paris");
  });
});
