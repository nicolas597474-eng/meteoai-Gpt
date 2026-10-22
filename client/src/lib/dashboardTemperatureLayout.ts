/** Classes critiques de la ligne de température. Elles maintiennent une colonne
 * de droite non réductible pour les extrêmes sur les écrans étroits. */
export const dashboardTemperatureLayout = {
  content: "grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 sm:gap-x-5",
  currentValue: "whitespace-nowrap text-[clamp(2.8rem,14vw,3.65rem)] sm:text-8xl font-bold leading-none tracking-tight",
  extremes: "flex shrink-0 flex-col gap-1.5 pt-1 text-right",
  extremeValue: "whitespace-nowrap text-xl sm:text-4xl font-extrabold tracking-tight",
  mobileHeader: "mb-2 flex items-center justify-between gap-2 sm:mb-3",
  refreshButton: "inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1 text-[10px] font-medium text-primary disabled:opacity-60",
  compactMetrics: "grid grid-cols-3 gap-1 mt-1 pt-1 sm:gap-2 sm:mt-3 sm:pt-3",
} as const;
