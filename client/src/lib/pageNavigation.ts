// History remains reachable from its contextual route and browser Back, but it
// is not a main-nav item. Keeping it out of the carousel prevents a swipe from
// landing on a page with no visible active navigation entry.
export const MAIN_PAGE_PATHS = ["/", "/details", "/laboratoire", "/ranking", "/ai-lab"] as const;
export const PAGE_SWIPE_IGNORE_SELECTOR = "a, button, input, textarea, select, [role='button'], [role='slider'], [data-swipe-ignore], [data-swipe-exclude], [data-horizontal-scroll], .overflow-x-auto, .overflow-x-scroll, canvas, svg";

export function getSwipeNavigationTarget(location: string, deltaX: number) {
  const currentIndex = MAIN_PAGE_PATHS.indexOf(location as (typeof MAIN_PAGE_PATHS)[number]);
  if (currentIndex < 0) return null;
  const nextIndex = currentIndex + (deltaX < 0 ? 1 : -1);
  return MAIN_PAGE_PATHS[nextIndex] ?? null;
}

export function isQualifiedPageSwipe(deltaX: number, deltaY: number, elapsedMs: number) {
  return Math.abs(deltaX) >= 72 && Math.abs(deltaX) > Math.abs(deltaY) * 1.35 && elapsedMs <= 900;
}
