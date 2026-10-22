type ErrorRecord = {
  cause?: unknown;
  code?: unknown;
  errno?: unknown;
  sqlState?: unknown;
  sqlMessage?: unknown;
  message?: unknown;
  constraint?: unknown;
  constraintName?: unknown;
  sqlConstraint?: unknown;
  indexName?: unknown;
};

function asRecord(value: unknown): ErrorRecord | null {
  return value !== null && typeof value === "object" ? value as ErrorRecord : null;
}

function boundedText(value: unknown, limit: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, limit) : null;
}

function deepestText(records: ErrorRecord[], field: keyof ErrorRecord, limit: number): string | null {
  for (let index = records.length - 1; index >= 0; index--) {
    const text = boundedText(records[index][field], limit);
    if (text) return text;
  }
  return null;
}

function getErrorChain(error: unknown): ErrorRecord[] {
  const records: ErrorRecord[] = [];
  const seen = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < 5; depth++) {
    const record = asRecord(current);
    if (!record || seen.has(record as object)) break;
    seen.add(record as object);
    records.push(record);
    current = record.cause;
  }

  if (records.length === 0) {
    const fallback = boundedText(error, 500);
    if (fallback) records.push({ message: fallback });
  }
  return records;
}

function findConstraint(records: ErrorRecord[], message: string): string {
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index];
    for (const field of ["constraint", "constraintName", "sqlConstraint", "indexName"] as const) {
      const value = boundedText(record[field], 200);
      if (value) return value;
    }
  }

  const keyMatch = /(?:constraint|for key)\s+[`'\"]([^`'\"]+)[`'\"]/i.exec(message);
  if (keyMatch) return `key ${keyMatch[1]}`;

  const columnMatch = /\bcolumn\s+[`'\"]([^`'\"]+)[`'\"]/i.exec(message);
  if (columnMatch) return `column \`${columnMatch[1]}\` (no named SQL constraint)`;

  return "not reported by database driver";
}

/** Format nested MySQL/Drizzle errors for the per-model hourly persistence alert. */
export function formatHourlyJournalWriteError(error: unknown): string {
  const records = getErrorChain(error);
  const message = deepestText(records, "sqlMessage", 500)
    ?? deepestText(records, "message", 500)
    ?? "Unknown hourly journal write error";
  const code = deepestText(records, "code", 80) ?? "unknown";
  const errno = deepestText(records, "errno", 24);
  const sqlState = deepestText(records, "sqlState", 24);
  const constraint = findConstraint(records, message);

  return [
    `message=${JSON.stringify(message)}`,
    `code=${code}`,
    `constraint=${JSON.stringify(constraint)}`,
    ...(errno ? [`errno=${errno}`] : []),
    ...(sqlState ? [`sqlState=${sqlState}`] : []),
  ].join("; ");
}
