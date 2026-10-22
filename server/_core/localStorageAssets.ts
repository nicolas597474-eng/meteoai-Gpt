import type { Express } from "express";
import { existsSync, readdirSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";

/** Sert les images récupérées sans dépendre du stockage Manus. Les noms
 * historiques sont conservés, même lorsque le contenu réel est du WebP. */
export function registerLocalStorageAssets(app: Express, directory: string) {
  if (!existsSync(directory)) return;
  const types = new Map<string, string>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/.test(entry.name)) continue;
    const fd = openSync(path.join(directory, entry.name), "r");
    const header = Buffer.alloc(12);
    try { readSync(fd, header, 0, header.length, 0); } finally { closeSync(fd); }
    const type = header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WEBP"
      ? "image/webp"
      : header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : header[0] === 255 && header[1] === 216 && header[2] === 255 ? "image/jpeg" : undefined;
    if (type) types.set(entry.name, type);
  }
  app.get("/manus-storage/:name", (req, res, next) => {
    const type = types.get(req.params.name);
    if (!type) return next();
    res.sendFile(req.params.name, {
      root: directory,
      dotfiles: "deny",
      maxAge: "1d",
      headers: { "Content-Type": type, "X-Content-Type-Options": "nosniff" },
    });
  });
}
