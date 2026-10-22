import type {
  DailyForecastObservationComparison,
  DailyForecastObservationComparisonRevision,
} from "../drizzle/schema";
import { isComparableDailyForecastObservationPair } from "./dailyForecastVerification";

export const DAILY_PHYSICAL_COMPARISON_VARIABLES = [
  "temperature_max",
  "temperature_min",
  "precipitation_sum",
  "wind_speed_max",
  "wind_gust_max",
] as const satisfies readonly DailyForecastObservationComparison["variable"][];

export const DAILY_PHYSICAL_COMPARISON_HORIZONS = [
  "0-6h",
  "6-24h",
  "1-3d",
  "4-7d",
  "8-15d",
] as const satisfies readonly DailyForecastObservationComparison["horizonBucket"][];

export type DailyPhysicalComparisonCursor = {
  validDate: string;
  id: number;
};

export type DailyPhysicalComparisonHistoryFilters = {
  locationKey: string;
  validDateFrom?: string;
  validDateTo?: string;
  serviceName?: string;
  variable?: DailyForecastObservationComparison["variable"];
  horizonBucket?: DailyForecastObservationComparison["horizonBucket"];
  cursor?: DailyPhysicalComparisonCursor;
  pageSize?: number;
};

export type DailyPhysicalComparisonHistoryUnavailableReason =
  | "database_unavailable"
  | "table_unavailable";

type DailyPhysicalComparisonHistoryRecord = Pick<DailyForecastObservationComparison,
  | "id"
  | "locationKey"
  | "evidenceType"
  | "observationIsQualified"
  | "forecastAvailableAt"
  | "observationWindowStartAt"
  | "observationWindowEndAt"
  | "stationEvidence"
  | "validDate"
  | "serviceName"
  | "variable"
  | "horizonBucket"
>;

export type DailyPhysicalComparisonHistoryPage<T extends DailyPhysicalComparisonHistoryRecord = DailyForecastObservationComparison> =
  | {
      status: "available";
      rows: T[];
      hasMore: boolean;
      nextCursor: DailyPhysicalComparisonCursor | null;
    }
  | {
      status: "empty";
      rows: [];
      hasMore: false;
      nextCursor: null;
    }
  | {
      status: "unavailable";
      reason: DailyPhysicalComparisonHistoryUnavailableReason;
      rows: [];
      hasMore: false;
      nextCursor: null;
    };

export const DEFAULT_DAILY_COMPARISON_PAGE_SIZE = 25;
export const MAX_DAILY_COMPARISON_PAGE_SIZE = 100;

export function normalizeDailyComparisonPageSize(pageSize?: number): number {
  if (!Number.isInteger(pageSize)) return DEFAULT_DAILY_COMPARISON_PAGE_SIZE;
  return Math.min(MAX_DAILY_COMPARISON_PAGE_SIZE, Math.max(1, pageSize as number));
}

function matchesDailyPhysicalComparison(
  row: DailyPhysicalComparisonHistoryRecord,
  filters: DailyPhysicalComparisonHistoryFilters,
): boolean {
  if (row.locationKey !== filters.locationKey) return false;
  if (row.evidenceType !== "physical_observation" || row.observationIsQualified !== 1) return false;
  if (!isComparableDailyForecastObservationPair(row)) return false;
  if (filters.validDateFrom && row.validDate < filters.validDateFrom) return false;
  if (filters.validDateTo && row.validDate > filters.validDateTo) return false;
  if (filters.serviceName && row.serviceName !== filters.serviceName) return false;
  if (filters.variable && row.variable !== filters.variable) return false;
  if (filters.horizonBucket && row.horizonBucket !== filters.horizonBucket) return false;
  if (filters.cursor) {
    const isBeforeCursor = row.validDate < filters.cursor.validDate
      || (row.validDate === filters.cursor.validDate && row.id < filters.cursor.id);
    if (!isBeforeCursor) return false;
  }
  return true;
}

export function buildDailyPhysicalComparisonHistoryPage<T extends DailyPhysicalComparisonHistoryRecord>(
  queryRows: T[],
  filters: DailyPhysicalComparisonHistoryFilters,
): DailyPhysicalComparisonHistoryPage<T> {
  const pageSize = normalizeDailyComparisonPageSize(filters.pageSize);
  const matchingRows = queryRows
    .filter((row) => matchesDailyPhysicalComparison(row, filters))
    .sort((left, right) => right.validDate.localeCompare(left.validDate) || right.id - left.id);
  const hasMore = matchingRows.length > pageSize;
  const rows = matchingRows.slice(0, pageSize);
  if (rows.length === 0) {
    return { status: "empty", rows: [], hasMore: false, nextCursor: null };
  }
  const lastRow = rows.at(-1)!;
  return {
    status: "available",
    rows,
    hasMore,
    nextCursor: hasMore ? { validDate: lastRow.validDate, id: lastRow.id } : null,
  };
}

export function unavailableDailyPhysicalComparisonHistory<T extends DailyPhysicalComparisonHistoryRecord = DailyForecastObservationComparison>(
  reason: DailyPhysicalComparisonHistoryUnavailableReason,
): DailyPhysicalComparisonHistoryPage<T> {
  return { status: "unavailable", reason, rows: [], hasMore: false, nextCursor: null };
}

export type DailyPhysicalComparisonRevisionHistoryPage = DailyPhysicalComparisonHistoryPage<DailyForecastObservationComparisonRevision>;
