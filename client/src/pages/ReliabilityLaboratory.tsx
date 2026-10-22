import { lazy, Suspense, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { BackToTopButton } from "@/components/BackToTopButton";
import { YesterdayVerificationPanel } from "@/components/weather/YesterdayVerificationPanel";
import {
  ReliabilityNotesSummary,
  HorizonEvidenceSection,
} from "@/components/weather/ReliabilityEvidenceSections";
import { MethodologySection } from "@/components/weather/ReliabilityComparisonSections";
import { MeteoSurface } from "@/components/weather/MeteoSurface";
import { useLocation } from "@/contexts/LocationContext";
import { usePageWeatherSky } from "@/hooks/usePageWeatherSky";
import { trpc } from "@/lib/trpc";
import AssistantBlock from "@/assistant/AssistantBlock";
import type { ReliabilityHorizonId } from "@shared/reliabilityHorizons";

/**
 * Le graphique de tendance est le seul consommateur de la bibliothèque recharts
 * (372 ko brut / 108 ko gzip). Son import différé évite de télécharger et
 * d'analyser cette bibliothèque avant le premier rendu de la page : l’assistant,
 * les notes et tableaux de preuves s'affichent immédiatement, le graphique se
 * complète ensuite avec son propre squelette.
 */
const ReliabilityTrendChart = lazy(() =>
  import("@/components/weather/ReliabilityTrendChart").then(({ ReliabilityTrendChart: Component }) => ({ default: Component })),
);

function ReliabilityTrendChartFallback() {
  return (
    <MeteoSurface tone="lab" as="section" className="overflow-hidden rounded-[1.6rem] p-4 sm:p-5" aria-hidden="true">
      <div className="h-5 w-44 animate-pulse rounded bg-slate-800/45" />
      <div className="mt-4 min-h-[16rem] animate-pulse rounded-2xl bg-slate-800/35" />
    </MeteoSurface>
  );
}

type HorizonId = ReliabilityHorizonId;

function DataUnavailableCard({ isError }: { isError: boolean }) {
  return (
    <MeteoSurface
      tone="lab"
      as="section"
      className="rounded-2xl p-5"
      role="status"
    >
      <p className="text-sm font-semibold text-white">
        {isError
          ? "Laboratoire momentanément indisponible"
          : "Préparation de l’audit"}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        {isError
          ? "L’historique réel ne peut pas être lu. Aucune métrique n’est estimée."
          : "Lecture des preuves archivées pour le lieu et la période sélectionnés…"}
      </p>
    </MeteoSurface>
  );
}

export default function ReliabilityLaboratory() {
  const { activeLocation } = useLocation();
  const { style: pageSkyStyle } = usePageWeatherSky();
  const period = "7d" as const;
  const [horizon, setHorizon] = useState<HorizonId>("6-24h");
  const locationName = activeLocation?.name ?? "Hondeghem";
  const input = useMemo(
    () => ({
      lat: activeLocation?.lat ?? 50.7567,
      lon: activeLocation?.lon ?? 2.5204,
      period,
      horizon,
    }),
    [activeLocation?.lat, activeLocation?.lon, period, horizon]
  );
  const yesterdayInput = useMemo(
    () => ({
      lat: activeLocation?.lat ?? 50.7567,
      lon: activeLocation?.lon ?? 2.5204,
    }),
    [activeLocation?.lat, activeLocation?.lon]
  );

  const { data, isLoading, isError } =
    trpc.weather.getReliabilityLaboratory.useQuery(input, {
      staleTime: 5 * 60 * 1000,
    });
  const {
    data: yesterdayData,
    isLoading: yesterdayLoading,
    isError: yesterdayError,
  } = trpc.weather.getYesterdayForecastObservation.useQuery(yesterdayInput, {
    staleTime: 5 * 60 * 1000,
  });
  const audit = data as any;

  return (
    <main
      className="weather-page-sky min-h-screen bg-[#080a0f] pb-28"
      style={pageSkyStyle}
    >
      <div className="mx-auto max-w-6xl space-y-4 px-3 pt-3 sm:space-y-5 sm:px-5 sm:pt-5">
        <h1 className="sr-only">Fiabilité</h1>

        <AssistantBlock period={period} horizon={horizon} />

        {data ? (
          <ReliabilityNotesSummary data={audit} />
        ) : (
          <DataUnavailableCard isError={isError} />
        )}

        <Suspense fallback={<ReliabilityTrendChartFallback />}>
          <ReliabilityTrendChart
            hourlyPoints={audit?.comparisons?.hourly ?? []}
            dailyPoints={audit?.comparisons?.daily ?? []}
            periodLabel={audit?.comparisons?.periodLabel}
            hourlyWindow={audit?.comparisons?.hourlyWindow}
            basis={audit?.comparisons?.basis}
            isLoading={isLoading}
            isError={isError}
          />
        </Suspense>

        {data ? (
          <>
            <HorizonEvidenceSection
              data={audit}
              selectedHorizon={horizon}
              onSelectHorizon={setHorizon}
            />
            <MethodologySection data={audit} />
          </>
        ) : null}

        <details className="group rounded-2xl border border-slate-800/80 bg-slate-950/25 p-3.5 sm:p-4">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
            <span>Détail des comparaisons d’hier et de leurs sources</span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="mt-3">
            <YesterdayVerificationPanel
              data={yesterdayData}
              locationName={locationName}
              isLoading={yesterdayLoading}
              isError={yesterdayError}
            />
          </div>
        </details>

      </div>
      <BackToTopButton />
    </main>
  );
}
