import {useLocation as useActiveLocation} from "@/contexts/LocationContext";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ArrowLeft, MapPin, Star, Trash2, Edit3, Save, Radio } from "lucide-react";
import { Link } from "wouter";
import { MeteoSurface } from "@/components/weather/MeteoSurface";

export default function FavoriteSettings() {
  const { user } = useAuth();
  const {activeLocation,setActiveLocation}=useActiveLocation();
  const { data: favorites = [], refetch } = trpc.favorites.list.useQuery(undefined, { enabled: !!user });
  const updateMutation = trpc.favorites.update.useMutation({onSuccess:async(_result,values)=>{
    await refetch();
    if(activeLocation?.favoriteId===values.id){setActiveLocation({...activeLocation,name:values.customName??activeLocation.name,radiusKm:values.radiusKm??activeLocation.radiusKm,localMode:values.localMode??activeLocation.localMode});if(values.localMode)try{localStorage.setItem('meteoai_local_mode',values.localMode);}catch{}}
  }});
  const removeMutation = trpc.favorites.delete.useMutation({ onSuccess: () => refetch() });
  const setDefaultMutation = trpc.favorites.setDefault.useMutation({ onSuccess: () => refetch() });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editRadius, setEditRadius] = useState(10);
  const [editUnit, setEditUnit] = useState<"celsius" | "fahrenheit">("celsius");
  const [editLocalMode, setEditLocalMode] = useState<"standard" | "local" | "ultra-local">("standard");

  const startEdit = (fav: any) => {
    setEditingId(fav.id);
    setEditName(fav.customName || fav.name);
    setEditRadius(fav.radiusKm ?? 10);
    setEditUnit(fav.tempUnit ?? "celsius");
    setEditLocalMode(fav.localMode ?? "standard");
  };

  const saveEdit = () => {
    if (editingId == null) return;
    updateMutation.mutate({
      id: editingId,
      customName: editName,
      radiusKm: editRadius,
      tempUnit: editUnit,
      localMode: editLocalMode,
    }, { onSuccess: () => setEditingId(null) });
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <MeteoSurface className="max-w-sm rounded-2xl p-6 text-center">
          <Star className="h-10 w-10 mx-auto text-yellow-400 mb-3" />
          <h2 className="text-lg font-semibold mb-2">Connexion requise</h2>
          <p className="text-sm text-muted-foreground">Connectez-vous pour gérer vos lieux favoris.</p>
        </MeteoSurface>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/">
            <button className="weather-icon-bare p-2 rounded-lg hover:bg-muted transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">Lieux favoris</h1>
            <p className="text-xs text-muted-foreground">{favorites.length}/5 favoris enregistrés</p>
          </div>
        </div>

        {/* Favorites list */}
        <div className="space-y-3">
          {favorites.length === 0 && (
            <div className="text-center py-8">
              <MapPin className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">Aucun favori enregistré.</p>
              <p className="text-xs text-muted-foreground mt-1">Ajoutez un lieu depuis le Dashboard.</p>
            </div>
          )}

          {favorites.map((fav: any) => (
            <MeteoSurface key={fav.id} className="rounded-xl p-4">
              {editingId === fav.id ? (
                /* Edit mode */
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground font-medium">Nom personnalisé</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full mt-1 px-3 py-2 bg-muted border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground font-medium">Mode de calcul</label>
                    <div className="flex items-center gap-2 mt-1">
                      {(["standard", "local", "ultra-local"] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setEditLocalMode(mode)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            editLocalMode === mode
                              ? mode === "ultra-local"
                                ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                                : mode === "local"
                                  ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                                  : "bg-primary/20 border-primary text-primary"
                              : "bg-muted border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {mode === "ultra-local" ? "Ultra-local" : mode === "local" ? "Local" : "Standard"}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {editLocalMode === "ultra-local"
                        ? "Stations à moins de 10 km, avec priorité aux plus proches. Ajustements sans calibration désactivés."
                        : editLocalMode === "local"
                          ? "Stations à moins de 30 km. Altitude corrigée seulement avec une référence explicite."
                          : "Pondération équilibrée. Rayon complet de recherche."
                      }
                    </p>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground font-medium">Rayon de recherche des stations</label>
                    <div className="flex items-center gap-3 mt-1">
                      {[5, 10, 20, 50].map(r => (
                        <button
                          key={r}
                          onClick={() => setEditRadius(r)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            editRadius === r
                              ? "bg-primary/20 border-primary text-primary"
                              : "bg-muted border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {r} km
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground font-medium">Unité de température</label>
                    <div className="flex items-center gap-3 mt-1">
                      {(["celsius"] as const).map(u => (
                        <button
                          key={u}
                          onClick={() => setEditUnit(u)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            editUnit === u
                              ? "bg-primary/20 border-primary text-primary"
                              : "bg-muted border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {u === "celsius" ? "°C" : "°F"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {updateMutation.error && <p role="alert" className="text-xs text-red-300">{updateMutation.error.message}</p>}
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={saveEdit}
                      disabled={updateMutation.isPending}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Enregistrer
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-4 py-2 bg-muted border border-border rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                /* View mode */
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`weather-icon-bare w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        fav.isDefault ? "bg-yellow-500/20" : "bg-muted"
                      }`}>
                        <Star className={`h-4 w-4 ${fav.isDefault ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground"}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{fav.customName || fav.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {fav.lat.toFixed(2)}°N, {fav.lon.toFixed(2)}°E · {fav.radiusKm ?? 10} km
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!fav.isDefault && (
                        <button
                          onClick={() => setDefaultMutation.mutate({ id: fav.id })}
                          title="Définir par défaut"
                          className="weather-icon-bare p-2 rounded-lg hover:bg-yellow-500/10 text-muted-foreground hover:text-yellow-400 transition-colors"
                        >
                          <Star className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(fav)}
                        className="weather-icon-bare p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm("Supprimer ce favori ?")) {
                            removeMutation.mutate({ id: fav.id });
                          }
                        }}
                        className="weather-icon-bare p-2 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Mode badge */}
                  {fav.localMode && fav.localMode !== "standard" && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <Radio className={`h-3 w-3 ${fav.localMode === "ultra-local" ? "text-emerald-400" : "text-blue-400"}`} />
                      <span className={`text-[10px] font-medium ${fav.localMode === "ultra-local" ? "text-emerald-400" : "text-blue-400"}`}>
                        Mode {fav.localMode === "ultra-local" ? "Ultra-local" : "Local"}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </MeteoSurface>
          ))}
        </div>

        {/* Info */}
        <MeteoSurface tone="subtle" className="rounded-xl bg-muted/50 p-4">
          <h3 className="text-sm font-semibold mb-2">Paramètres par lieu</h3>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li>• <strong>Nom personnalisé</strong> — Renommez vos favoris librement</li>
            <li>• <strong>Mode de calcul</strong> — Standard, Local ou Ultra-local (pondération des stations)</li>
            <li>• <strong>Rayon de recherche</strong> — Distance max pour trouver les stations locales (5-50 km)</li>
            <li>• <strong>Unité de température</strong> — Celsius (°C)</li>
            <li>• <strong>Favori par défaut</strong> — Lieu affiché au démarrage de l'application</li>
          </ul>
        </MeteoSurface>
      </div>
    </div>
  );
}
