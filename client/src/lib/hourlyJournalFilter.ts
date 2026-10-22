import type { HourlyJournalVariableSummary } from "@shared/hourlyJournalCoverage";
export type HourlyJournalStatus = "attempting" | "succeeded" | "partial" | "failed" | "safe_error";

export type HourlyJournalEntry = {
  model: string;
  modelId: string | null;
  isOfficialModel: boolean;
  status: HourlyJournalStatus;
  requestAttempts: number;
  hoursReceived: number;
  expectedHoursCount?: number;
  variableSummary?: HourlyJournalVariableSummary[];
  valuesReceived: number;
  expectedValueCount: number;
  archiveRowsWritten: number | null;
  projectionRowsWritten: number | null;
  errorCode: string | null;
  attemptedAt: number;
  completedAt: number | null;
};

export type HourlyJournalRow = {
  model: string;
  isOfficialModel: boolean;
  entry: HourlyJournalEntry | null;
};

export type HourlyJournalFilter = "all" | "problems" | "success" | "running" | "missing";
export type HourlyJournalFilterCounts = Record<HourlyJournalFilter, number>;

const PROBLEM_STATUSES = new Set<HourlyJournalStatus>(["partial", "failed", "safe_error"]);

/** Des champs absents n'annulent pas la réception d'un lot complet en heures. */
export function isAvailablePartialJournal(entry: HourlyJournalEntry): boolean {
  return entry.status === "partial" && !entry.errorCode
    && Number.isSafeInteger(entry.expectedHoursCount) && entry.expectedHoursCount! > 0
    && entry.hoursReceived === entry.expectedHoursCount && entry.valuesReceived > 0
    && entry.archiveRowsWritten !== 0 && entry.projectionRowsWritten !== 0;
}

export function hourlyJournalStatusLabel(entry: HourlyJournalEntry): string {
  if(entry.errorCode==='rate_limit_suspended')return 'Appel suspendu · quota';
  if(entry.errorCode==='provider_rate_limited')return 'Refus de quota reçu';
  if (isAvailablePartialJournal(entry)) return "Disponible · données partielles";
  return { attempting: "En cours", succeeded: "Disponible", partial: "Lot incomplet · à vérifier", failed: "Échec", safe_error: "Erreur technique" }[entry.status];
}

const isProblem = (entry: HourlyJournalEntry) => PROBLEM_STATUSES.has(entry.status) && !isAvailablePartialJournal(entry);
const isAvailable = (entry: HourlyJournalEntry) => entry.status === "succeeded" || isAvailablePartialJournal(entry);

export function buildHourlyJournalRows(
  expectedModels: readonly string[],
  entries: readonly HourlyJournalEntry[],
): HourlyJournalRow[] {
  const modelNames = Array.from(new Set([
    ...expectedModels,
    ...entries.map((entry) => entry.model),
  ]));
  const entriesByModel = new Map(entries.map((entry) => [entry.model, entry]));
  const officialModels = new Set(expectedModels);

  return modelNames.map((model) => {
    const entry = entriesByModel.get(model) ?? null;
    return {
      model,
      isOfficialModel: entry?.isOfficialModel ?? officialModels.has(model),
      entry,
    };
  });
}

export function getHourlyJournalFilterCounts(
  rows: readonly HourlyJournalRow[],
  available: boolean,
): HourlyJournalFilterCounts {
  return {
    all: rows.length,
    problems: rows.filter(({ entry }) => entry && isProblem(entry)).length,
    success: rows.filter(({ entry }) => entry && isAvailable(entry)).length,
    running: rows.filter(({ entry }) => entry?.status === "attempting").length,
    missing: available ? rows.filter(({ entry }) => !entry).length : 0,
  };
}

export function filterHourlyJournalRows(
  rows: readonly HourlyJournalRow[],
  filter: HourlyJournalFilter,
  available: boolean,
): HourlyJournalRow[] {
  switch (filter) {
    case "problems":
      return rows.filter(({ entry }) => entry != null && isProblem(entry));
    case "success":
      return rows.filter(({ entry }) => entry != null && isAvailable(entry));
    case "running":
      return rows.filter(({ entry }) => entry?.status === "attempting");
    case "missing":
      return available ? rows.filter(({ entry }) => !entry) : [];
    case "all":
    default:
      return [...rows];
  }
}
