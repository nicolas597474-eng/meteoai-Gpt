/**
 * Météo-France — lecture et normalisation de l’identifiant d’application.
 *
 * Le portail Météo-France n’accepte qu’une seule forme d’authentification pour les API
 * AROME/ARPEGE : un échange OAuth2 `client_credentials` dont l’en-tête est
 *
 *     Authorization: Basic <APPLICATION_ID>          # APPLICATION_ID = base64(client_id:client_secret)
 *
 * L’APPLICATION_ID est affiché par le portail dans la commande curl « Générer un token »
 * (Mes API › choisir l’API › Générer un token). Il est propre à chaque abonnement.
 *
 * Ce module ne fait que de l’analyse de forme : il ne journalise jamais la valeur, ne
 * l’envoie nulle part et n’essaie pas de deviner un secret. Son rôle est de transformer
 * un échec 401 anonyme en cause explicite, et d’accepter la paire `client_id:client_secret`
 * écrite en clair dans `.env` (encodée ici en base64 pour l’en-tête).
 */

export type MeteoFranceCredentialKind =
  /** Variable absente ou vide. */
  | "missing"
  /** Chaîne base64 utilisable telle quelle dans l’en-tête Basic. */
  | "application-id"
  /** Paire `client_id:client_secret` en clair, encodée en base64 par ce module. */
  | "client-secret-pair"
  /** Jeton d’accès (JWT) : ce n’est pas un identifiant d’application. */
  | "access-token"
  /** Jeton du site / de l’application mobile (`__…__`) : non valide sur portail-api. */
  | "mobile-token"
  /** Forme non reconnue ; transmise telle quelle (comportement historique). */
  | "unknown";

export interface MeteoFranceCredential {
  kind: MeteoFranceCredentialKind;
  /** Valeur prête à être placée dans `Authorization: Basic …`; null si inutilisable. */
  basic: string | null;
  /** Cause explicite, sans jamais divulguer la valeur. */
  message: string;
}

const MISSING_MESSAGE =
  "Identifiant d’application OAuth2 METEOFRANCE_API_KEY manquant : aucune requête fournisseur n’a été envoyée.";

const HOW_TO_GET_AN_APPLICATION_ID =
  "Générez un APPLICATION_ID sur portail-api.meteofrance.fr (Mes API › API AROME › Générer un token) et copiez la chaîne base64 de la commande curl affichée.";

function looksLikeJwt(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return false;
  try {
    return Buffer.from(parts[0], "base64url").toString("utf8").trimStart().startsWith("{");
  } catch {
    return false;
  }
}

function isBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0;
}

/**
 * Inspecte la valeur de `METEOFRANCE_API_KEY` (ou de toute variable équivalente).
 * Aucune sortie réseau, aucune journalisation de la valeur.
 */
export function inspectMeteoFranceCredential(raw: string | null | undefined): MeteoFranceCredential {
  const value = (raw ?? "").trim();
  if (!value) return { kind: "missing", basic: null, message: MISSING_MESSAGE };

  if (looksLikeJwt(value)) {
    return {
      kind: "access-token",
      basic: null,
      message:
        "METEOFRANCE_API_KEY contient un jeton d’accès (JWT) et non un identifiant d’application : l’échange OAuth2 attend un APPLICATION_ID. " +
        HOW_TO_GET_AN_APPLICATION_ID,
    };
  }

  if (/^__[A-Za-z0-9+/=_-]+__$/.test(value)) {
    return {
      kind: "mobile-token",
      basic: null,
      message:
        "METEOFRANCE_API_KEY contient le jeton du site ou de l’application mobile Météo-France : ce jeton n’est pas accepté par portail-api.meteofrance.fr. " +
        HOW_TO_GET_AN_APPLICATION_ID,
    };
  }

  if (value.includes(":")) {
    const [id, ...rest] = value.split(":");
    const secret = rest.join(":");
    if (id.length > 0 && secret.length > 0) {
      return {
        kind: "client-secret-pair",
        basic: Buffer.from(value, "utf8").toString("base64"),
        message:
          "METEOFRANCE_API_KEY contient une paire client_id:client_secret en clair : elle a été encodée en base64 pour l’en-tête Basic. " +
          "Enregistrez de préférence directement la forme base64 renvoyée par le portail.",
      };
    }
  }

  if (isBase64(value)) return { kind: "application-id", basic: value, message: "Identifiant d’application OAuth2 conforme à l’échange client_credentials." };

  return {
    kind: "unknown",
    basic: value,
    message: "Forme de METEOFRANCE_API_KEY non reconnue (ni base64 ni paire client_id:client_secret) : la valeur est transmise telle quelle au portail.",
  };
}
