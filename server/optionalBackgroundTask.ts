/**
 * Isole une extension non critique de la collecte météo.
 * Une indisponibilité ne peut jamais interrompre l’archivage physique, les
 * prévisions publiques, les poids ou les scores de production.
 */
export async function runOptionalBackgroundTask<T>(label: string, operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    console.warn(`[OptionalBackgroundTask] ${label} failed without affecting forecast collection:`, error);
    return null;
  }
}
