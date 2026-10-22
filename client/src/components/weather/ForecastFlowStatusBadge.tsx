export type ForecastFlowOperationalStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "STALE";

const STATUS_META: Record<ForecastFlowOperationalStatus, { tone: string; explanation: string }> = {
  SUCCESS: {
    tone: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
    explanation: "Quotidien et horaire archivés dans un bilan récent.",
  },
  PARTIAL: {
    tone: "border-amber-300/25 bg-amber-300/10 text-amber-100",
    explanation: "Une seule granularité est archivée.",
  },
  FAILED: {
    tone: "border-rose-300/25 bg-rose-300/10 text-rose-100",
    explanation: "Aucune preuve exploitable dans le dernier bilan.",
  },
  STALE: {
    tone: "border-slate-400/30 bg-slate-400/10 text-slate-200",
    explanation: "Le dernier bilan dépasse le seuil de 30 heures.",
  },
};

export function ForecastFlowStatusBadge({ status, reason }: { status: ForecastFlowOperationalStatus; reason?: string | null }) {
  const meta = STATUS_META[status];
  return <span title={reason ?? meta.explanation} aria-label={`${status} : ${reason ?? meta.explanation}`} className={`mt-1 inline-flex rounded-full border px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.08em] ${meta.tone}`}>{status}</span>;
}

export function ForecastFlowStatusLegend() {
  return <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-lg border border-white/10 bg-slate-950/20 p-2 text-[9px] leading-relaxed sm:grid-cols-4" aria-label="Légende des statuts opérationnels">
    {(Object.entries(STATUS_META) as Array<[ForecastFlowOperationalStatus, (typeof STATUS_META)[ForecastFlowOperationalStatus]]>).map(([status, meta]) => <div key={status}><span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.08em] ${meta.tone}`}>{status}</span><p className="mt-1 text-slate-400">{meta.explanation}</p></div>)}
  </div>;
}
