import { useMemo, type CSSProperties } from "react";
import { useLocation } from "@/contexts/LocationContext";
import { getDashboardWeatherImage } from "@/lib/weatherImages";
import { getActiveOfficialForecastHour } from "@/lib/officialForecast";
import { useOfficialForecast } from "@/hooks/useOfficialForecast";

type SkyInput = {
  condition?: string | null;
  regime?: string | null;
  temperature?: number | null;
  cloudCover?: number | null;
  precipitation?: number | null;
  windSpeed?: number | null;
};

/** Sélectionne le même ciel que le Dashboard, à partir du snapshot officiel. */
export function selectPageWeatherSky(input: SkyInput): string {
  return getDashboardWeatherImage({
    condition: input.condition,
    regime: input.regime,
    temperature: input.temperature ?? undefined,
    cloudCover: input.cloudCover ?? undefined,
    precipitation: input.precipitation ?? undefined,
    windSpeed: input.windSpeed ?? undefined,
  });
}

export function usePageWeatherSky(options: { includeExtendedPeriods?: boolean } = {}) {
  const { activeLocation } = useLocation();
  const { query: { data } } = useOfficialForecast(activeLocation, options);
  const forecastNowMs = Date.now();
  const image = useMemo(() => {
    const hours = (data?.hours ?? []) as Array<any>;
    const active = getActiveOfficialForecastHour(hours, forecastNowMs)?.hour ?? hours[0] ?? null;
    const today = (data?.days ?? [])[0] as any;
    return selectPageWeatherSky({
      condition: active?.condition ?? today?.condition,
      regime: (data?.regime as any)?.primary?.label,
      temperature: active?.temp ?? today?.tempMax,
      cloudCover: active?.cloudCover ?? today?.cloudCover,
      precipitation: active?.precipitation ?? today?.precipitation,
      windSpeed: active?.windSpeed ?? today?.windSpeed,
    });
  }, [data, forecastNowMs]);

  const style = useMemo(() => ({ "--page-weather-sky-image": `url("${image}")` } as CSSProperties), [image]);
  return { style, image };
}
