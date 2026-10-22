import { describe, expect, it } from "vitest";
import {
  filterDailyMetricsForOfficialHourlyCard,
  filterOfficialHourlyCardDetails,
  findNextOfficialHourlyConditionChange,
  getOfficialHourlyCondition,
} from "./officialHourlyCard";

describe("carte de prévision horaire officielle", () => {
  it("traduit le code météo en descriptif sans renvoyer le code brut", () => {
    expect(getOfficialHourlyCondition({ weatherCode: 2 })).toBe(
      "Partiellement nuageux"
    );
    expect(
      getOfficialHourlyCondition({ weatherCode: null, cloudCover: 100 })
    ).toBe("Ciel couvert");
    expect(getOfficialHourlyCondition({})).toBeNull();
  });

  it("trouve uniquement le premier changement descriptif après le validTime sélectionné", () => {
    const selectedAt = Date.parse("2026-10-07T09:00:00.000Z");
    const nextChangeAt = Date.parse("2026-10-07T16:00:00.000Z");
    const hours = [
      { validAt: Date.parse("2026-10-07T08:00:00.000Z"), weatherCode: 61 },
      { validAt: selectedAt, weatherCode: 2 },
      { validAt: selectedAt, weatherCode: 61 },
      { validAt: Date.parse("2026-10-07T12:00:00.000Z"), weatherCode: 2 },
      { validAt: nextChangeAt, weatherCode: 61 },
      { validAt: Date.parse("2026-10-07T18:00:00.000Z"), weatherCode: 3 },
    ];

    expect(findNextOfficialHourlyConditionChange(hours, hours[1])).toBe(
      hours[4]
    );
    expect(
      findNextOfficialHourlyConditionChange(hours, { weatherCode: 2 })
    ).toBeNull();
  });

  it("exclut type/intensité de pluie, rayonnement et code météo brut du bloc détaillé affiché", () => {
    const details = [
      { key: "precipitation" },
      { key: "precip-type" },
      { key: "radiation" },
      { key: "weather-code" },
      { key: "showers" },
      { key: "wind" },
    ];

    expect(
      filterOfficialHourlyCardDetails(details).map(({ key }) => key)
    ).toEqual(["precipitation", "wind"]);
  });

  it("exclut les extrêmes, l’état quotidien et le code WMO brut de la carte horaire", () => {
    const metrics = [
      { key: "tempMax" },
      { key: "tempMin" },
      { key: "condition" },
      { key: "weatherCode" },
      { key: "precipitation" },
    ];

    expect(
      filterDailyMetricsForOfficialHourlyCard(metrics).map(({ key }) => key)
    ).toEqual(["precipitation"]);
  });
});
