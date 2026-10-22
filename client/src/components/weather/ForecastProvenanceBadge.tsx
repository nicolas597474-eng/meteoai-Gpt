import { CalendarDays, Clock3, TriangleAlert } from "lucide-react";

export type ForecastProvenanceData = {
  kind: "hourly_forecast" | "daily_fusion" | "unavailable";
  label: string;
  detail: string;
  updatedAt: string | null;
  source: string | null;
  fallbackReason: "hourly_unavailable" | "no_hourly_or_daily_fusion" | null;
  hourlyCoverage: number;
  dailyCoverage: number;
  modelsUsed: number;
};

function displayDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

export function ForecastProvenanceBadge({ data, className = "" }: { data: ForecastProvenanceData | null | undefined; className?: string }) {
  if (!data) return null;
  const updatedAt = displayDate(data.updatedAt);
  const isUnavailable = data.kind === "unavailable";
  const isDailyFallback = data.kind === "daily_fusion";
  const Icon = isUnavailable ? TriangleAlert : isDailyFallback ? CalendarDays : Clock3;
  const tone = isUnavailable
    ? "border-rose-300/30 bg-rose-400/[0.07] text-rose-100"
    : isDailyFallback
      ? "border-amber-300/30 bg-amber-300/[0.08] text-amber-100"
      : "border-sky-300/25 bg-sky-400/[0.06] text-sky-100";

  return (
    <section role="status" aria-label="Provenance météo" className={`rounded-xl border px-3 py-2 ${tone} ${className}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em]">{data.label}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed opacity-90">{data.detail}</p>
          <p className="mt-1 text-[9px] opacity-75">
            {updatedAt ? `Donnée calculée le ${updatedAt} (Europe/Paris)` : "Horodatage indisponible"}
            {data.source ? ` · ${data.source}` : ""}
            {data.kind === "hourly_forecast" ? ` · ${data.hourlyCoverage} h disponibles` : ""}
          </p>
        </div>
      </div>
    </section>
  );
}
