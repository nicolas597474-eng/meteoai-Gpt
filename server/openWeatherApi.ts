export const OPENWEATHER_FORECAST_ENDPOINT =
  "https://api.openweathermap.org/data/2.5/forecast";

/** Builds the existing 5-day/3-hour forecast request; never use One Call here. */
export function buildOpenWeatherForecastUrl(input: {
  apiKey: string;
  lat: number;
  lon: number;
}): URL {
  const url = new URL(OPENWEATHER_FORECAST_ENDPOINT);
  url.searchParams.set("lat", String(input.lat));
  url.searchParams.set("lon", String(input.lon));
  url.searchParams.set("appid", input.apiKey);
  url.searchParams.set("units", "metric");
  url.searchParams.set("lang", "fr");
  url.searchParams.set("cnt", "40");
  return url;
}
