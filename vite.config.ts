import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, writeFileSync } from 'node:fs';
export default defineConfig({ plugins: [react(), tailwindcss(), {
  name:'meteoai-precache',
  writeBundle(_options,bundle){
    const assets=Object.keys(bundle).filter(name=>/\.(js|css|woff2?)$/.test(name)).map(name=>`/${name}`);
    const sw=new URL('./dist/sw.js',import.meta.url);
    const source=readFileSync(sw,'utf8').replace('const BUILD_ASSETS = [];',`const BUILD_ASSETS = ${JSON.stringify(assets)};`);
    writeFileSync(sw,source);
  },
}], server: { host: '127.0.0.1', port: 5173 } });
