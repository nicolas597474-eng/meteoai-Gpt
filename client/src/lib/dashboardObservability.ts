import type { OfficialRegimeInputDiagnostic } from "@shared/regimeInputDiagnostics";
import { summarizeRegimeInputCoverage } from "@shared/regimeInputDiagnostics";
import { getCollectionHealth, type CollectionHealth, type CollectionHealthInput } from "@/lib/collectionHealth";

export type DashboardObservabilityInput = {
  selectedLocationLabel?: string | null;
  selectedLocationRegimeInputs?: readonly OfficialRegimeInputDiagnostic[] | null;
  latestGlobalBatchStatus?: CollectionHealthInput["lastRunStatus"];
  latestGlobalBatchAt?: CollectionHealthInput["lastSuccessAt"];
  now?: Date;
};

/** Local coverage and global scheduled-job health are computed from separate inputs. */
export function getDashboardObservability(input: DashboardObservabilityInput): {
  selectedLocationLabel: string;
  selectedLocationCoverage: ReturnType<typeof summarizeRegimeInputCoverage>;
  latestGlobalBatchHealth: CollectionHealth;
} {
  return {
    selectedLocationLabel: input.selectedLocationLabel?.trim() || "Lieu affiché",
    selectedLocationCoverage: summarizeRegimeInputCoverage(input.selectedLocationRegimeInputs),
    latestGlobalBatchHealth: getCollectionHealth({
      lastRunStatus: input.latestGlobalBatchStatus,
      lastSuccessAt: input.latestGlobalBatchAt,
      now: input.now,
    }),
  };
}
