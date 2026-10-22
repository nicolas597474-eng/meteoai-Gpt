import { MeteoIcon } from "@/components/MeteoIcon";

export function ForecastMetricDefinitions({ className = "" }: { className?: string }) {
  return (
    <section className={`rounded-2xl border border-sky-400/20 bg-sky-400/[0.045] p-3 ${className}`} aria-label="Comprendre accord inter-modèles et fiabilité historique">
      <div className="flex items-start gap-2.5">
        <MeteoIcon name="confidence" size={23} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-sky-100">Accord et fiabilité ne sont pas la même mesure</p>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-300"><strong className="text-slate-100">Accord inter-modèles</strong> : étendues brutes par variable et échéance (°C, mm, km/h, degrés), avec le nombre de modèles ayant fourni une valeur; Best Match et autres agrégateurs sont exclus. Ces dispersions décrivent l’accord des sources, pas une incertitude statistique. <strong className="text-slate-100">Couverture et qualité physiques</strong> : effectifs et contrôles des observations de stations sont distincts du nombre de modèles et ne se déduisent pas de leur accord. <strong className="text-slate-100">Incertitude statistique</strong> : non mesurée dans cette vue. <strong className="text-slate-100">Fiabilité historique</strong> : MAE, RMSE et biais séparés par modèle × variable × horizon, calculés contre des observations physiques qualifiées; les effectifs, dates et seuils sont affichés. Aucune note globale 0–100 n’est déduite de ces mesures.</p>
        </div>
      </div>
    </section>
  );
}
