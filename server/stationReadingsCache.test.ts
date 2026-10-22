import { beforeEach, describe, expect, it } from "vitest";
import { clearCache, getPreviousReadings, recordStationReading } from "./stationReadingsCache";

describe("stationReadingsCache — timestamps d’observation", () => {
  beforeEach(() => clearCache());

  it("ignore un timestamp répété sans changer la dernière valeur ni les dates de séquence", () => {
    const observedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const timestamp = Date.parse(observedAt);
    recordStationReading("station", 20, observedAt);

    // Même timestamp, même station : même une valeur différente n'est pas une nouvelle observation.
    recordStationReading("station", 22, observedAt);

    expect(getPreviousReadings().get("station")).toEqual({
      temperature: 20,
      timestamp,
      stableSince: timestamp,
    });
  });

  it("prolonge une séquence identique en conservant son origine fournisseur", () => {
    const now = Date.now();
    const firstAt = new Date(now - 90 * 60_000).toISOString();
    const laterAt = new Date(now - 1 * 60_000).toISOString();
    const firstTimestamp = Date.parse(firstAt);
    const laterTimestamp = Date.parse(laterAt);

    recordStationReading("station", 20, firstAt);
    recordStationReading("station", 20, laterAt);

    expect(getPreviousReadings().get("station")).toEqual({
      temperature: 20,
      timestamp: laterTimestamp,
      stableSince: firstTimestamp,
    });
  });

  it("réinitialise l’origine de stabilité quand la valeur change", () => {
    const now = Date.now();
    const firstAt = new Date(now - 30 * 60_000).toISOString();
    const changedAt = new Date(now - 1 * 60_000).toISOString();

    recordStationReading("station", 20, firstAt);
    recordStationReading("station", 20.5, changedAt);

    expect(getPreviousReadings().get("station")).toEqual({
      temperature: 20.5,
      timestamp: Date.parse(changedAt),
      stableSince: Date.parse(changedAt),
    });
  });

  it("ignore les timestamps invalides et non progressifs au lieu d’utiliser l’heure de traitement", () => {
    const now = Date.now();
    const firstAt = new Date(now - 10 * 60_000).toISOString();
    const olderAt = new Date(now - 20 * 60_000).toISOString();
    const firstTimestamp = Date.parse(firstAt);
    recordStationReading("station", 20, firstAt);
    recordStationReading("station", 21, "not-a-date");
    recordStationReading("station", 22, olderAt);
    recordStationReading("station", 23, firstAt);

    expect(getPreviousReadings().get("station")).toEqual({
      temperature: 20,
      timestamp: firstTimestamp,
      stableSince: firstTimestamp,
    });
  });
});
