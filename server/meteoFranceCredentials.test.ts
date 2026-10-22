import { describe, expect, it } from "vitest";
import { inspectMeteoFranceCredential } from "./meteoFranceCredentials";

const APPLICATION_ID = Buffer.from("my-client-id:my-client-secret", "utf8").toString("base64");
const JWT = `${Buffer.from('{"alg":"HS256","typ":"JWT"}', "utf8").toString("base64url")}.${Buffer.from('{"sub":"abcd"}', "utf8").toString("base64url")}.signature`;

describe("inspectMeteoFranceCredential", () => {
  it("signale l’absence de valeur sans rien transmettre", () => {
    for (const value of [undefined, null, "", "   "]) {
      const credential = inspectMeteoFranceCredential(value);
      expect(credential.kind).toBe("missing");
      expect(credential.basic).toBeNull();
      expect(credential.message).toContain("METEOFRANCE_API_KEY");
    }
  });

  it("accepte un APPLICATION_ID base64 tel quel", () => {
    const credential = inspectMeteoFranceCredential(APPLICATION_ID);
    expect(credential.kind).toBe("application-id");
    expect(credential.basic).toBe(APPLICATION_ID);
  });

  it("encode automatiquement une paire client_id:client_secret écrite en clair", () => {
    const credential = inspectMeteoFranceCredential("my-client-id:my-client-secret");
    expect(credential.kind).toBe("client-secret-pair");
    expect(credential.basic).toBe(APPLICATION_ID);
    expect(credential.message).toContain("base64");
  });

  it("refuse un jeton d’accès JWT avec une cause explicite et sans requête possible", () => {
    const credential = inspectMeteoFranceCredential(JWT);
    expect(credential.kind).toBe("access-token");
    expect(credential.basic).toBeNull();
    expect(credential.message).toContain("jeton d’accès");
  });

  it("refuse le jeton du site ou de l’application mobile", () => {
    const credential = inspectMeteoFranceCredential("__Wj7dVSTjV9YGu1guveLyDq0g7S7TfTjaHBTPTpO0kj8__");
    expect(credential.kind).toBe("mobile-token");
    expect(credential.basic).toBeNull();
    expect(credential.message).toContain("portail-api");
  });

  it("laisse passer une forme inconnue pour ne rien casser par rapport à l’historique", () => {
    const credential = inspectMeteoFranceCredential("synthetic-application-id");
    expect(credential.kind).toBe("unknown");
    expect(credential.basic).toBe("synthetic-application-id");
  });

  it("ne divulgue jamais la valeur dans le message", () => {
    const credential = inspectMeteoFranceCredential(JWT);
    expect(credential.message).not.toContain(JWT);
    expect(credential.message).not.toContain("signature");
  });
});
