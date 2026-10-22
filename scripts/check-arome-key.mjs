/**
 * Diagnostic AROME / Météo-France — ne modifie aucune donnée, ne fait qu’interroger le portail.
 *
 * Usage :
 *   node scripts/check-arome-key.mjs                 # lit METEOFRANCE_API_KEY du .env puis de l’environnement
 *   METEOFRANCE_API_KEY=xxxx node scripts/check-arome-key.mjs
 *   node scripts/check-arome-key.mjs --coverage      # ajoute un GetCoverage GeoTIFF réel (1 échéance)
 *
 * Sécurité : la clé et le jeton ne sont JAMAIS affichés. Seules des empreintes
 * (longueurs, préfixes masqués, formes) sont imprimées.
 *
 * Chaîne testée (identique à server/aromeHondeghemShadow.ts) :
 *   1. POST https://portail-api.meteofrance.fr/token   Authorization: Basic <APPLICATION_ID>
 *   2. GET  .../MF-NWP-HIGHRES-AROME-001-FRANCE-WCS/GetCapabilities?service=WCS&version=2.0.1&language=fre
 *   3. GET  .../DescribeCoverage  (couverture température du dernier run)
 *   4. GET  .../GetCoverage       (option --coverage)
 */

import { existsSync, readFileSync } from "node:fs";

/** Lecture minimaliste du .env : le script doit tourner même sans node_modules installé. */
function loadEnvFile(path = ".env") {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (process.env[key] != null) continue;
    const value = line.slice(separator + 1).trim().replace(/^["'](.*)["']$/, "$1");
    process.env[key] = value;
  }
}

loadEnvFile();

const TOKEN_URL = "https://portail-api.meteofrance.fr/token";
const PROFILE = "MF-NWP-HIGHRES-AROME-001-FRANCE-WCS";
const WCS_BASE = `https://public-api.meteofrance.fr/public/arome/1.0/wcs/${PROFILE}`;
const TIMEOUT_MS = 20_000;
const wantCoverage = process.argv.includes("--coverage");

const raw = (process.env.METEOFRANCE_API_KEY ?? "").trim();
const C = { red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", dim: "\x1b[2m", reset: "\x1b[0m", bold: "\x1b[1m" };
const line = (t = "") => console.log(t);
const ok = (t) => console.log(`${C.green}✔${C.reset} ${t}`);
const warn = (t) => console.log(`${C.yellow}▲${C.reset} ${t}`);
const bad = (t) => console.log(`${C.red}✖${C.reset} ${t}`);
const info = (t) => console.log(`${C.dim}  ${t}${C.reset}`);
const mask = (value, keep = 3) => (value.length <= keep ? "•".repeat(value.length) : `${value.slice(0, keep)}${"•".repeat(Math.min(value.length - keep, 12))}`);

function describeKeyShape(value) {
  if (!value) return { kind: "absente", detail: "la variable est vide ou absente" };
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) {
    return { kind: "jeton JWT (access token)", detail: "ce n’est PAS un identifiant d’application : le Basic échouera" };
  }
  if (/^__.*__$/.test(value)) {
    return { kind: "jeton d’application mobile (rpcache)", detail: "jeton du site/appli Météo-France, invalide sur portail-api" };
  }
  const base64Like = /^[A-Za-z0-9+/=_-]+$/.test(value) && value.length % 4 === 0;
  if (!base64Like) {
    if (value.includes(":")) return { kind: "paire client_id:client_secret en clair", detail: "doit être encodée en base64 avant l’en-tête Basic" };
    return { kind: "non base64", detail: "un APPLICATION_ID est une chaîne base64 (pas d’espace, longueur multiple de 4)" };
  }
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
      return { kind: "base64 non canonique", detail: "le décodage ne fait pas un aller-retour exact" };
    }
    if (!decoded.includes(":")) return { kind: "base64 valide mais sans « : »", detail: "on attend base64(client_id:client_secret)" };
    const [id, secret] = decoded.split(":");
    return {
      kind: "APPLICATION_ID base64(client_id:client_secret)",
      detail: `client_id ${id.length} car. (${mask(id)}) · secret ${secret.length} car. (${mask(secret)})`,
      decoded,
    };
  } catch {
    return { kind: "base64 illisible", detail: "décodage impossible" };
  }
}

async function step1_token() {
  line(`${C.bold}1. Échange OAuth2${C.reset} — POST ${TOKEN_URL}`);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${raw}`,
      "Content-Type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) {
    bad(`HTTP ${response.status} — identifiant refusé.`);
    info("Causes les plus fréquentes :");
    info("• la valeur n’est pas l’APPLICATION_ID base64 généré sur le portail (« Mes API > Générer un token ») ;");
    info("• l’APPLICATION_ID a été généré pour une autre API que le paquet AROME (il est propre à chaque abonnement) ;");
    info("• l’abonnement AROME a expiré ou n’a pas été validé sur le compte.");
    return null;
  }
  if (!response.ok) {
    bad(`HTTP ${response.status} — service de jeton indisponible (réessayer plus tard).`);
    return null;
  }
  const payload = await response.json().catch(() => null);
  const token = typeof payload?.access_token === "string" ? payload.access_token : "";
  if (!token) {
    bad("Échange accepté mais aucun access_token dans la réponse.");
    return null;
  }
  ok(`Jeton obtenu (expire dans ${payload.expires_in ?? "?"} s, ${token.length} caractères).`);
  return token;
}

async function step2_capabilities(token) {
  line();
  line(`${C.bold}2. Catalogue WCS${C.reset} — GetCapabilities — profil ${PROFILE}`);
  const url = new URL(`${WCS_BASE}/GetCapabilities`);
  url.searchParams.set("service", "WCS");
  url.searchParams.set("version", "2.0.1");
  url.searchParams.set("language", "fre");
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, accept: "application/xml" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) {
    bad(`HTTP ${response.status} — le jeton est valide mais l’API AROME le refuse.`);
    info("Le jeton a bien été délivré : le problème est l’ABONNEMENT, pas la clé.");
    info("Vérifier sur portail-api.meteofrance.fr > Mes API que le paquet « AROME — Haute résolution »");
    info(`(profil ${PROFILE}) est bien souscrit avec CET identifiant.`);
    return null;
  }
  if (!response.ok) {
    bad(`HTTP ${response.status} — catalogue indisponible.`);
    return null;
  }
  const xml = await response.text();
  const ids = [...xml.matchAll(/<(?:\w+:)?CoverageId\b[^>]*>([\s\S]*?)<\/(?:\w+:)?CoverageId>/gi)].map((m) => m[1].trim());
  const runs = [...new Set(ids.map((id) => id.match(/___(\d{4}-\d{2}-\d{2}T[\d.]+Z)/)?.[1]).filter(Boolean))]
    .sort()
    .reverse();
  ok(`Catalogue lu : ${ids.length} coverageId, ${runs.length} run(s).`);
  info(`Dernier run détecté : ${runs[0] ?? "aucun"}`);
  const temperature = ids.find((id) => /^TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___/i.test(id) && id.includes(runs[0] ?? ""));
  if (!temperature) {
    warn("Aucune couverture TEMPERATURE reconnue dans le dernier run : la comparaison restera « request-impossible ».");
    return null;
  }
  info(`Couverture test : ${temperature}`);
  return { token, coverageId: temperature, run: runs[0] };
}

async function step3_describe(ctx) {
  line();
  line(`${C.bold}3. Métadonnées${C.reset} — DescribeCoverage`);
  const url = new URL(`${WCS_BASE}/DescribeCoverage`);
  url.searchParams.set("service", "WCS");
  url.searchParams.set("version", "2.0.1");
  url.searchParams.set("coverageID", ctx.coverageId);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${ctx.token}`, accept: "application/xml" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    bad(`HTTP ${response.status} — DescribeCoverage refusé.`);
    return ctx;
  }
  const xml = await response.text();
  const axisLabels = [...xml.matchAll(/\baxisLabels=["']([^"']+)["']/gi)].map((m) => m[1])[0] ?? "?";
  const heights = xml.match(/gridAxesSpanned[^>]*>\s*height/i)
    ? (xml.match(/<(?:\w+:)?coefficients[^>]*>([\d\s.,+-]+)<\/(?:\w+:)?coefficients>/i)?.[1] ?? "?").trim().split(/\s+/).slice(0, 8).join(", ")
    : "axe height absent";
  const unit = xml.match(/<(?:\w+:)?uom\b[^>]*\b(?:code|href)=["']([^"']+)["']/i)?.[1] ?? "?";
  ok("DescribeCoverage lu.");
  info(`axisLabels = ${axisLabels} · unité = ${unit} · hauteurs = ${heights}`);
  if (!axisLabels.includes("height")) warn("Aucun axe height : la sous-sélection height(2) sera impossible.");
  if (!["k", "K", "°C", "C", "celsius", "Kelvin"].some((u) => unit.includes(u))) warn(`Unité « ${unit} » non reconnue par convertOfficialValue().`);
  return ctx;
}

async function step4_coverage(ctx) {
  line();
  line(`${C.bold}4. Téléchargement${C.reset} — GetCoverage (GeoTIFF)`);
  const validAt = ctx.run;
  const url = new URL(`${WCS_BASE}/GetCoverage`);
  url.searchParams.set("service", "WCS");
  url.searchParams.set("version", "2.0.1");
  url.searchParams.set("coverageid", ctx.coverageId);
  url.searchParams.append("subset", `time(${validAt})`);
  url.searchParams.append("subset", "height(2)");
  url.searchParams.append("subset", "lat(50.7167,50.7967)");
  url.searchParams.append("subset", "long(2.4804,2.5604)");
  url.searchParams.set("format", "image/tiff");
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${ctx.token}`, accept: "application/octet-stream" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 403) {
    warn("HTTP 403 — échéance pas encore publiée sur le backend (normal juste après la sortie d’un run).");
    return;
  }
  if (!response.ok) {
    bad(`HTTP ${response.status} — GetCoverage refusé.`);
    return;
  }
  const buffer = await response.arrayBuffer();
  ok(`GeoTIFF reçu : ${buffer.byteLength} octets.`);
}

line(`${C.bold}Diagnostic AROME / Météo-France${C.reset}`);
line(`${C.dim}Profil : ${PROFILE}${C.reset}`);
line();
line(`${C.bold}0. Variable d’environnement${C.reset} — METEOFRANCE_API_KEY`);
if (!raw) {
  bad("Absente.");
  info("Renseigner METEOFRANCE_API_KEY dans .env (ou dans les secrets du déploiement).");
  info("Valeur attendue : l’APPLICATION_ID base64 affiché dans la commande curl du portail,");
  info('du type : curl -X POST https://portail-api.meteofrance.fr/token -d "grant_type=client_credentials" \\');
  info('         -H "Authorization: Basic <APPLICATION_ID>"');
  process.exit(1);
}
const shape = describeKeyShape(raw);
info(`Longueur : ${raw.length} caractères · forme détectée : ${shape.kind}`);
info(shape.detail);
if (shape.kind !== "APPLICATION_ID base64(client_id:client_secret)") {
  warn("Cette valeur ne correspond pas à ce que le code envoie dans l’en-tête Basic.");
  warn("Le test continue, mais un échec 401 à l’étape 1 confirmera le diagnostic.");
} else {
  ok("Forme conforme à l’échange OAuth2 client_credentials.");
}

try {
  const token = await step1_token();
  if (token) {
    const ctx = await step2_capabilities(token);
    if (ctx) {
      await step3_describe(ctx);
      if (wantCoverage) await step4_coverage(ctx);
      else info("(option --coverage non demandée : aucun GeoTIFF téléchargé)");
    }
  }
  line();
  line(`${C.dim}Fin du diagnostic — aucune donnée de production n’a été lue ni écrite.${C.reset}`);
} catch (error) {
  line();
  bad(`Requête impossible : ${error?.name === "TimeoutError" || error?.name === "AbortError" ? "délai de 20 s dépassé" : error?.message ?? error}`);
  info("Si le réseau de ce poste bloque portail-api.meteofrance.fr / public-api.meteofrance.fr,");
  info("relancer le script depuis l’environnement qui exécute le serveur.");
  process.exitCode = 2;
}
