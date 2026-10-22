import { describe, expect, it, vi } from "vitest";
import { isAllowedCorsOrigin } from "./security";

describe("environment-specific CORS allowlist", () => {
 it("accepts the exact production domain only", () => {
  expect(isAllowedCorsOrigin("https://meteoai-7i8fkmsr.manus.space", true)).toBe(true);
  expect(isAllowedCorsOrigin("https://arbitrary.manus.space", true)).toBe(false);
  expect(isAllowedCorsOrigin("http://localhost:3000", true)).toBe(false);
 });
 it("allows explicit extra production origins, never wildcards", () => {
  vi.stubEnv("CORS_ALLOWED_ORIGINS", "https://weather.example.org,https://*.example.org");
  try {
   expect(isAllowedCorsOrigin("https://weather.example.org", true)).toBe(true);
   expect(isAllowedCorsOrigin("https://other.example.org", true)).toBe(false);
  } finally { vi.unstubAllEnvs(); }
 });
 it("retains development previews with strict URL parsing", () => {
  expect(isAllowedCorsOrigin("https://3000-preview.manus.computer", false)).toBe(true);
  expect(isAllowedCorsOrigin("http://localhost:3000", false)).toBe(true);
  for (const origin of ["https://evil.manus.computer.attacker.org", "https://user@preview.manus.computer", "https://preview.manus.computer/path", "https://previewXmanusXcomputer"]) {
   expect(isAllowedCorsOrigin(origin, false)).toBe(false);
  }
 });
});
