export type DatedForecastHour = {
  date?: string | null;
  hour?: string | null;
  validAt?: number | null;
};

export type IndexedForecastHour<T extends DatedForecastHour> = {
  index: number;
  hour: T;
};

export type ForecastDayGroup<T extends DatedForecastHour> = {
  date: string;
  hours: IndexedForecastHour<T>[];
};

export type ForecastTimelineSelection = {
  dayDate: string | null;
  hourIndex: number | null;
  expanded: boolean;
};

export type GroupedForecastHours<T extends DatedForecastHour> = {
  days: ForecastDayGroup<T>[];
  undatedHours: number;
};

export type HourlyModelMetricProvenance = {
  source?: string | null;
  bestMatchIncluded?: boolean | null;
};

export function isOfficialSevenModelSource(metrics: HourlyModelMetricProvenance | null | undefined): boolean {
  return metrics?.source === "official_seven_models" && metrics.bestMatchIncluded === false;
}

function isLocalDateKey(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Group only by the explicit local date carried by the official hourly contract.
 * A missing or malformed date is deliberately not inferred from a timestamp.
 */
export function groupOfficialHourlyForecastByDate<T extends DatedForecastHour>(
  hours: readonly T[],
): GroupedForecastHours<T> {
  const byDate = new Map<string, ForecastDayGroup<T>>();
  let undatedHours = 0;

  hours.forEach((hour, index) => {
    if (!isLocalDateKey(hour.date)) {
      undatedHours += 1;
      return;
    }
    const group = byDate.get(hour.date) ?? { date: hour.date, hours: [] };
    group.hours.push({ index, hour });
    byDate.set(hour.date, group);
  });

  return { days: Array.from(byDate.values()), undatedHours };
}

export function getInitialForecastTimelineSelection<T extends DatedForecastHour>(
  groups: readonly ForecastDayGroup<T>[],
  activeHourIndex: number,
): ForecastTimelineSelection {
  const day = groups.find((group) => group.hours.some(({ index }) => index === activeHourIndex)) ?? groups[0];
  if (!day) return { dayDate: null, hourIndex: null, expanded: false };

  const activeHour = day.hours.find(({ index }) => index === activeHourIndex);
  return {
    dayDate: day.date,
    hourIndex: activeHour?.index ?? day.hours[0]?.index ?? null,
    expanded: true,
  };
}

export function getSelectedForecastHourIndex<T extends DatedForecastHour>(
  selection: ForecastTimelineSelection,
  group: ForecastDayGroup<T>,
  activeHourIndex: number,
): number | null {
  if (selection.dayDate === group.date && selection.hourIndex != null
    && group.hours.some(({ index }) => index === selection.hourIndex)) {
    return selection.hourIndex;
  }
  return group.hours.find(({ index }) => index === activeHourIndex)?.index
    ?? group.hours[0]?.index
    ?? null;
}

export function selectForecastDay<T extends DatedForecastHour>(
  selection: ForecastTimelineSelection,
  group: ForecastDayGroup<T>,
  activeHourIndex: number,
): ForecastTimelineSelection {
  if (selection.dayDate === group.date) {
    return { ...selection, expanded: !selection.expanded };
  }
  const activeHour = group.hours.find(({ index }) => index === activeHourIndex);
  return {
    dayDate: group.date,
    hourIndex: activeHour?.index ?? group.hours[0]?.index ?? null,
    expanded: true,
  };
}

export function selectForecastHour<T extends DatedForecastHour>(
  selection: ForecastTimelineSelection,
  group: ForecastDayGroup<T>,
  hourIndex: number,
): ForecastTimelineSelection {
  if (!group.hours.some(({ index }) => index === hourIndex)) return selection;
  return { dayDate: group.date, hourIndex, expanded: true };
}

/** Format a contractual numeric value; zero is data, while null/NaN stays unavailable. */
export function formatOptionalForecastValue(
  value: number | null | undefined,
  decimals = 0,
  unit = "",
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)}${unit}`;
}
