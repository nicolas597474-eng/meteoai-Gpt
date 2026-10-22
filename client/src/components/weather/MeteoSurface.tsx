import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type MeteoSurfaceTone = "default" | "subtle" | "inset" | "accent" | "lab";

export const meteoSurfaceClasses: Record<MeteoSurfaceTone, string> = {
  default: "weather-surface border border-border bg-card text-card-foreground",
  subtle: "weather-surface-subtle border border-border/70 bg-card/65 text-card-foreground",
  inset: "weather-surface-inset border border-border/70 bg-background/55 text-card-foreground",
  accent: "weather-surface-accent border border-primary/25 bg-primary/5 text-card-foreground",
  lab: "weather-surface-lab border border-slate-800 bg-[#0d131d] text-slate-100",
};

export interface MeteoSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  tone?: MeteoSurfaceTone;
  as?: "div" | "section" | "article" | "aside" | "p" | "header";
}

/**
 * Cadre visuel sans logique métier. Les pages restent propriétaires des données,
 * dimensions, bordures et interactions propres à leur rendu de référence.
 */
export function MeteoSurface({ tone = "default", as: Component = "div", className, ...props }: MeteoSurfaceProps) {
  return <Component className={cn(meteoSurfaceClasses[tone], className)} {...props} />;
}
