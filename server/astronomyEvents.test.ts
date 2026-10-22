import { describe, expect, it } from "vitest";
import { buildAstronomyOutlook } from "./astronomyEvents";

describe("buildAstronomyOutlook", () => {
  it("expose les prochains repères lunaires, solaires et éclipses sans inventer de météo lointaine", () => {
    const outlook = buildAstronomyOutlook({
      dates: ["2026-08-18", "2026-08-21", "2026-08-24", "2026-08-28", "2026-09-01"],
      moonPhases: [0.2, 0.5, 0.74, 0.97, 0.2],
      daylightDurations: [51_000, 50_880],
      cloudCoverMeans: [20, 40, 65, 80, null],
      today: "2026-08-18",
      referenceInstant: new Date("2026-08-20T01:36:00.000Z"),
      timeZone: "Europe/Paris",
    });

    expect(outlook.moonMilestones.find((event) => event.id === "full_moon")?.date).toBe("2026-08-28");
    expect(outlook.nextSolarMilestone).toEqual({ label: "Équinoxe de septembre", date: "2026-09-23" });
    expect(outlook.daylightChangeTomorrowSeconds).toBe(-120);
    expect(outlook.upcomingEclipses[0]).toMatchObject({ title: "Éclipse lunaire partielle", date: "2026-08-28", skyOutlook: { cloudCoverMean: 80 } });
    expect(outlook.upcomingEclipses[1]?.skyOutlook).toBeNull();
    expect(outlook.upcomingMeteorShowers[0]).toMatchObject({ title: "Orionides", date: "2026-10-21", zhr: 20, skyOutlook: null });
    expect(outlook.eventMapLayers[0]).toMatchObject({ eventId: "lunar_partial_2026_08_28", type: "lunar", date: "2026-08-28" });

    const autumnOutlook = buildAstronomyOutlook({ dates: [], moonPhases: [], daylightDurations: [], cloudCoverMeans: [], today: "2026-09-30" });
    expect(autumnOutlook.eventMapLayers[0]).toMatchObject({ eventId: "orionids_2026", type: "meteor", date: "2026-10-21" });
    const penumbralLayer = autumnOutlook.eventMapLayers.find((layer) => layer.eventId === "lunar_penumbral_2027_02_20");
    expect(penumbralLayer?.type).toBe("lunar");
    expect(penumbralLayer?.visibilityCells.length).toBeGreaterThan(0);
  });

  it("conserve une alerte solaire avec sa consigne de sécurité", () => {
    const outlook = buildAstronomyOutlook({ dates: [], moonPhases: [], daylightDurations: [], cloudCoverMeans: [], today: "2026-07-01" });
    const solar = outlook.upcomingEclipses.find((event) => event.id === "solar_partial_2027_08_02");
    expect(solar?.visibility).toBe("Partielle depuis la France");
    expect(solar?.safetyNote).toContain("lunettes d’éclipse homologuées");
    expect(outlook.upcomingMeteorShowers.find((event) => event.id === "leonids_2026")?.zhr).toBe(15);
  });

  it("calcule les jalons dans le fuseau du lieu au lieu d’extrapoler une fraction de cycle", () => {
    const outlook = buildAstronomyOutlook({
      dates: ["2026-08-20"], moonPhases: [0.26], daylightDurations: [], cloudCoverMeans: [], today: "2026-08-20",
      referenceInstant: new Date("2026-08-20T01:36:00.000Z"), timeZone: "Europe/Paris",
    });
    expect(outlook.moonMilestones.find((event) => event.id === "full_moon")?.date).toBe("2026-08-28");
    expect(outlook.moonMilestones.find((event) => event.id === "new_moon")?.date).toBe("2026-09-11");
  });
});
