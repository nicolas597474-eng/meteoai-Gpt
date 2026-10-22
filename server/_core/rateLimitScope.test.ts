import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRateLimitedApiPath } from "./security";
describe("API rate-limit scope", () => {
 it("preserves rate limiting for tRPC, OAuth and scheduler callbacks", () => {
  for (const path of ["/api", "/api/trpc/weather.getDashboard", "/api/netatmo/callback", "/api/scheduled/collect-observations"]) expect(isRateLimitedApiPath(path)).toBe(true);
 });
 it("does not let static modules, CSS or health checks exhaust the API quota", () => {
  for (const path of ["/", "/details", "/health", "/api/health", "/src/pages/Dashboard.tsx", "/src/components/HourlyChart.tsx", "/assets/index-Abc12345.js", "/@vite/client", "/@fs/node_modules/react.js"]) expect(isRateLimitedApiPath(path)).toBe(false);
 });
 it("is actually applied by the server before calling the limiter", () => {
  expect(readFileSync(new URL("./index.ts", import.meta.url), "utf8")).toContain("if (!isRateLimitedApiPath(req.path))");
 });
});
