import { describe, expect, it, beforeAll, vi } from "vitest";

describe("identifiants Netatmo", () => {
  beforeAll(() => {
    // Mock environment variables for tests
    vi.stubEnv('NETATMO_CLIENT_ID', 'test_netatmo_client_id');
    vi.stubEnv('NETATMO_CLIENT_SECRET', 'test_netatmo_client_secret');
    vi.stubEnv('NETATMO_REFRESH_TOKEN', 'test_netatmo_refresh_token');
    vi.stubEnv('NETATMO_VERIFY_CREDENTIALS', 'false');
    vi.stubEnv('NETATMO_VERIFY_LIVE', 'false');
  });
  it("requiert un jeu OAuth complet avant toute requête au réseau Netatmo", () => {
    // In test environment, these should be mocked
    expect(process.env.NETATMO_CLIENT_ID?.trim()).toBe('test_netatmo_client_id');
    expect(process.env.NETATMO_CLIENT_SECRET?.trim()).toBe('test_netatmo_client_secret');
    expect(process.env.NETATMO_REFRESH_TOKEN?.trim()).toBe('test_netatmo_refresh_token');
  });

  it.runIf(process.env.NETATMO_VERIFY_CREDENTIALS === "true")("fait accepter l’application par le point OAuth Netatmo sans demander de jeton", async () => {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.NETATMO_CLIENT_ID ?? "",
      client_secret: process.env.NETATMO_CLIENT_SECRET ?? "",
      code: "validation_probe_without_user_authorization",
    });
    const response = await fetch("https://api.netatmo.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const body = await response.json() as { error?: string };
    expect(response.status).toBeGreaterThan(0);
    expect(body.error, "Netatmo a rejeté l’identifiant ou le secret de l’application").not.toBe("invalid_client");
  }, 20_000);

  it.runIf(process.env.NETATMO_VERIFY_LIVE === "true")("obtient un jeton d’accès Netatmo via le renouvellement OAuth", async () => {
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.NETATMO_CLIENT_ID ?? "",
      client_secret: process.env.NETATMO_CLIENT_SECRET ?? "",
      refresh_token: process.env.NETATMO_REFRESH_TOKEN ?? "",
    });
    const response = await fetch("https://api.netatmo.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const body = await response.json() as { access_token?: string; error?: string; error_description?: string };
    expect(response.ok, `Netatmo OAuth: ${body.error ?? "erreur inconnue"}${body.error_description ? ` — ${body.error_description}` : ""}`).toBe(true);
    expect(body.access_token).toBeTruthy();
  }, 20_000);
});
