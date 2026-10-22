export type CollectedForecast = {
  id?: number;
  date: string;
  serviceName: string;
  collectedAt: Date | string;
};

/** Conserve la dernière collecte pour chaque couple date/modèle. */
export function selectLatestForecasts<T extends CollectedForecast>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.date}\u0000${row.serviceName}`;
    const current = latest.get(key);
    const timestamp = new Date(row.collectedAt).getTime();
    const currentTimestamp = current ? new Date(current.collectedAt).getTime() : Number.NEGATIVE_INFINITY;
    if (!current || timestamp > currentTimestamp || (timestamp === currentTimestamp && (row.id ?? 0) > (current.id ?? 0))) {
      latest.set(key, row);
    }
  }
  return Array.from(latest.values()).sort((left, right) =>
    left.date.localeCompare(right.date) || left.serviceName.localeCompare(right.serviceName)
  );
}
