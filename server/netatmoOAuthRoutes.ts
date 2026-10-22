import type { Express, Request, Response } from "express";
import { consumeNetatmoOAuthState, hasActiveNetatmoOAuthState, upsertNetatmoOAuthToken } from "./db";
import { encryptNetatmoRefreshToken, hashNetatmoState, NETATMO_REDIRECT_URI, NETATMO_SCOPE, verifyNetatmoState } from "./netatmoOAuth";

function queryValue(req: Request, key: string) {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function getNetatmoCallbackDiagnostic({
  code,
  state,
  netatmoError,
  verifiedState,
}: {
  code?: string;
  state?: string;
  netatmoError?: string;
  verifiedState: unknown;
}) {
  const safeNetatmoError = netatmoError?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (safeNetatmoError) return `netatmo_${safeNetatmoError}`;
  if (!code) return "code_absent";
  if (!state) return "state_absent";
  if (!verifiedState) return "state_signature_invalide_ou_expiree";
  return null;
}

export function registerNetatmoOAuthRoutes(app: Express) {
  app.get("/api/netatmo/callback", async (req: Request, res: Response) => {
    const code = queryValue(req, "code");
    const state = queryValue(req, "state");
    const netatmoError = queryValue(req, "error");
    const verifiedState = state ? verifyNetatmoState(state) : null;
    const reason = getNetatmoCallbackDiagnostic({ code, state, netatmoError, verifiedState });
    if (reason) {
      console.warn(`[Netatmo OAuth] Callback rejeté: ${reason}; longueur_state=${state?.length ?? 0}`);
      res.status(400).send(`Connexion Netatmo refusée (${reason}). Relancez l’autorisation depuis MeteoAI.`);
      return;
    }
    // Défense explicite : le diagnostic nul implique ces deux valeurs, mais ce
    // garde-fou maintient le contrat du callback et le raffinement TypeScript.
    if (!code || !verifiedState) {
      res.status(400).send("Connexion Netatmo refusée (callback_invalide). Relancez l’autorisation depuis MeteoAI.");
      return;
    }
    const stateHash = hashNetatmoState(state!);
    const stateActive = await hasActiveNetatmoOAuthState(stateHash);
    if (!stateActive) {
      console.warn("[Netatmo OAuth] Callback rejeté: état absent, expiré ou déjà consommé");
      res.status(400).send("Connexion Netatmo expirée ou déjà utilisée. Relancez l’autorisation depuis MeteoAI.");
      return;
    }

    try {
      const form = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.NETATMO_CLIENT_ID ?? "",
        client_secret: process.env.NETATMO_CLIENT_SECRET ?? "",
        code,
        redirect_uri: NETATMO_REDIRECT_URI,
        scope: NETATMO_SCOPE,
      });
      const response = await fetch("https://api.netatmo.com/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: form,
        signal: AbortSignal.timeout(15_000),
      });
      const token = await response.json() as { refresh_token?: string };
      if (!response.ok || !token.refresh_token) throw new Error("Netatmo token exchange failed");
      await upsertNetatmoOAuthToken(verifiedState.userId, encryptNetatmoRefreshToken(token.refresh_token), NETATMO_SCOPE);
      const stateConsumed = await consumeNetatmoOAuthState(stateHash);
      if (!stateConsumed) {
        console.warn("[Netatmo OAuth] State déjà consommé après échange de jeton");
      }
      res.redirect(302, "/reliability?netatmo=connected");
    } catch (error) {
      console.error("[Netatmo OAuth] Callback failed", error);
      res.status(502).send("Connexion Netatmo impossible. Vérifiez l’application et relancez l’autorisation.");
    }
  });
}
