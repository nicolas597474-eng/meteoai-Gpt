import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  PROVENANCE_DISPLAY_STORAGE_KEY,
  getProvenanceDisplayMode,
  storeProvenanceDisplayVisibility,
  type ProvenanceDisplayMode,
} from "@/lib/provenanceDisplay";

type ProvenanceDisplayContextValue = {
  /** `true` tant que la provenance (source, horodatage, fraîcheur) est affichée. */
  showProvenance: boolean;
  provenanceDisplayMode: ProvenanceDisplayMode;
  setShowProvenance: (visible: boolean) => void;
  toggleShowProvenance: () => void;
};

const DEFAULT_VALUE: ProvenanceDisplayContextValue = {
  showProvenance: true,
  provenanceDisplayMode: "shown",
  setShowProvenance: () => undefined,
  toggleShowProvenance: () => undefined,
};

const ProvenanceDisplayContext =
  createContext<ProvenanceDisplayContextValue>(DEFAULT_VALUE);

export function ProvenanceDisplayProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [provenanceDisplayMode, setProvenanceDisplayMode] =
    useState<ProvenanceDisplayMode>(() => getProvenanceDisplayMode());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const synchronise = (event: StorageEvent) => {
      if (event.key !== null && event.key !== PROVENANCE_DISPLAY_STORAGE_KEY)
        return;
      setProvenanceDisplayMode(getProvenanceDisplayMode());
    };
    window.addEventListener("storage", synchronise);
    return () => window.removeEventListener("storage", synchronise);
  }, []);

  const setShowProvenance = useCallback((visible: boolean) => {
    storeProvenanceDisplayVisibility(visible);
    setProvenanceDisplayMode(visible ? "shown" : "hidden");
  }, []);

  const toggleShowProvenance = useCallback(() => {
    setProvenanceDisplayMode(current => {
      const next = current === "hidden" ? "shown" : "hidden";
      storeProvenanceDisplayVisibility(next === "shown");
      return next;
    });
  }, []);

  const value = useMemo<ProvenanceDisplayContextValue>(
    () => ({
      showProvenance: provenanceDisplayMode === "shown",
      provenanceDisplayMode,
      setShowProvenance,
      toggleShowProvenance,
    }),
    [provenanceDisplayMode, setShowProvenance, toggleShowProvenance]
  );

  return (
    <ProvenanceDisplayContext.Provider value={value}>
      {children}
    </ProvenanceDisplayContext.Provider>
  );
}

/**
 * Réglage « afficher / masquer la provenance » partagé par toutes les pages.
 *
 * Sans provider monté (tests unitaires, rendu isolé d’un composant), la
 * provenance reste affichée : le comportement historique est conservé.
 */
export function useProvenanceDisplay(): ProvenanceDisplayContextValue {
  return useContext(ProvenanceDisplayContext);
}
