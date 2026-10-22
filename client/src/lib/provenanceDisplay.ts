/**
 * Préférence d’affichage de la provenance des données météorologiques.
 *
 * MeteoAI affiche par défaut, sous chaque valeur, la source et la fraîcheur
 * réellement reçues (par exemple « Open-Meteo · 09:00 · il y a 11 min »).
 * Certaines personnes préfèrent une lecture épurée : ce réglage, exposé dans
 * le bloc « Paramètres Application » de l’AI Lab, masque ces mentions sur
 * toutes les pages météo. Le réglage n’est qu’un masque d’affichage : aucune
 * donnée, source ou traçabilité n’est modifiée côté serveur.
 */

export type ProvenanceDisplayMode = "shown" | "hidden";

export const PROVENANCE_DISPLAY_STORAGE_KEY = "meteoai_provenance_display";

type ProvenanceStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): ProvenanceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeProvenanceDisplayMode(
  value: unknown
): ProvenanceDisplayMode {
  return value === "hidden" ? "hidden" : "shown";
}

export function getProvenanceDisplayMode(
  storage: ProvenanceStorage | null = browserStorage()
): ProvenanceDisplayMode {
  try {
    return normalizeProvenanceDisplayMode(
      storage?.getItem(PROVENANCE_DISPLAY_STORAGE_KEY)
    );
  } catch {
    return "shown";
  }
}

export function storeProvenanceDisplayMode(
  mode: ProvenanceDisplayMode,
  storage: ProvenanceStorage | null = browserStorage()
): void {
  try {
    storage?.setItem(
      PROVENANCE_DISPLAY_STORAGE_KEY,
      normalizeProvenanceDisplayMode(mode)
    );
  } catch {
    // La préférence reste appliquée pour la session si le stockage est indisponible.
  }
}

export function storeProvenanceDisplayVisibility(
  visible: boolean,
  storage: ProvenanceStorage | null = browserStorage()
): void {
  storeProvenanceDisplayMode(visible ? "shown" : "hidden", storage);
}

export function getProvenanceDisplayModeLabel(
  mode: ProvenanceDisplayMode
): string {
  return mode === "hidden" ? "masquée" : "affichée";
}
