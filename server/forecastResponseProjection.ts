import type { HourlyPoint, DayForecast } from "./weatherServices";
import {projectDailyFusionDetails} from '../shared/dashboardDailyFusion';

/**
 * The Dashboard never exposes the per-variable, per-model historical weight
 * trace. That trace can be tens of kilobytes per hour and is preserved intact
 * for the detailed Forecast page only. This projection removes presentation-
 * irrelevant diagnostics without changing a single meteorological value,
 * provenance field, model-dispersion metric, or calculation result.
 */
export function projectHourlyForecastForDashboard(hours: readonly HourlyPoint[]): HourlyPoint[] {
  return hours.map(({ forecastWeighting: _forecastWeighting, ...hour }) => hour as HourlyPoint);
}

/** La trace complète reste dans la route détaillée ; le Dashboard en reçoit une projection compacte. */
export function projectDailyForecastForDashboard(days: readonly DayForecast[]) {
  return days.map(({ officialFusion, ...day }) => ({
    ...day,
    fusionDetails:projectDailyFusionDetails(officialFusion),
    officialFusion: {
      issuedAt: officialFusion.issuedAt,
      referenceAt: officialFusion.referenceAt,
      horizonBucket: officialFusion.horizonBucket,
      availabilityStatus: officialFusion.availabilityStatus,
      calibrationStatus: officialFusion.calibrationStatus,
    },
  }));
}
