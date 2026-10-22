import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface MeteoMetricProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  icon?: ReactNode;
  detail?: ReactNode;
  className?: string;
}

/** Présente une valeur déjà calculée ; aucun formatage ou calcul météo implicite. */
export function MeteoMetric({ label, value, unit, icon, detail, className }: MeteoMetricProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon ? <span aria-hidden="true">{icon}</span> : null}
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-1 truncate text-lg font-semibold leading-none text-foreground">
        {value}{unit ? <span className="ml-1 text-xs font-medium text-muted-foreground">{unit}</span> : null}
      </p>
      {detail ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
