import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MapPin, Star, Plus, X, Search, Navigation, Settings, LogIn, GripVertical } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";
import { MeteoIcon, getIconNameFromCondition } from "@/components/MeteoIcon";
import { publicGeography } from '@/lib/publicGeography';

// ─── Types ──────────────────────────────────────────────────────────────────
type FavoriteLocation = {
  id: number;
  name: string;
  customName: string | null;
  lat: number;
  lon: number;
  isDefault: number | null;
  radiusKm: number | null;
  position: number;
  localMode?: string | null;
};

type LocationItem = {
  type: "current" | "favorite" | "local";
  id: string;
  favoriteId?: number;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  isDefault?: boolean;
  localMode?: "standard" | "local" | "ultra-local";
  temp?: number | null;
  condition?: string | null;
};

// ─── LocalStorage favorites (for non-logged-in users) ───────────────────────
type LocalFavorite = { id: string; name: string; lat: number; lon: number; radiusKm: number };
const MAX_FAVORITES = 5;

function getLocalFavorites(): LocalFavorite[] {
  try {
    const stored = localStorage.getItem("meteoai_local_favorites");
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function saveLocalFavorites(favs: LocalFavorite[]) {
  try { localStorage.setItem("meteoai_local_favorites", JSON.stringify(favs)); } catch {}
}

function addLocalFavorite(fav: Omit<LocalFavorite, "id">): LocalFavorite[] {
  const current = getLocalFavorites();
  if (current.length >= MAX_FAVORITES) return current;
  const newFav = { ...fav, id: `local-${Date.now()}` };
  const updated = [...current, newFav];
  saveLocalFavorites(updated);
  return updated;
}

function removeLocalFavorite(id: string): LocalFavorite[] {
  const updated = getLocalFavorites().filter(f => f.id !== id);
  saveLocalFavorites(updated);
  return updated;
}

type FavoriteWeather = { temp: number | null; condition: string | null };

function FavoritePillContent({ loc, weather, active }: { loc: LocationItem; weather?: FavoriteWeather; active: boolean }) {
  const hasCurrentTemperature = weather?.temp != null;
  const hasCondition = Boolean(weather?.condition);

  return <>
    {hasCondition ? <MeteoIcon name={getIconNameFromCondition(weather?.condition)} size={18} className="h-[18px] w-[18px] shrink-0" /> : <Star className={`h-4 w-4 shrink-0 ${active ? "fill-primary" : ""}`} />}
    <span title={loc.name} className="min-w-0 max-w-[88px] truncate text-[13px] font-semibold tracking-tight">{loc.name}</span>
  </>;
}

function SortableFavoritePill({ loc, weather, active, onSelect }: { loc: LocationItem; weather?: FavoriteWeather; active: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: loc.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const hasCurrentTemperature = weather?.temp != null;

  return <div
    ref={setNodeRef}
    style={style}
    onClick={onSelect}
    onKeyDown={(event) => {
      if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        onSelect();
      }
    }}
    {...attributes}
    aria-label={`${loc.name}, ${hasCurrentTemperature ? `température actuelle ${Math.round(weather!.temp!)} degrés` : "température actuelle indisponible"}. Balayez pour faire défiler, ou utilisez la poignée pour réorganiser.`}
    className={`group flex min-h-10 shrink-0 touch-pan-x items-center gap-1.5 rounded-full border px-3 py-1.5 transition-all ${
      active ? "border-primary/70 bg-card/80 text-primary" : "border-primary/55 bg-card/80 text-primary hover:border-primary"
    } ${isDragging ? "cursor-grabbing opacity-35" : "cursor-grab active:cursor-grabbing"}`}
  >
    <span
      ref={setActivatorNodeRef}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={(event) => event.stopPropagation()}
      aria-label={`Réorganiser ${loc.name}`}
      className="flex h-6 w-3 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/60 active:cursor-grabbing active:text-primary"
    >
      <GripVertical className="h-3.5 w-3.5" />
    </span>
    <FavoritePillContent loc={loc} weather={weather} active={active} />
  </div>;
}

// ─── Hook: useCurrentLocation ───────────────────────────────────────────────
function useCurrentLocation() {
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!navigator.geolocation) {
      setPosition(null);
      setLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLoading(false);
      },
      () => {
        setPosition(null);
        setLoading(false);
      },
      { timeout: 5000 }
    );
  }, []);

  return { position, loading };
}

// ─── Main Component ─────────────────────────────────────────────────────────
export function FavoritesBar({
  activeLocation,
  onLocationChange,
  prefetchedWeather,
  activeWeather,
}: {
  activeLocation: { lat: number; lon: number; name: string } | null;
  onLocationChange: (loc: { lat: number; lon: number; name: string; radiusKm: number; favoriteId?: number; localMode?: "standard" | "local" | "ultra-local" }) => void;
  prefetchedWeather?: Map<string, { temp: number | null; condition: string | null }>;
  activeWeather?: FavoriteWeather;
}) {
  const { user } = useAuth();
  const { position: currentPos } = useCurrentLocation();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [localFavorites, setLocalFavorites] = useState<LocalFavorite[]>(getLocalFavorites);
  const [favoriteOrder, setFavoriteOrder] = useState<string[]>([]);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch user's server-side favorites (only if logged in)
  const { data: serverFavorites = [], refetch: refetchFavorites } = trpc.favorites.list.useQuery(
    undefined,
    { enabled: !!user }
  );

  const totalFavCount = user ? serverFavorites.length : localFavorites.length;

  const favoriteLocations = useMemo<LocationItem[]>(() => user
    ? serverFavorites.map((fav: FavoriteLocation) => ({
        type: "favorite",
        id: `fav-${fav.id}`,
        favoriteId: fav.id,
        name: fav.customName || fav.name,
        lat: fav.lat,
        lon: fav.lon,
        radiusKm: fav.radiusKm ?? 10,
        isDefault: fav.isDefault === 1,
        localMode: (fav.localMode as "standard" | "local" | "ultra-local") ?? "standard",
      }))
    : localFavorites.map((fav) => ({
        type: "local",
        id: fav.id,
        name: fav.name,
        lat: fav.lat,
        lon: fav.lon,
        radiusKm: fav.radiusKm,
      })), [user, serverFavorites, localFavorites]);

  const favoriteSignature = useMemo(() => favoriteLocations.map((location) => location.id).join("|"), [favoriteLocations]);

  useEffect(() => {
    setFavoriteOrder(favoriteLocations.map((location) => location.id));
  }, [favoriteSignature]);

  const orderedFavorites = useMemo(() => {
    const locationsById = new Map(favoriteLocations.map((location) => [location.id, location]));
    const ordered = favoriteOrder.map((id) => locationsById.get(id)).filter((location): location is LocationItem => Boolean(location));
    return [...ordered, ...favoriteLocations.filter((location) => !favoriteOrder.includes(location.id))];
  }, [favoriteLocations, favoriteOrder]);

  const locations = useMemo<LocationItem[]>(() => {
    const current = currentPos ? [{ type: "current" as const, id: "current", name: "Position actuelle", lat: currentPos.lat, lon: currentPos.lon, radiusKm: 10 }] : [];
    return [...current, ...(orderedFavorites.length ? orderedFavorites : [{type: "local" as const, id: "default-hondeghem", name: "Hondeghem", lat: 50.7567, lon: 2.5204, radiusKm: 20, localMode: "standard" as const}])];
  }, [currentPos, orderedFavorites]);

  // Set default on first load
  useEffect(() => {
    if (!activeLocation && locations.length > 0) {
      const defaultLoc = locations.find(l => l.isDefault) ?? locations[0];
      onLocationChange({
        lat: defaultLoc.lat,
        lon: defaultLoc.lon,
        name: defaultLoc.name,
        radiusKm: defaultLoc.radiusKm,
        favoriteId: defaultLoc.favoriteId,
        localMode: defaultLoc.localMode,
      });
    }
  }, [activeLocation, locations.length]);

  const isActive = (loc: LocationItem) => {
    if (!activeLocation) return false;
    return Math.abs(loc.lat - activeLocation.lat) < 0.001 && Math.abs(loc.lon - activeLocation.lon) < 0.001;
  };

  const updateFavoriteMutation = trpc.favorites.update.useMutation();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persistFavoriteOrder = useCallback(async (nextOrder: string[]) => {
    if (user) {
      try {
        await Promise.all(nextOrder.map((id, position) => {
          const location = favoriteLocations.find((item) => item.id === id);
          return location?.favoriteId == null ? Promise.resolve() : updateFavoriteMutation.mutateAsync({ id: location.favoriteId, position });
        }));
        await refetchFavorites();
      } catch {
        await refetchFavorites();
      }
      return;
    }

    const localById = new Map(localFavorites.map((favorite) => [favorite.id, favorite]));
    const reordered = nextOrder.map((id) => localById.get(id)).filter((favorite): favorite is LocalFavorite => Boolean(favorite));
    saveLocalFavorites(reordered);
    setLocalFavorites(reordered);
  }, [favoriteLocations, localFavorites, refetchFavorites, updateFavoriteMutation, user]);

  const handleDragStart = ({ active }: DragStartEvent) => setActiveDragId(String(active.id));
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveDragId(null);
    if (!over || active.id === over.id) return;
    const oldIndex = favoriteOrder.indexOf(String(active.id));
    const newIndex = favoriteOrder.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextOrder = arrayMove(favoriteOrder, oldIndex, newIndex);
    setFavoriteOrder(nextOrder);
    void persistFavoriteOrder(nextOrder);
  };

  const activeDragLocation = activeDragId ? orderedFavorites.find((location) => location.id === activeDragId) : null;

  const handleAddFavorite = (fav: { name: string; lat: number; lon: number; radiusKm?: number }) => {
    if (user) {
      // Will be handled by the dialog's mutation
      return;
    }
    // Local storage for non-logged users
    const updated = addLocalFavorite({ name: fav.name, lat: fav.lat, lon: fav.lon, radiusKm: fav.radiusKm ?? 10 });
    setLocalFavorites(updated);
  };

  const handleRemoveLocal = (id: string) => {
    const updated = removeLocalFavorite(id);
    setLocalFavorites(updated);
  };

  return (
    <>
      {/* Favorites strip */}
      <div className="relative">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragCancel={() => setActiveDragId(null)} onDragEnd={handleDragEnd}>
          <div
            ref={scrollRef}
            className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide"
            style={{ scrollBehavior: "smooth", WebkitOverflowScrolling: "touch" }}
          >
            {currentPos && <button onClick={() => onLocationChange({ lat: currentPos.lat, lon: currentPos.lon, name: "Position actuelle", radiusKm: 10 })} className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold tracking-tight transition-all ${isActive(locations[0]) ? "border-primary/70 bg-primary/15 text-primary" : "border-border bg-card/80 text-muted-foreground hover:border-primary/50 hover:text-foreground"}`}><Navigation className="h-4 w-4 shrink-0" /><span>Position actuelle</span></button>}
            {orderedFavorites.length === 0 && <button onClick={() => onLocationChange({lat:50.7567,lon:2.5204,name:"Hondeghem",radiusKm:20,localMode:"standard"})} className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-primary/70 bg-card/80 px-3 py-1.5 text-[13px] font-semibold text-primary"><MapPin className="h-4 w-4" />Hondeghem</button>}
            <SortableContext items={orderedFavorites.map((location) => location.id)} strategy={horizontalListSortingStrategy}>
              {orderedFavorites.map((loc) => {
                const active = isActive(loc);
                const weather = active ? activeWeather ?? prefetchedWeather?.get(loc.id) : prefetchedWeather?.get(loc.id);
                return <SortableFavoritePill key={loc.id} loc={loc} weather={weather} active={active} onSelect={() => onLocationChange({ lat: loc.lat, lon: loc.lon, name: loc.name, radiusKm: loc.radiusKm, favoriteId: loc.favoriteId, localMode: loc.localMode })} />;
              })}
            </SortableContext>

            {totalFavCount < MAX_FAVORITES && (
              <button
                onClick={() => setShowAddDialog(true)}
                className="flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/55 bg-card/80 px-3 py-1.5 text-[13px] font-semibold tracking-tight text-primary transition-colors hover:border-primary"
                aria-label="Ajouter un lieu favori"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Ajouter</span>
              </button>
            )}
            {user && (
              <Link
                href="/favorites"
                aria-label="Gérer, modifier ou supprimer mes villes favorites"
                title="Gérer mes villes"
                className="weather-icon-bare flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-xl border border-primary/45 bg-card/80 text-primary transition-colors hover:border-primary"
              >
                <Settings className="h-4 w-4" />
              </Link>
            )}
          </div>
          <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}>
            {activeDragLocation ? <div className="flex min-h-10 items-center gap-1.5 rounded-full border border-primary/80 bg-card/80 px-3 py-1.5 text-primary ring-1 ring-sky-300/60"><FavoritePillContent loc={activeDragLocation} weather={prefetchedWeather?.get(activeDragLocation.id)} active /></div> : null}
          </DragOverlay>
        </DndContext>

        {/* Dot indicators */}
        {locations.length > 1 && (
          <div className="flex justify-center gap-1 mt-1.5">
            {locations.map((loc) => (
              <div
                key={loc.id}
                  className={`h-1.5 w-1.5 rounded-full transition-all ${
                  isActive(loc) ? "w-4 bg-primary" : "bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add favorite dialog */}
      {showAddDialog && (
        <AddFavoriteDialog
          isLoggedIn={!!user}
          onClose={() => setShowAddDialog(false)}
          onAdded={(fav) => {
            if (!user) {
              handleAddFavorite(fav);
            }
            refetchFavorites();
            setShowAddDialog(false);
            // Auto-select the new location
            onLocationChange({ lat: fav.lat, lon: fav.lon, name: fav.name, radiusKm: fav.radiusKm ?? 20, favoriteId:fav.favoriteId,localMode:'standard' });
          }}
        />
      )}
    </>
  );
}

// ─── Add Favorite Dialog ────────────────────────────────────────────────────
function AddFavoriteDialog({
  isLoggedIn,
  onClose,
  onAdded,
}: {
  isLoggedIn: boolean;
  onClose: () => void;
  onAdded: (fav: { name: string; lat: number; lon: number; radiusKm?: number;favoriteId?:number }) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ name: string; lat: number; lon: number; country: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [customName, setCustomName] = useState("");
  const [selected, setSelected] = useState<{ name: string; lat: number; lon: number } | null>(null);

  const addMutation = trpc.favorites.add.useMutation({
    onSuccess: (data, variables) => {
      onAdded({ name: variables.name, lat: variables.lat, lon: variables.lon,favoriteId:data.id,radiusKm:20 });
    },
  });

  useEffect(() => {
    const controller=new AbortController();
    const q=query.trim();
    const searchCity=async()=>{
    if (q.length < 2) { setResults([]); setSearching(false); setNoResults(false); setSearchError(false); return; }
    setSearching(true);
    setSearchError(false);
    setNoResults(false);
    try {
      const places = await publicGeography.search(q,6,controller.signal);
      const mapped = places.map((r) => ({
        name: `${r.name}${r.admin1 ? `, ${r.admin1}` : ""}`,
        lat: r.latitude,
        lon: r.longitude,
        country: r.country ?? "",
      }));
      if(controller.signal.aborted)return;
      setResults(mapped);
      if (mapped.length === 0) setNoResults(true);
    } catch {
      if(controller.signal.aborted)return;
      setResults([]);
      setSearchError(true);
    }
    setSearching(false);
    };
    const timer = setTimeout(searchCity, 300);
    return () => {controller.abort();clearTimeout(timer);};
  }, [query]);

  const handleConfirm = () => {
    if (!selected) return;
    const name = customName || selected.name;
    if (isLoggedIn) {
      addMutation.mutate({ name, lat: selected.lat, lon: selected.lon });
    } else {
      onAdded({ name, lat: selected.lat, lon: selected.lon, radiusKm: 10 });
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex min-h-[100dvh] items-stretch justify-center bg-black/80 p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="add-location-title" className="flex h-[100dvh] w-full min-h-0 flex-col overflow-hidden bg-card ring-1 ring-black/45 animate-in slide-in-from-bottom-4 duration-200 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-md sm:rounded-2xl sm:border sm:border-border">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] sm:p-4">
          <div className="flex items-center gap-2">
            <div className="weather-icon-bare h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <MapPin className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 id="add-location-title" className="text-lg font-semibold">Ajouter un lieu</h3>
              <p className="text-xs text-muted-foreground">Recherchez une ville ou utilisez votre GPS</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fermer l’ajout de lieu" className="weather-icon-bare p-2 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
              placeholder="Rechercher une ville..."
              aria-label="Rechercher une ville"
              maxLength={120}
              className="w-full pl-9 pr-3 py-2.5 bg-muted border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoFocus
            />
          </div>

          {/* Results */}
          {searching && <p className="text-xs text-muted-foreground text-center py-2">Recherche...</p>}
          {searchError && !searching && (
            <p className="text-xs text-red-400 text-center py-2">Erreur réseau. Vérifiez votre connexion et réessayez.</p>
          )}
          {noResults && !searching && !searchError && (
            <p className="text-xs text-muted-foreground text-center py-2">Aucun résultat pour "{query}". Essayez un autre nom.</p>
          )}
          {results.length > 0 && !selected && (
            <div className="space-y-1 max-h-52 overflow-y-auto rounded-xl border border-border bg-muted/30 p-1">
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setSelected(r);
                    setCustomName(r.name.split(",")[0]);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-primary/10 text-left transition-colors"
                >
                  <MapPin className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.country} · {r.lat.toFixed(2)}°N, {r.lon.toFixed(2)}°E</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Selected — name input + confirm */}
          {selected && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-xl">
                <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
                <div className="text-xs min-w-0">
                  <p className="font-medium truncate">{selected.name}</p>
                  <p className="text-muted-foreground">{selected.lat.toFixed(4)}°N, {selected.lon.toFixed(4)}°E</p>
                </div>
              </div>
              <input
                type="text"
                value={customName}
                maxLength={256}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Nom personnalisé (optionnel)"
                className="w-full px-3 py-2.5 bg-muted border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                onClick={handleConfirm}
                disabled={addMutation.isPending}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Star className="h-4 w-4" />
                {addMutation.isPending ? "Ajout..." : "Ajouter aux favoris"}
              </button>
              {addMutation.error && <p role="alert" className="text-sm text-red-400">{addMutation.error.message}</p>}
              {!isLoggedIn && (
                <p className="text-xs text-muted-foreground text-center">
                  <a href={getLoginUrl()} className="text-primary hover:underline inline-flex items-center gap-1">
                    <LogIn className="h-3 w-3" />
                    Connectez-vous
                  </a>
                  {" "}pour synchroniser vos favoris sur tous vos appareils
                </p>
              )}
            </div>
          )}

          {/* Use current position */}
          {!selected && (
            <button
              onClick={() => {
                setGeoError("");
                if (!navigator.geolocation) {
                  setGeoError("La géolocalisation n'est pas disponible sur cet appareil.");
                  return;
                }
                navigator.geolocation.getCurrentPosition((pos) => {
                  setSelected({
                    name: "Ma position",
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                  });
                  setCustomName("Ma position");
                }, (err) => {
                  if (err.code === 1) {
                    setGeoError("Accès à la position refusé. Autorisez la géolocalisation dans les paramètres.");
                  } else {
                    setGeoError("Impossible d'obtenir votre position. Utilisez la recherche.");
                  }
                }, { timeout: 8000 });
              }}
              className="w-full flex items-center gap-2.5 px-3 py-3 rounded-xl border border-border hover:bg-muted text-sm transition-colors"
            >
              <Navigation className="h-4 w-4 text-primary" />
              <span>Utiliser ma position actuelle</span>
            </button>
          )}
          {geoError && (
            <p className="text-xs text-red-400 text-center py-1">{geoError}</p>
          )}

          {/* Quick popular locations */}
          {!selected && query.length < 2 && (
            <div className="pt-1">
              <p className="text-xs text-muted-foreground mb-2 font-medium">Villes populaires</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { name: "Paris", lat: 48.86, lon: 2.35 },
                  { name: "Lyon", lat: 45.76, lon: 4.84 },
                  { name: "Lille", lat: 50.63, lon: 3.06 },
                  { name: "Marseille", lat: 43.30, lon: 5.37 },
                  { name: "Bordeaux", lat: 44.84, lon: -0.58 },
                ].map((city) => (
                  <button
                    key={city.name}
                    onClick={() => {
                      setSelected(city);
                      setCustomName(city.name);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-muted border border-border text-xs font-medium hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-colors"
                  >
                    {city.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
