type DeltaPoint = {
  key: string;
  label: string;
  localTemperature: number;
  officialTemperature: number;
  deltaC: number;
  stationCount: number;
};

export function LocalOfficialDeltaChart({ points }: { points: DeltaPoint[] | undefined }) {
  if (!points?.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/45 px-3 py-3 text-xs text-muted-foreground">
        L’historique se remplira lorsque des relevés physiques seront comparables aux prévisions horaires officielles qualifiées des sept modèles.
      </div>
    );
  }

  const maxDelta = Math.max(1, ...points.map((point) => Math.abs(point.deltaC)));
  const maxColumns = Math.min(points.length, 24);
  const visible = points.slice(-maxColumns);

  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-950/70 px-3 pt-3 pb-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-slate-100">Écart local − moteur horaire officiel</p>
        <p className="text-[10px] text-slate-400">24 h · {visible.length} créneau{visible.length > 1 ? "x" : ""} comparable{visible.length > 1 ? "s" : ""}</p>
      </div>
      <div className="mt-2 flex h-24 items-stretch gap-1.5 overflow-x-auto pb-1" aria-label="Historique des écarts locaux et officiels sur 24 heures">
        {visible.map((point) => {
          const height = Math.max(5, (Math.abs(point.deltaC) / maxDelta) * 38);
          const positive = point.deltaC >= 0;
          return (
            <div key={point.key} className="flex min-w-8 flex-1 flex-col items-center justify-end" title={`${point.label} : local ${point.localTemperature.toFixed(1)}°, moteur horaire officiel ${point.officialTemperature.toFixed(1)}°, écart ${point.deltaC >= 0 ? "+" : ""}${point.deltaC.toFixed(1)}°`}>
              <span className={`mb-1 text-[9px] font-semibold ${positive ? "text-orange-300" : "text-sky-300"}`}>
                {point.deltaC >= 0 ? "+" : ""}{point.deltaC.toFixed(1)}
              </span>
              <div className="flex h-12 w-full items-center justify-center border-y border-slate-800/80">
                <div className={`w-2 rounded-sm ${positive ? "bg-orange-400" : "bg-sky-400"}`} style={{ height }} />
              </div>
              <span className="mt-1 text-[9px] text-slate-500">{point.label}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-slate-500">Orange : mesure locale plus élevée. Bleu : mesure locale plus basse.</p>
    </div>
  );
}
