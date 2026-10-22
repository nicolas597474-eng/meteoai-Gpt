import { describe, expect, it } from "vitest";
import {
  FAVORITES_FORECAST_CADENCE_ENV,
  getActiveParisForecastHours,
  getFavoritesForecastCadence,
  getFavoritesForecastScheduleLabel,
  getRequiredFavoritesForecastHeartbeatCron,
} from "./forecastScheduleConfig";

describe("configuration de cadence du batch de prévisions", () => {
  it("active les six créneaux de quatre heures par défaut côté application", () => {
    expect(getFavoritesForecastCadence({})).toBe("every-4-hours");
    expect(getActiveParisForecastHours({})).toEqual([1, 5, 9, 13, 17, 21]);
    expect(getFavoritesForecastScheduleLabel({})).toBe("01:00, 05:00, 09:00, 13:00, 17:00, 21:00");
    expect(getRequiredFavoritesForecastHeartbeatCron()).toBe("0 0 0,3,4,7,8,11,12,15,16,19,20,23 * * *");
  });

  it("garde les six heures Paris avec la valeur runtime explicite 4h", () => {
    const env = { [FAVORITES_FORECAST_CADENCE_ENV]: "4h" };
    expect(getFavoritesForecastCadence(env)).toBe("every-4-hours");
    expect(getActiveParisForecastHours(env)).toEqual([1, 5, 9, 13, 17, 21]);
    expect(getFavoritesForecastScheduleLabel(env)).toBe("01:00, 05:00, 09:00, 13:00, 17:00, 21:00");
  });

  it("permet le mode quotidien historique uniquement avec l’override explicite daily-05", () => {
    const env = { [FAVORITES_FORECAST_CADENCE_ENV]: "daily-05" };
    expect(getFavoritesForecastCadence(env)).toBe("daily-05");
    expect(getActiveParisForecastHours(env)).toEqual([5]);
    expect(getFavoritesForecastScheduleLabel(env)).toBe("05:00");
  });

  it("retombe de façon conservative à 05:00 pour une surcharge runtime non reconnue", () => {
    const env = { [FAVORITES_FORECAST_CADENCE_ENV]: "hourly" };
    expect(getActiveParisForecastHours(env)).toEqual([5]);
  });
});
