export type HourlyInsightPoint = {
  temp?: number | null;
  apparentTemp?: number | null;
  precipitation?: number | null;
  precipProb?: number | null;
  humidity?: number | null;
  dewPoint?: number | null;
  windSpeed?: number | null;
  windGust?: number | null;
  pressure?: number | null;
  visibility?: number | null;
  cloudCover?: number | null;
  uvIndex?: number | null;
  solarRadiation?: number | null;
  windDirection?: number | null;
};

export type HourlyInsights = {
  nextHoursCount: number;
  temperatureDelta: number | null;
  temperatureAtEnd: number | null;
  precipitationTotal: number | null;
  precipitationProbabilityMax: number | null;
  gustMax: number | null;
  cloudEnd: number | null;
  cloudDelta: number | null;
  pressureDelta: number | null;
  dewPointGap: number | null;
  dataCoverage: number;
};

function sumNumbers(values: Array<number | null | undefined>): number | null {
  const measured = values.filter((value): value is number => value != null);
  return measured.length > 0 ? measured.reduce((total, value) => total + value, 0) : null;
}

function maxNumber(values: Array<number | null | undefined>): number | null {
  const measured = values.filter((value): value is number => value != null);
  return measured.length > 0 ? Math.max(...measured) : null;
}

/**
 * Derives short-term indicators exclusively from points in the official hourly forecast.
 * It never substitutes missing measurements with estimated values.
 */
export function getHourlyDetailInsights<T extends HourlyInsightPoint>(hours: readonly T[], selectedIndex: number): HourlyInsights {
  const hour = hours[selectedIndex];
  const nextHours = hours.slice(selectedIndex + 1, selectedIndex + 4);
  const endHour = nextHours[nextHours.length - 1] ?? null;
  const previousHour = hours[Math.max(0, selectedIndex - 2)] ?? null;
  const fields = [
    hour?.temp, hour?.apparentTemp, hour?.precipitation, hour?.precipProb,
    hour?.humidity, hour?.dewPoint, hour?.windSpeed, hour?.windGust,
    hour?.pressure, hour?.visibility, hour?.cloudCover, hour?.uvIndex,
    hour?.solarRadiation, hour?.windDirection,
  ];

  return {
    nextHoursCount: nextHours.length,
    temperatureDelta: hour?.temp != null && endHour?.temp != null ? endHour.temp - hour.temp : null,
    temperatureAtEnd: endHour?.temp ?? null,
    precipitationTotal: sumNumbers(nextHours.map((item) => item.precipitation)),
    precipitationProbabilityMax: maxNumber(nextHours.map((item) => item.precipProb)),
    gustMax: maxNumber(nextHours.map((item) => item.windGust)),
    cloudEnd: endHour?.cloudCover ?? null,
    cloudDelta: hour?.cloudCover != null && endHour?.cloudCover != null ? endHour.cloudCover - hour.cloudCover : null,
    pressureDelta: hour?.pressure != null && previousHour?.pressure != null ? hour.pressure - previousHour.pressure : null,
    dewPointGap: hour?.temp != null && hour?.dewPoint != null ? hour.temp - hour.dewPoint : null,
    dataCoverage: fields.filter((value) => value != null).length,
  };
}
