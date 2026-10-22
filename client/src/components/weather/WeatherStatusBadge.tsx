import type { ReactNode } from "react";
import { CircleHelp, X } from "lucide-react";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type WeatherStatusBadgeTone = "info" | "success" | "warning" | "lab" | "neutral" | "danger";

type WeatherStatusBadgeProps = {
  label: string;
  value?: ReactNode;
  tone?: WeatherStatusBadgeTone;
  icon?: ReactNode;
  pulse?: boolean;
  compact?: boolean;
  dense?: boolean;
  className?: string;
  ariaLabel?: string;
  description?: string;
};

const toneClasses: Record<WeatherStatusBadgeTone, { surface: string; icon: string; label: string; value: string; dot: string }> = {
  info: {
    surface: "border-sky-400/40 bg-[linear-gradient(135deg,rgba(14,116,144,0.28),rgba(15,23,42,0.92))] shadow-[inset_0_1px_0_rgba(186,230,253,0.14)]",
    icon: "border-sky-300/20 bg-sky-400/10 text-sky-200",
    label: "text-sky-100/65",
    value: "text-sky-100",
    dot: "bg-sky-300",
  },
  success: {
    surface: "border-emerald-400/40 bg-[linear-gradient(135deg,rgba(6,95,70,0.28),rgba(15,23,42,0.92))] shadow-[inset_0_1px_0_rgba(167,243,208,0.12)]",
    icon: "border-emerald-300/20 bg-emerald-400/10 text-emerald-200",
    label: "text-emerald-100/65",
    value: "text-emerald-100",
    dot: "bg-emerald-300",
  },
  warning: {
    surface: "border-amber-400/40 bg-[linear-gradient(135deg,rgba(146,64,14,0.28),rgba(15,23,42,0.92))] shadow-[inset_0_1px_0_rgba(253,230,138,0.12)]",
    icon: "border-amber-300/20 bg-amber-400/10 text-amber-200",
    label: "text-amber-100/65",
    value: "text-amber-100",
    dot: "bg-amber-300",
  },
  lab: {
    surface: "border-sky-400/40 bg-[linear-gradient(135deg,rgba(14,116,144,0.28),rgba(15,23,42,0.92))] shadow-[inset_0_1px_0_rgba(186,230,253,0.14)]",
    icon: "border-sky-300/20 bg-sky-400/10 text-sky-200",
    label: "text-sky-100/65",
    value: "text-sky-100",
    dot: "bg-sky-300",
  },
  neutral: {
    surface: "border-slate-500/45 bg-[linear-gradient(135deg,rgba(51,65,85,0.34),rgba(15,23,42,0.94))] shadow-[inset_0_1px_0_rgba(226,232,240,0.1)]",
    icon: "border-slate-400/20 bg-slate-400/10 text-slate-200",
    label: "text-slate-200/60",
    value: "text-slate-100",
    dot: "bg-slate-300",
  },
  danger: {
    surface: "border-rose-400/40 bg-[linear-gradient(135deg,rgba(159,18,57,0.28),rgba(15,23,42,0.92))] shadow-[inset_0_1px_0_rgba(254,205,211,0.12)]",
    icon: "border-rose-300/20 bg-rose-400/10 text-rose-200",
    label: "text-rose-100/65",
    value: "text-rose-100",
    dot: "bg-rose-300",
  },
};

const HELP_POPOVER_TITLE = "À propos de cet indicateur";

export function WeatherStatusBadge({
  label,
  value,
  tone = "info",
  icon,
  pulse = false,
  compact = false,
  dense = false,
  className = "",
  ariaLabel,
  description,
}: WeatherStatusBadgeProps) {
  const styles = toneClasses[tone];
  const hasValue = value !== undefined && value !== null && value !== "";
  const accessibleLabel = ariaLabel ?? (hasValue ? `${label} ${String(value)}` : label);
  const badgeContent = (
    <span
      className={`relative inline-flex max-w-full items-center overflow-hidden border ${compact ? "gap-1 rounded-xl px-1.5 py-1" : dense ? "shrink-0 gap-1.5 rounded-xl px-2 py-1.5" : "shrink-0 gap-2 rounded-2xl px-2.5 py-2"} ${styles.surface} ${className}`}
      aria-label={accessibleLabel}
      data-weather-status-badge={tone}
    >
      <span className={`weather-icon-bare relative flex shrink-0 items-center justify-center border ${compact ? "h-4 w-4 rounded-md" : dense ? "h-5 w-5 rounded-lg" : "h-7 w-7 rounded-xl"} ${styles.icon}`} aria-hidden="true">
        {icon ?? <span className={`${compact ? "h-1.5 w-1.5" : "h-2 w-2"} rounded-full ${styles.dot} ${pulse ? "motion-safe:animate-pulse" : ""}`} />}
        {pulse ? <span className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full border border-[#10131a] ${styles.dot} motion-safe:animate-pulse`} /> : null}
      </span>
      <span className="min-w-0 text-left leading-none">
        <span className={`flex items-center gap-0.5 font-semibold uppercase ${compact ? "text-[7px] tracking-[0.08em]" : dense ? "text-[8px] tracking-[0.12em]" : "text-[9px] tracking-[0.14em]"} ${styles.label}`}><span className="truncate">{label}</span>{description ? <CircleHelp className="h-2 w-2 shrink-0 opacity-55" aria-hidden="true" /> : null}</span>
        {hasValue ? <span className={`block truncate font-bold tracking-tight ${compact ? "mt-0.5 text-[9px]" : dense ? "mt-0.5 text-xs" : "mt-1 text-sm"} ${styles.value}`}>{value}</span> : null}
      </span>
    </span>
  );

  if (!description) return badgeContent;

  return <Popover><PopoverTrigger asChild><button type="button" className="max-w-full cursor-pointer rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300" aria-label={`${accessibleLabel}. Ouvrir l’aide`}>{badgeContent}</button></PopoverTrigger><PopoverContent side="bottom" align="end" sideOffset={8} collisionPadding={12} className="z-[80] w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-slate-600 bg-[#101622] px-3 py-3 text-[11px] leading-relaxed text-slate-100 shadow-xl"><div className="flex items-start justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-200/75">{HELP_POPOVER_TITLE}</p><PopoverClose type="button" aria-label="Fermer l’aide" className="-mt-0.5 -mr-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-700/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><X className="h-3.5 w-3.5" /></PopoverClose></div><p className="mt-1.5 text-slate-200">{description}</p></PopoverContent></Popover>;
}
