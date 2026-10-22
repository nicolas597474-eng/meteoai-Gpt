import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import {
  BLOCKED_NETWORK_CODE,
  isAllowedTestHttpUrl,
  isLoopbackTestHost,
  sanitizeTestEnvironment,
} from "./testNetworkGuard";

describe("isolation réseau des tests", () => {
  it("retire les variables héritées avant l’évaluation des tests", () => {
    expect(process.env.METEOAI_TEST_INHERITED_MARKER).toBeUndefined();
  });

  it("ne conserve que l’environnement de test sans credential héritée", () => {
    process.env.METEOAI_TEST_ONLY_MARKER = "synthetic-value";
    sanitizeTestEnvironment();

    expect(process.env.METEOAI_TEST_ONLY_MARKER).toBeUndefined();
    expect(process.env.NODE_ENV).toBe("test");
  });

  it("n’autorise que les URL HTTP(S) de boucle locale", () => {
    expect(isAllowedTestHttpUrl("http://127.0.0.1:3000/fixture")).toBe(true);
    expect(isAllowedTestHttpUrl("https://[::1]:3000/fixture")).toBe(true);
    expect(isAllowedTestHttpUrl("https://api.example.invalid/data")).toBe(false);
    expect(isAllowedTestHttpUrl("file:///tmp/fixture")).toBe(false);
    expect(isLoopbackTestHost("localhost")).toBe(true);
    expect(isLoopbackTestHost("api.localhost.example")).toBe(false);
  });

  it("rejette fetch externe avant tout accès réseau", async () => {
    await expect(fetch("https://api.example.invalid/no-network"))
      .rejects.toMatchObject({ code: BLOCKED_NETWORK_CODE });
  });

  it("rejette une socket TCP externe avant toute résolution DNS ou connexion", () => {
    let caught: unknown;
    try {
      new Socket().connect({ host: "api.example.invalid", port: 443 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: BLOCKED_NETWORK_CODE });
  });
});
