import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./FavoritesBar.tsx", import.meta.url), "utf8");

describe("FavoritesBar", () => {
  it("affiche l’ajout de lieu en plein écran, défilable et accessible sur mobile", () => {
    expect(source).toContain('z-[100] flex min-h-[100dvh] items-stretch');
    expect(source).toContain('h-[100dvh] w-full min-h-0 flex-col');
    expect(source).toContain('min-h-0 flex-1 space-y-3 overflow-y-auto');
    expect(source).toContain('role="dialog" aria-modal="true"');
    expect(source).toContain('aria-label="Fermer l’ajout de lieu"');
  });

  it("place l’ajout et les paramètres dans le défilement horizontal des favoris", () => {
    expect(source).toContain('flex gap-2 overflow-x-auto pb-1 scrollbar-hide');
    expect(source).toContain('aria-label="Ajouter un lieu favori"');
    expect(source).toContain('<span>Ajouter</span>');
    expect(source).toContain('Gérer, modifier ou supprimer mes villes favorites');
    expect(source).toContain('const MAX_FAVORITES = 5');
    expect(source).toContain('totalFavCount < MAX_FAVORITES');
  });

  it("place l’action Ajouter avant les paramètres dans la rangée", () => {
    const addIndex = source.indexOf('aria-label="Ajouter un lieu favori"');
    const settingsIndex = source.indexOf('Gérer, modifier ou supprimer mes villes favorites');
    const sortableIndex = source.indexOf('<SortableContext items={orderedFavorites.map');
    expect(addIndex).toBeLessThan(settingsIndex);
    expect(addIndex).toBeGreaterThan(sortableIndex);
  });

  it("affiche une température actuelle explicite avec la typographie des pastilles du Dashboard", () => {
    expect(source).toContain('température actuelle indisponible');
    expect(source).toContain('text-[13px] font-semibold tracking-tight');
  });

  it("conserve des pastilles compactes sans réduire la lisibilité des favoris", () => {
    expect(source).toContain('min-h-10');
    expect(source).toContain('px-3 py-1.5');
    expect(source).toContain('size={18}');
  });

  it("tronque les noms longs tout en exposant leur libellé complet", () => {
    expect(source).toContain('title={loc.name}');
    expect(source).toContain('max-w-[88px] truncate');
  });

  it("priorise la même donnée actuelle que la carte Dashboard pour le favori actif", () => {
    expect(source).toContain("activeWeather?: FavoriteWeather");
    expect(source).toContain("active ? activeWeather ?? prefetchedWeather?.get(loc.id)");
  });

  it("permet de réorganiser les villes au toucher ou au clavier et conserve leur ordre", () => {
    expect(source).toContain('@dnd-kit/core');
    expect(source).toContain('TouchSensor');
    expect(source).toContain('sortableKeyboardCoordinates');
    expect(source).toContain('setActivatorNodeRef');
    expect(source).toContain('touch-pan-x');
    expect(source).toContain('aria-label={`Réorganiser ${loc.name}`}');
    expect(source).toContain('persistFavoriteOrder');
    expect(source).toContain('updateFavoriteMutation.mutateAsync');
    expect(source).toContain('saveLocalFavorites(reordered)');
  });

  it("utilise une mini-icône MeteoAI uniquement lorsque la condition réelle est disponible", () => {
    expect(source).toContain('getIconNameFromCondition');
    expect(source).toContain('hasCondition ? <MeteoIcon');
    expect(source).toContain('température actuelle indisponible');
  });
});
