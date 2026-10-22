import { MeteoIcon } from "@/components/MeteoIcon";
import { Link } from "wouter";

type TraceSource = {
  id: string;
  name: string;
  type: "station" | "model" | "service";
  finalWeight: number;
  distanceKm?: number;
  distanceWeight?: number;
  qualityWeight?: number;
  freshnessWeight?: number;
  performanceWeight?: number;
};

type ForecastTrace = {
  available?: boolean;
  issuedAt?: string | null;
  snapshotComputedAt?: string | null;
  method?: string;
  sourceCount?: number;
  parameterSources?: {
    temperature: TraceSource[];
    precipitation: TraceSource[];
    wind: TraceSource[];
    humidity: TraceSource[];
  };
  excludedSources?: Array<{ id: string; name: string; reason: string }>;
  message?: string;
};

const PARAMETER_META = [
  { key: "temperature" as const, label: "Température", icon: "temperature", color: "text-orange-300", bar: "bg-orange-400" },
  { key: "precipitation" as const, label: "Précipitations", icon: "precipitation", color: "text-blue-300", bar: "bg-blue-400" },
  { key: "wind" as const, label: "Vent", icon: "wind_param", color: "text-cyan-300", bar: "bg-cyan-400" },
  { key: "humidity" as const, label: "Humidité", icon: "humidity", color: "text-sky-200", bar: "bg-sky-300" },
];

function sourceLabel(type: TraceSource["type"]) {
  return type === "station" ? "Station" : type === "service" ? "Service" : "Modèle";
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
}

export function ForecastTraceability({ trace, compact = false }: { trace?: ForecastTrace | null; compact?: boolean }) {
  const available = !!trace?.parameterSources && trace.available !== false;
  const issuedAt = trace?.snapshotComputedAt ?? trace?.issuedAt;

  return (
    <section className="rounded-2xl border border-sky-500/25 bg-sky-500/5 p-4 sm:p-5" aria-label="Traçabilité de la prévision">
      <div className="flex items-start gap-3">
        <MeteoIcon name="confidence" size={32} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-sky-200">Sources et pondérations de la prévision</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {available
              ? `${trace?.sourceCount ?? 0} source${(trace?.sourceCount ?? 0) > 1 ? "s" : ""} retenue${(trace?.sourceCount ?? 0) > 1 ? "s" : ""} · ${trace?.method ?? "Fusion officielle"}`
              : trace?.message ?? "Traçabilité en attente de la prochaine collecte officielle."}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Générée le {formatDate(issuedAt)} · les pourcentages sont les poids finaux réellement appliqués.
      </p>

      {available && (
        <div className={`mt-4 grid gap-3 ${compact ? "" : "lg:grid-cols-2"}`}>
          {PARAMETER_META.map((parameter) => {
            const sources = trace?.parameterSources?.[parameter.key] ?? [];
            return (
              <div key={parameter.key} className="rounded-xl border border-border/70 bg-background/50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <MeteoIcon name={parameter.icon} size={22} />
                  <h3 className={`text-xs font-semibold ${parameter.color}`}>{parameter.label}</h3>
                </div>
                <div className="space-y-2">
                  {sources.map((source) => {
                    const percent = Math.max(0, source.finalWeight * 100);
                    return (
                      <div key={`${parameter.key}-${source.id}`}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate text-foreground" title={source.name}>{source.name}</span>
                          <span className="shrink-0 font-mono font-semibold text-foreground">{percent.toFixed(2)}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className={`h-full rounded-full ${parameter.bar}`} style={{ width: `${Math.min(percent, 100)}%` }} />
                        </div>
                        {!compact && (
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {sourceLabel(source.type)}
                            {source.qualityWeight != null && source.performanceWeight != null
                              ? ` · qualité ×${source.qualityWeight.toFixed(2)} · historique ×${source.performanceWeight.toFixed(2)}`
                              : " · facteurs détaillés non archivés pour ce snapshot"}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {available && (trace?.excludedSources?.length ?? 0) > 0 && (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer text-sky-300">{trace?.excludedSources?.length} source(s) écartée(s)</summary>
          <ul className="mt-2 space-y-1 pl-4">
            {trace?.excludedSources?.map((source) => <li key={`${source.id}-${source.reason}`}>{source.name} — {source.reason}</li>)}
          </ul>
        </details>
      )}

      <Link href="/weight-comparison" className="mt-4 inline-flex text-xs font-semibold text-sky-300 underline-offset-4 hover:underline">
        Comparer deux prévisions successives
      </Link>
    </section>
  );
}
