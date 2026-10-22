import { describe, expect, it } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { weatherHttpCompression } from "./httpCompression";

describe("lossless weather HTTP compression", () => {
 it("compresses weather JSON and static JS but not auth or scheduler responses", async () => {
  const fixture = { syntheticTest: true, diagnostics: Array.from({length: 300}, () => ({temperature: null, rain: 0, status: "unavailable", source: "synthetic unit test"})) };
  const app = express();
  app.use(weatherHttpCompression);
  for (const path of ["/api/trpc/weather.fixture", "/api/trpc/auth.me", "/api/scheduled/test"]) app.get(path, (_req,res) => res.json(fixture));
  app.get("/assets/test-abcd1234.js", (_req,res) => res.type("application/javascript").send("/* fixture */\n".repeat(500)));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1", resolve));
  try {
   const address = server.address();
   if (!address || typeof address === "string") throw new Error("Fixture port unavailable");
   const base = `http://127.0.0.1:${address.port}`;
   const compressed = await fetch(`${base}/api/trpc/weather.fixture`, {headers:{"accept-encoding":"gzip"}});
   expect(compressed.headers.get("content-encoding")).toBe("gzip");
   expect(await compressed.json()).toEqual(fixture);
   for (const path of ["/api/trpc/auth.me", "/api/scheduled/test"]) {
    const response = await fetch(base+path, {headers:{"accept-encoding":"gzip"}});
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.json()).toEqual(fixture);
   }
   const asset = await fetch(`${base}/assets/test-abcd1234.js`, {headers:{"accept-encoding":"gzip"}});
   expect(asset.headers.get("content-encoding")).toBe("gzip");
  } finally { await new Promise<void>((resolve,reject) => server.close(err => err ? reject(err) : resolve())); }
 });
});
