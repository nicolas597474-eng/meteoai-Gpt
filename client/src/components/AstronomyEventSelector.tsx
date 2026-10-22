import * as React from "react";

export type AstronomyEventOption = {
  id: string;
  category: string;
  title: string;
  date: string;
  dateLabel: string;
};

type AstronomyEventSelectorProps = {
  events: AstronomyEventOption[];
  selectedEventId: string;
  onSelect: (eventId: string) => void;
};

const CAPSULE_MIN_WIDTH_PERCENT = 15;

// La capsule bleu clair se comporte comme un vrai curseur de défilement :
// sa largeur reflète la part visible du rail, sa position la progression du
// balayage. Elle glisse ainsi en même temps que la rangée des zones.
export function syncAstronomyEventCapsule(
  container: Pick<HTMLElement, "scrollWidth" | "clientWidth" | "scrollLeft">,
  capsule: { style: { width: string; left: string } },
): void {
  const maxScrollLeft = container.scrollWidth - container.clientWidth;
  if (maxScrollLeft <= 0) return;
  const width = Math.min(
    100,
    Math.max(CAPSULE_MIN_WIDTH_PERCENT, (container.clientWidth / container.scrollWidth) * 100),
  );
  const progress = Math.min(1, Math.max(0, container.scrollLeft / maxScrollLeft));
  capsule.style.width = `${width}%`;
  capsule.style.left = `${progress * (100 - width)}%`;
}

// Sélecteur coulissant des événements astronomiques (météores, éclipses
// lunaires et solaires) : rangée de zones arrondies que l’on fait glisser,
// prolongée par une fine piste sombre dont la capsule bleu clair suit le
// balayage de la rangée, comme une barre de glissement. La barre native du
// rail reste masquée : la piste bleu clair en tient lieu, de bout en bout.
export function AstronomyEventSelector({
  events,
  selectedEventId,
  onSelect,
}: AstronomyEventSelectorProps) {
  const selectedIndex = Math.max(
    0,
    events.findIndex(event => event.id === selectedEventId)
  );
  const segmentWidth = events.length > 0 ? 100 / events.length : 100;

  const syncCapsuleWithScroll = (container: HTMLElement | null) => {
    if (!container) return;
    const capsule = container
      .closest(".astronomy-event-selector")
      ?.querySelector<HTMLElement>("[data-astronomy-scroll-capsule]");
    if (capsule) syncAstronomyEventCapsule(container, capsule);
  };

  return (
    <div className="astronomy-event-selector">
      <div
        role="group"
        aria-label="Sélection des événements astronomiques"
        className="astronomy-event-scroll scrollbar-hide flex min-w-0 snap-x snap-proximity gap-2 overflow-x-auto overscroll-x-contain px-3 py-2"
        data-horizontal-scroll
        data-swipe-exclude
        onScroll={scrollEvent => syncCapsuleWithScroll(scrollEvent.currentTarget)}
      >
        {events.map(event => {
          const isSelected = event.id === selectedEventId;
          return (
            <button
              key={event.id}
              type="button"
              onClick={clickEvent => {
                onSelect(event.id);
                // La zone choisie se recentre dans le rail : la capsule suit
                // ensuite le balayage fluide provoqué par ce recentrage.
                clickEvent.currentTarget.scrollIntoView({
                  behavior: "smooth",
                  block: "nearest",
                  inline: "center",
                });
              }}
              aria-pressed={isSelected}
              aria-label={`${event.category} : ${event.title}, ${event.dateLabel}`}
              className={`flex min-h-[4.25rem] min-w-[11rem] max-w-[14rem] shrink-0 snap-start flex-col items-start justify-center gap-1 rounded-2xl px-3 py-2 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${
                isSelected
                  ? "bg-sky-400/15 text-sky-50 ring-1 ring-inset ring-sky-300/45 shadow-[0_4px_16px_rgba(56,189,248,0.22)]"
                  : "bg-slate-800/35 text-slate-300 ring-1 ring-inset ring-transparent hover:bg-slate-700/45 hover:ring-sky-300/25"
              }`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-200">
                  {event.category}
                </span>
                {isSelected && (
                  <span className="shrink-0 rounded-md bg-sky-300/25 px-1.5 py-0.5 text-[10px] font-semibold text-sky-50">
                    Choisi
                  </span>
                )}
              </span>
              <span className="w-full whitespace-normal text-xs font-semibold leading-snug">
                {event.title}
              </span>
              <time
                dateTime={event.date}
                className="text-xs leading-tight text-slate-300"
              >
                {event.dateLabel}
              </time>
            </button>
          );
        })}
      </div>
      {events.length > 1 && (
        <div className="px-3 pb-2.5 pt-0.5" aria-hidden="true">
          <div className="relative h-1 rounded-full bg-slate-800">
            <div
              data-astronomy-scroll-capsule
              className="absolute h-full rounded-full bg-sky-400 transition-all duration-300 ease-out"
              style={{
                width: `${segmentWidth}%`,
                left: `${selectedIndex * segmentWidth}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
