export type OpenWeatherFallbackField =
  | "temperature"
  | "windSpeed"
  | "windDirection"
  | "humidity"
  | "cloudCover";

export type OpenWeatherHourlyFieldSource = {
  provider: "OpenWeatherMap";
  endpoint: "https://api.openweathermap.org/data/2.5/forecast";
  product: "Forecast 5 jours / 3 heures";
  validAt: number;
  /** When the application obtained the response; not the forecast generation time. */
  retrievedAt: string;
  /** OpenWeather Forecast does not attest its provider run time. */
  providerRunAt: null;
  upstreamFreshness: "unknown";
};

export type HourlyFallbackProvenance = Partial<
  Record<OpenWeatherFallbackField, OpenWeatherHourlyFieldSource>
>;
