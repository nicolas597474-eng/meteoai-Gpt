import { describe, expect, it } from "vitest";
import { getStaticAssetCacheControl, SPA_SHELL_CACHE_CONTROL, UNVERSIONED_MEDIA_CACHE_CONTROL } from "./staticAssetCaching";
describe("static asset caching", () => {
 it("caches content-hashed JavaScript and CSS", () => {
  for (const file of ["/dist/public/assets/Dashboard-B2zD5I7i.js", "/dist/public/assets/index-Abc12345.css"]) expect(getStaticAssetCacheControl(file)).toBe("public, max-age=31536000, immutable");
 });
 it("never caches shell, runtime/session data, service workers or unversioned assets", () => {
  for (const file of ["/dist/public/index.html", "/dist/public/__manus__/version.json", "/dist/public/assets/index.js", "/dist/public/assets/page-Abc12345.html", "/dist/public/sw.js", "/api/trpc/auth.me"]) expect(getStaticAssetCacheControl(file)).toContain("no-store");
 });

 it("permet au shell public sans donnée de session d’être réutilisé brièvement", () => {
  expect(SPA_SHELL_CACHE_CONTROL).toBe("public, max-age=60, stale-while-revalidate=300");
 });

 it("met en cache les images sans empreinte des dossiers de médias", () => {
  // Noms sans suffixe identifiant : cache borné, jamais `immutable`, car le
  // fichier peut être remplacé sans changer de nom.
  for (const file of [
   "/dist/public/assets/logo.png",
   "/dist/public/assets/sky.png",
  ]) expect(getStaticAssetCacheControl(file)).toBe(UNVERSIONED_MEDIA_CACHE_CONTROL);

  // Les visuels lunaires et solaires portent un suffixe d'au moins huit
  // caractères après un tiret : ils sont donc traités comme des assets
  // identifiés par leur contenu et conservent le cache d'un an.
  for (const file of [
   "/dist/public/assets/lunar/nasa-lroc-wac-moon-2k.webp",
   "/dist/public/assets/solar/nasa-hmi-solar-disc-2011.webp",
  ]) expect(getStaticAssetCacheControl(file)).toBe("public, max-age=31536000, immutable");

  // Rien qui ne soit une image ne devient cacheable par cette règle.
  for (const file of [
   "/dist/public/weather-export.json",
   "/dist/public/data/history.csv",
   "/dist/public/assets/logo.png.bak.css",
  ]) expect(getStaticAssetCacheControl(file)).toBe("no-cache, no-store, must-revalidate");
 });
});
