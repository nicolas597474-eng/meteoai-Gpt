const parisFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type ParisParts = { date: string; hour: number; minute: number; second: number };

function getParisParts(epochMs: number): ParisParts | null {
  if (!Number.isFinite(epochMs)) return null;
  const values = Object.fromEntries(
    parisFormatter.formatToParts(new Date(epochMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  if (![values.year, values.month, values.day, values.hour, values.minute, values.second].every(Number.isFinite)) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${values.year}-${pad(values.month)}-${pad(values.day)}`,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

/** Interprets a Unix timestamp as an absolute instant and returns its Paris wall-clock fields. */
export function getParisDateAndHour(epochMs: number): { date: string; hour: number; minute: number } | null {
  const parts = getParisParts(epochMs);
  return parts ? { date: parts.date, hour: parts.hour, minute: parts.minute } : null;
}

/**
 * Converts a Paris wall-clock hour only when it identifies exactly one instant.
 * Spring-forward gaps and fall-back repeated hours return null rather than
 * silently selecting an offset and creating a false forecast/observation match.
 */
export function parisLocalHourToUniqueEpochMs(date: string, hour: number): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utcGuess = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  const utcDate = new Date(utcGuess);
  if (utcDate.getUTCFullYear() !== year || utcDate.getUTCMonth() !== month - 1 || utcDate.getUTCDate() !== day) return null;

  const offsets = new Set<number>();
  const scanRadiusMs = 48 * 60 * 60 * 1000;
  const scanStepMs = 3 * 60 * 60 * 1000;
  for (let delta = -scanRadiusMs; delta <= scanRadiusMs; delta += scanStepMs) {
    const probe = utcGuess + delta;
    const parts = getParisParts(probe);
    if (!parts) continue;
    const representedAsUtc = Date.UTC(
      Number(parts.date.slice(0, 4)),
      Number(parts.date.slice(5, 7)) - 1,
      Number(parts.date.slice(8, 10)),
      parts.hour,
      parts.minute,
      parts.second,
    );
    offsets.add(representedAsUtc - Math.floor(probe / 1000) * 1000);
  }

  const matches = new Set<number>();
  for (const offsetMs of Array.from(offsets)) {
    const candidate = utcGuess - offsetMs;
    const parts = getParisParts(candidate);
    if (parts?.date === date && parts.hour === hour && parts.minute === 0 && parts.second === 0) {
      matches.add(candidate);
    }
  }
  return matches.size === 1 ? Array.from(matches)[0] : null;
}
