export type LunarGlowStrength = {
  opacity: number;
  cloudCover: number | null;
};

/**
 * Traduit la couverture nuageuse observée en intensité visuelle, sans créer
 * de couverture fictive : l'absence de mesure conserve seulement une lueur neutre.
 */
export function getLunarGlowStrength(cloudCover: number | null | undefined): LunarGlowStrength {
  if (cloudCover == null || !Number.isFinite(cloudCover)) return { opacity: 0.22, cloudCover: null };
  const normalizedCloudCover = Math.max(0, Math.min(100, cloudCover));
  const opacity = Math.round((0.42 - normalizedCloudCover * 0.0034) * 100) / 100;
  return { opacity: Math.max(0.08, opacity), cloudCover: normalizedCloudCover };
}
