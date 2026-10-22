import { describe, expect, it } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { mkdtemp, copyFile, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerLocalStorageAssets } from "./localStorageAssets";

describe("images récupérées de Manus", () => {
  it("préserve les octets et annonce le vrai format sous les anciens noms", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "meteoai-images-"));
    const assets = path.resolve(import.meta.dirname, "../../client/public/manus-storage");
    const files = ["meteo3d-sunny_9181afc4.png", "meteoai-realistic-sun-3d-clean_e4a6a1ea.png"];
    for (const file of files) await copyFile(path.join(assets, file), path.join(directory, file));
    await writeFile(path.join(directory, ".private"), "ne pas servir");
    await writeFile(path.join(directory, "invalide.png"), "<!doctype html>Site Unavailable");
    const app = express();
    registerLocalStorageAssets(app, directory);
    app.use((_req, res) => res.sendStatus(404));
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Port local manquant");
      const base = `http://127.0.0.1:${address.port}/manus-storage/`;
      for (const [index, file] of files.entries()) {
        const response = await fetch(base + file);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(index === 0 ? "image/webp" : "image/png");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(Buffer.from(await response.arrayBuffer()).equals(await readFile(path.join(directory, file)))).toBe(true);
      }
      for (const file of ["invalide.png", ".private", "%2e%2e%2f.private", "inconnu.png"]) {
        expect((await fetch(base + file)).status).toBe(404);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true });
    }
  }, 15000);
});
