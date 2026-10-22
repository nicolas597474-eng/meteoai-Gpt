import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("port de production", () => {
  it("écoute directement le port fourni par la plateforme", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).toContain('const port = parseInt(process.env.PORT || "3000")');
    expect(source).toContain("server.listen(port");
    expect(source).not.toContain("findAvailablePort");
    expect(source).not.toContain("isPortAvailable");
  });
});
