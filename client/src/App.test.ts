import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("navigation MeteoAI", () => {
  it("charge les pages à la demande sans lancer tous les préchargements au démarrage", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(source).toContain('const Dashboard = lazy(loadDashboard)');
    expect(source).not.toContain('import Dashboard from');
    expect(source).not.toContain('useMainPagePreload');
    expect(source).not.toContain('<ReliabilityLabPreloader');
    expect(source).toContain('<DeferredFavoritePreloader />');
    expect(source).toContain('onPointerEnter={() => activateNavItem(item.path)}');
    expect(source).toContain('<PageReadinessProvider>');
  });

  it("masque l’en-tête de marque sur mobile sans que la barre basse masque le contenu", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(source).toContain('hidden border-b border-border bg-background sm:block');
    expect(source).toContain("function BottomNav()");
    expect(source).toContain('aria-label="Navigation principale"');
    expect(source).toContain('meteoAiSection');
    expect(source).toContain('window.history.replaceState');
    expect(source).toContain('window.addEventListener("popstate"');
    expect(source).toContain('pendingDirectionRef.current = "backward"');
    expect(source).toContain('page-swipe-transition--${transition.direction}');
    expect(source).toContain('border-t border-border bg-background text-foreground sm:hidden');
    expect(source).not.toContain("ThemeToggle");
    expect(source).toContain("pb-[calc(4rem+env(safe-area-inset-bottom))]");
    expect(source).toContain('{ path: "/details", label: "Prévisions", icon: FileText }');
    expect(source).not.toContain("backdrop-blur-xl");
  });

  it("conserve la route Historique sans l’exposer dans la navigation principale", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(source).toContain('<Route path="/history" component={History} />');
    expect(source).not.toContain('{ path: "/history", label: "Historique"');
  });

  it("réinitialise la position et affiche un vrai squelette pendant le chargement d’une page", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(source).toContain("ScrollToTopOnRouteChange");
    expect(source).toContain("window.scrollTo(0, 0)");
    expect(source).toContain("RouteLoadingFallback");
    expect(source).toContain('aria-label="Chargement de la page"');
    expect(source).toContain("min-h-[60vh]");
  });
});
