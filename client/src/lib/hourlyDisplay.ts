export type HourlyDisplayPoint = {
  date?: string | null;
  hour?: string | null;
  validAt?: number | null;
};

function formatParisUtcOffset(validAt: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(validAt));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "0";
  const localAsUtc = Date.UTC(
    Number(value("year")),
    Number(value("month")) - 1,
    Number(value("day")),
    Number(value("hour")),
    Number(value("minute")),
  );
  const instantAtMinute = Math.floor(validAt / 60_000) * 60_000;
  const offsetMinutes = Math.round((localAsUtc - instantAtMinute) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

function formatParisDateLabel(dateValue: string | null | undefined): string {
  if (!dateValue) return "Date inconnue";
  const date = new Date(`${dateValue}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateValue;
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

export function formatHourlyDisplay(
  point: HourlyDisplayPoint,
  points: readonly HourlyDisplayPoint[],
) {
  const sameLocalHourInstants = point.date && point.hour
    ? new Set(points
        .filter((candidate) => candidate.date === point.date && candidate.hour === point.hour)
        .map((candidate) => candidate.validAt)
        .filter((validAt): validAt is number => typeof validAt === "number" && Number.isFinite(validAt)))
    : new Set<number>();
  const isRepeatedLocalHour = sameLocalHourInstants.size > 1;
  const validAt = typeof point.validAt === "number" && Number.isFinite(point.validAt)
    ? point.validAt
    : null;

  return {
    dateLabel: formatParisDateLabel(point.date),
    hourLabel: point.hour ?? "—",
    offsetLabel: isRepeatedLocalHour && validAt != null
      ? `Europe/Paris ${formatParisUtcOffset(validAt)}`
      : null,
  };
}
