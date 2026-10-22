import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./Dashboard.tsx", import.meta.url),
  "utf8"
);

describe("connexion depuis le mode aperçu du Dashboard", () => {
  it("expose le constructeur OAuth existant aux utilisateurs non connectés", () => {
    const previewStart = source.indexOf("{!authLoading && !user && (");
    const favoritesStart = source.indexOf(
      "{/* ── Favorites Bar ── */}",
      previewStart
    );
    const previewBlock = source.slice(previewStart, favoritesStart);

    expect(previewStart).toBeGreaterThanOrEqual(0);
    expect(favoritesStart).toBeGreaterThan(previewStart);
    expect(previewBlock).toContain("href={getLoginUrl()}");
    expect(previewBlock).toContain("Se connecter");
    expect(previewBlock).not.toContain("/app-auth");
  });
});
