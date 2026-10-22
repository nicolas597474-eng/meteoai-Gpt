import { replayPhase8Controlled } from "../server/weatherDataHubShadow";

const args = new Set(process.argv.slice(2));
const getArg = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
};
const parseDate = (value: string | undefined) => {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Date invalide pour --${value}`);
  return timestamp;
};

const report = await replayPhase8Controlled({
  dryRun: args.has("--dry-run"),
  locationKey: getArg("location"),
  sinceMs: parseDate(getArg("since")),
  untilMs: parseDate(getArg("until")),
});
if (!report) throw new Error("Base de données indisponible");
const statuses = report.groups.reduce<Record<string, number>>((acc, group) => {
  acc[group.status] = (acc[group.status] ?? 0) + 1;
  return acc;
}, {});
console.log(JSON.stringify({
  dryRun: report.dryRun,
  snapshotCount: report.snapshotCount,
  candidateCount: report.candidateCount,
  eligibleComparisonCount: report.eligibleComparisonCount,
  persistedComparisonCount: report.persistedComparisonCount,
  groupCount: report.groups.length,
  statuses,
  rejected: report.rejected,
  productionReadsEnabled: report.productionReadsEnabled,
  appliedToProduction: report.appliedToProduction,
}, null, 2));
process.exit(0);
