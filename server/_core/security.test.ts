import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import {PublicGeography} from '../../client/src/lib/publicGeography';
import {
  CONTENT_SECURITY_POLICY,
  GEOCODING_API_ORIGIN,
  PERMISSIONS_POLICY,
  WINDY_EMBED_ORIGIN,
  securityHeaders,
} from "./security";

const CLIENT_SRC = fileURLToPath(new URL("../../client/src/", import.meta.url));

function directive(policy: string, name: string): string[] {
  const entry = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.split(/\s+/)[0] === name);
  return entry ? entry.split(/\s+/).slice(1) : [];
}

function clientSourceFiles(dir = CLIENT_SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return clientSourceFiles(fullPath);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [fullPath] : [];
  });
}

/** Origines HTTP(S) littérales passées à fetch() dans le code navigateur. */
function browserFetchOrigins(): Map<string, string[]> {
  const origins = new Map<string, string[]>();
  for (const file of clientSourceFiles()) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bfetch\(\s*[`'"](https?:\/\/[^/`'"?#\s$]+)/g)) {
      const files = origins.get(match[1]) ?? [];
      files.push(path.relative(CLIENT_SRC, file));
      origins.set(match[1], files);
    }
  }
  return origins;
}

describe("politique de sécurité du navigateur (CSP)", () => {
  it("autorise la recherche de ville Open-Meteo, sinon l'ajout d'un lieu affiche « Erreur réseau »", () => {
    const connectSrc = directive(CONTENT_SECURITY_POLICY, "connect-src");

    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain(GEOCODING_API_ORIGIN);
  });

  it("garde connect-src limité à des origines nommées", () => {
    const connectSrc = directive(CONTENT_SECURITY_POLICY, "connect-src");

    expect(connectSrc).not.toContain("*");
    expect(connectSrc).not.toContain("https:");
    expect(connectSrc).not.toContain("http:");
  });

  it("autorise les origines fetch littérales et la recherche de ville partagée", async () => {
    const origins = browserFetchOrigins();
    const connectSrc = directive(CONTENT_SECURITY_POLICY, "connect-src");

    // The search now uses an injectable shared transport, not a literal fetch(url).
    // Exercise its real URL builder; the mock observes the destination without networking.
    const geography=new PublicGeography({fetcher:async(input)=>{
      const origin=new URL(String(input)).origin;
      origins.set(origin,[...(origins.get(origin)??[]),'lib/publicGeography.ts']);
      return globalThis.Response.json({results:[]});
    }});
    await geography.search('Lille');

    // Garde-fou : le balayage doit retrouver les appels de géocodage connus.
    expect(origins.has(GEOCODING_API_ORIGIN)).toBe(true);

    const blocked = [...origins].filter(([origin]) => !connectSrc.includes(origin));
    expect(
      blocked,
      `Origines appelées par le navigateur mais absentes de connect-src (server/_core/security.ts) : ${blocked
        .map(([origin, files]) => `${origin} (${files.join(", ")})`)
        .join("; ")}`
    ).toEqual([]);
  });

  it("autorise l'iframe Windy de la carte météo sans ouvrir les autres cadres", () => {
    const windySource = readFileSync(path.join(CLIENT_SRC, "components/WindyMap.tsx"), "utf8");
    const frameSrc = directive(CONTENT_SECURITY_POLICY, "frame-src");

    expect(windySource).toContain(`${WINDY_EMBED_ORIGIN}/embed2.html`);
    expect(frameSrc).toEqual(["'self'", WINDY_EMBED_ORIGIN]);
  });

  it("continue d'interdire l'intégration de l'application dans un cadre tiers", () => {
    expect(directive(CONTENT_SECURITY_POLICY, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(CONTENT_SECURITY_POLICY, "default-src")).toEqual(["'self'"]);
  });
});

describe("Permissions-Policy", () => {
  it("autorise la géolocalisation utilisée par « Utiliser ma position actuelle » et l'embed Windy", () => {
    expect(PERMISSIONS_POLICY).toContain(`geolocation=(self "${WINDY_EMBED_ORIGIN}")`);
    expect(PERMISSIONS_POLICY).not.toContain("geolocation=()");
  });

  it("garde le micro et la caméra désactivés", () => {
    expect(PERMISSIONS_POLICY).toContain("microphone=()");
    expect(PERMISSIONS_POLICY).toContain("camera=()");
  });
});

describe("middleware securityHeaders", () => {
  it("applique la CSP et la Permissions-Policy puis poursuit la requête", () => {
    const headers = new Map<string, string>();
    const response = {
      setHeader: (name: string, value: string) => void headers.set(name.toLowerCase(), value),
      removeHeader: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    securityHeaders({} as Request, response, next);

    expect(headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(headers.get("permissions-policy")).toBe(PERMISSIONS_POLICY);
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(next).toHaveBeenCalledTimes(1);
  });
});

// Test ajouté par la PR #126 (correctif minimal du géocodage), conservé tel quel :
// il fixe aussi l'ordre de l'origine dans connect-src.
describe("securityHeaders", () => {
  it("autorise l’API de géocodage utilisée par la recherche de villes", () => {
    const headers = new Map<string, string>();
    const response = {
      setHeader: vi.fn((name: string, value: string) => {
        headers.set(name, value);
      }),
      removeHeader: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    securityHeaders({} as Request, response, next);

    expect(headers.get("Content-Security-Policy")).toContain(
      "connect-src 'self' https://geocoding-api.open-meteo.com"
    );
    expect(next).toHaveBeenCalledOnce();
  });
});
