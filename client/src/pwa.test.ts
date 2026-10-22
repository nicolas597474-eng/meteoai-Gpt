import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {runInNewContext} from 'node:vm';
import { PWA_ICON_ENTRIES, PWA_THEME_COLOR } from "./lib/pwaIcon";

const readRepoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf-8");

describe("PWA : manifeste web", () => {
  const manifest = JSON.parse(readRepoFile("client/public/manifest.webmanifest"));

  it("expose les métadonnées d'installation attendues", () => {
    expect(manifest.short_name).toBe("MeteoAI");
    expect(manifest.lang).toBe("fr");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe(PWA_THEME_COLOR);
    expect(manifest.background_color).toBe(PWA_THEME_COLOR);
  });

  it("référence exactement les icônes générées au build", () => {
    const icons = manifest.icons;
    const sources = icons.map(icon => icon.src).sort();
    const expected = PWA_ICON_ENTRIES.map(entry => "/" + entry.fileName).sort();
    expect(sources).toEqual(expected);
    for (const icon of icons) {
      expect(icon.type).toBe("image/png");
      expect(icon.sizes).toMatch(/^[0-9]+x[0-9]+$/);
    }
  });
});

describe("PWA : câblage applicatif", () => {
  const indexHtml = readRepoFile("client/index.html");
  const mainTsx = readRepoFile("client/src/main.tsx");
  const serviceWorker = readRepoFile("client/public/sw.js");
  const viteConfig = readRepoFile("vite.config.ts");

  it("index.html déclare le manifeste, le thème et les icônes", () => {
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(indexHtml).toContain('<meta name="theme-color" content="' + PWA_THEME_COLOR + '"');
    expect(indexHtml).toContain('href="/assets/icons/icon-192.png"');
    expect(indexHtml).toContain('rel="apple-touch-icon"');
    expect(indexHtml).toContain('lang="fr"');
  });

  it("le service worker n'est enregistré qu'en production", () => {
    expect(mainTsx).toContain("import.meta.env.PROD");
    expect(mainTsx).toContain('navigator.serviceWorker.register("/sw.js")');
  });

  it("le service worker ne met jamais de données météo en cache", () => {
    const listeners:Record<string,(event:any)=>void>={};
    runInNewContext(serviceWorker,{self:{location:{origin:'https://meteo.example'},addEventListener:(name:string,handler:any)=>{listeners[name]=handler;}},URL,Request,Response});
    for(const path of ['/api/weather','/api/me','/__manus__/data','/health']){
      let intercepted=false;
      listeners.fetch({request:new Request('https://meteo.example'+path),respondWith:()=>{intercepted=true;}});
      expect(intercepted).toBe(false);
    }
    expect(serviceWorker).toContain('meteoai-shell-__BUILD_VERSION__');
  });

  it("le plugin Vite génère les icônes au build", () => {
    expect(viteConfig).toContain('from "./client/src/lib/pwaIcon"');
    expect(viteConfig).toContain("vitePluginPwaIcons()");
  });
});
