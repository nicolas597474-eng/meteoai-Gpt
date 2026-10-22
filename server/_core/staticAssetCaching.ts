import path from "node:path";

/**
 * Le shell SPA ne contient aucune donnée propre à une session. Un cache court
 * permet aux navigations entre pages de ne pas repasser systématiquement par
 * le proxy public lent, tout en laissant une nouvelle version disponible vite.
 */
export const SPA_SHELL_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

/**
 * Durée de cache des médias statiques dont le nom ne contient pas d'empreinte.
 * Servis auparavant en `no-store`, ils étaient retéléchargés à chaque
 * chargement à froid, en concurrence directe avec les requêtes de données.
 * Sept jours suffisent à supprimer ce coût pour un visiteur récurrent tout en
 * laissant une fenêtre de correction volontairement bornée : un fichier
 * remplacé sous le même nom est repris au plus tard au bout de cette durée.
 */
export const UNVERSIONED_MEDIA_CACHE_CONTROL = "public, max-age=604800, stale-while-revalidate=86400";

/** Extensions réellement servies comme contenu binaire, jamais comme code. */
const MEDIA_EXTENSION = /\.(png|jpe?g|webp|avif|gif|svg|ico|bmp)$/i;

export function getStaticAssetCacheControl(filePath: string): string {
 const normalized = filePath.replaceAll("\\", "/");
 const name = path.posix.basename(normalized);
 // Never cache HTML/session/runtime metadata, even if a filename resembles a hash.
 const hashedAsset = normalized.includes("/assets/") && /-[a-zA-Z0-9_-]{8,}\.(js|css|woff2?|png|jpe?g|webp|avif|svg)$/.test(name);
 if (hashedAsset) return "public, max-age=31536000, immutable";

 // Les dossiers de médias de l'application (/assets/lunar, /assets/solar et
 // tout futur /textures/…) portent des noms stables sans empreinte. Seules les
 // images y sont concernées : .js, .css, .html, .json et les service workers
 // restent en no-store, y compris sous /assets/ (test « unversioned assets »).
 const isMediaDirectory = normalized.includes("/textures/") || normalized.includes("/assets/");
 if (isMediaDirectory && MEDIA_EXTENSION.test(name)) return UNVERSIONED_MEDIA_CACHE_CONTROL;

 return "no-cache, no-store, must-revalidate";
}
