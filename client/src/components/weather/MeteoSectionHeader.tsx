import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface MeteoSectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** En-tête de section de présentation ; il ne choisit ni ne transforme de données. */
export function MeteoSectionHeader({ title, description, icon, action, className }: MeteoSectionHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon ? <span className="shrink-0" aria-hidden="true">{icon}</span> : null}
          <h2 className="min-w-0 text-base font-semibold tracking-tight text-foreground">{title}</h2>
        </div>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
