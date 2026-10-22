/**
 * Conventions temporelles métier MeteoAI.
 * Toutes les clés de prévision et décisions horaire/journalier doivent utiliser
 * Europe/Paris, indépendamment du fuseau de l'hôte serveur ou du navigateur.
 */
export const METEO_TIME_ZONE = "Europe/Paris";

/** Six collectes quotidiennes espacées de quatre heures, dont le run historique de 05:00. */
export const PARIS_FORECAST_RUN_HOURS = [1, 5, 9, 13, 17, 21] as const;

/**
 * Heartbeat ne prend que des expressions UTC statiques. Ces heures couvrent les
 * deux offsets Europe/Paris (+01:00 et +02:00); le handler ignore les créneaux
 * qui ne correspondent pas à l'un des six horaires parisiens.
 */
export const FORECAST_HEARTBEAT_UTC_HOURS = [0, 3, 4, 7, 8, 11, 12, 15, 16, 19, 20, 23] as const;
export const FORECAST_HEARTBEAT_CRON_UTC = "0 0 0,3,4,7,8,11,12,15,16,19,20,23 * * *";
export const PARIS_FORECAST_SCHEDULE_LABEL = PARIS_FORECAST_RUN_HOURS
  .map((hour) => `${String(hour).padStart(2, "0")}:00`)
  .join(", ");
const PARIS_WALL_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: METEO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type ParisForecastRunHour = typeof PARIS_FORECAST_RUN_HOURS[number];
export type ParisForecastSlot = {
  date: string;
  hour: ParisForecastRunHour;
  key: string;
};

export function getParisDate(date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: METEO_TIME_ZONE });
}

export function getParisHour(date = new Date()): number {
  const hour = new Intl.DateTimeFormat("fr-FR", {
    timeZone: METEO_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).find((part) => part.type === "hour")?.value;
  return hour != null ? Number(hour) : 0;
}

export function getParisMinute(date = new Date()): number {
  const minute = new Intl.DateTimeFormat("fr-FR", {
    timeZone: METEO_TIME_ZONE,
    minute: "2-digit",
  }).formatToParts(date).find((part) => part.type === "minute")?.value;
  return minute != null ? Number(minute) : 0;
}

/** Retourne le créneau local canonique, ou null pour un appel Heartbeat de garde. */
export function getParisForecastSlot(date = new Date(), runHours: readonly number[] = PARIS_FORECAST_RUN_HOURS): ParisForecastSlot | null {
  const hour = getParisHour(date);
  if (!runHours.includes(hour)) return null;

  const parisDate = getParisDate(date);
  const hourText = String(hour).padStart(2, "0");
  return {
    date: parisDate,
    hour: hour as ParisForecastRunHour,
    key: `favorites-forecast:${parisDate}:${hourText}`,
  };
}

/** Décale une date civile Europe/Paris sans interpréter le jour comme 24 heures. */
export function shiftParisCivilDate(date: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(days)) return null;
  const shifted = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(shifted.getTime()) || shifted.toISOString().slice(0, 10) !== date) return null;
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Retourne les instants horaires UTC appartenant à une journée civile Europe/Paris. */
export function getParisHourlyTimestamps(date: string): number[] {
  const utcMidnight = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(utcMidnight) || shiftParisCivilDate(date, 0) !== date) return [];

  const hourMs = 60 * 60 * 1000;
  const timestamps: number[] = [];
  for (let validAt = utcMidnight - 4 * hourMs; validAt < utcMidnight + 28 * hourMs; validAt += hourMs) {
    if (getParisDate(new Date(validAt)) === date) timestamps.push(validAt);
  }
  return timestamps;
}

export function getParisDateDaysAgo(daysAgo: number, now = new Date()): string {
  const today = getParisDate(now);
  return shiftParisCivilDate(today, -Math.trunc(daysAgo)) ?? today;
}

function parisWallClockToUtc(date: string, hour: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  const approximateUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
  const expected = {
    year: String(year),
    month: String(month).padStart(2, "0"),
    day: String(day).padStart(2, "0"),
    hour: String(hour).padStart(2, "0"),
  };

  // Find the actual UTC instant matching Paris wall time. Offset subtraction
  // based on a single nearby instant is wrong when DST changes that same day.
  for (let deltaMinutes = -180; deltaMinutes <= 180; deltaMinutes += 15) {
    const candidate = new Date(approximateUtc + deltaMinutes * 60_000);
    const parts = Object.fromEntries(PARIS_WALL_CLOCK_FORMATTER.formatToParts(candidate).map((part) => [part.type, part.value]));
    if (parts.year === expected.year && parts.month === expected.month && parts.day === expected.day
      && parts.hour === expected.hour && parts.minute === "00") {
      return candidate;
    }
  }
  throw new RangeError(`The Paris wall-clock time ${date} ${String(hour).padStart(2, "0")}:00 does not exist.`);
}

function nextParisDate(date: string): string {
  return shiftParisCivilDate(date, 1) ?? date;
}

/** Retourne le prochain créneau de prévision dans le fuseau métier Europe/Paris. */
export function getNextParisForecastRun(now = new Date(), runHours: readonly number[] = PARIS_FORECAST_RUN_HOURS): Date {
  if (runHours.length === 0) throw new Error("At least one Paris forecast hour is required.");
  const today = getParisDate(now);
  for (const hour of runHours) {
    const candidate = parisWallClockToUtc(today, hour);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return parisWallClockToUtc(nextParisDate(today), runHours[0]);
}
