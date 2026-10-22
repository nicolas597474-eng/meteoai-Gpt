/**
 * Génération déterministe des icônes PWA (PNG indexé, sans dépendance).
 *
 * Les icônes du manifeste sont produites au moment du build par le plugin
 * Vite vitePluginPwaIcons (vite.config.ts) : aucun binaire n'est versionné
 * dans le dépôt. Le rendu est 100 % déterministe (mêmes octets à chaque
 * build) pour des bundles reproductibles.
 *
 * Format produit : PNG, bit depth 4, color type 3 (palette 16 couleurs),
 * filtre None, compression deflate "stored" sans dépendance zlib.
 */

export const PWA_THEME_COLOR = "#0a1630" as const;

export const PWA_ICON_SIZES = [192, 512] as const;

// Noms de fichiers stables (sans hash) référencés tels quels par le
// manifeste : l'ordre doit rester aligné avec les tests de contrat.
export const PWA_ICON_ENTRIES = [
  { fileName: "assets/icons/icon-192.png", size: 192 },
  { fileName: "assets/icons/icon-512.png", size: 512 },
  { fileName: "assets/icons/icon-maskable-512.png", size: 512 },
] as const;

// Palette : dégradé de fond (0-3), soleil (4-5), nuage (6-7). Les indices
// 8 à 15, exigés par le format PLTE sur 4 bits, reprennent la dernière teinte.
const PALETTE = [
  [10, 22, 48], // 0 - fond, haut
  [13, 28, 58], // 1 - fond
  [17, 37, 70], // 2 - fond
  [22, 46, 86], // 3 - fond, bas
  [247, 201, 72], // 4 - soleil
  [255, 228, 154], // 5 - soleil, reflet
  [244, 247, 251], // 6 - nuage
  [205, 215, 229], // 7 - nuage, ombre portée
] as const;

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[n] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// Compression zlib à blocs deflate "stored" : aucune dépendance, flux
// décodable par tous les décodeurs PNG.
function zlibStore(raw: Uint8Array): Uint8Array {
  const maxBlock = 65535;
  const blockCount = Math.max(1, Math.ceil(raw.length / maxBlock));
  const out = new Uint8Array(2 + raw.length + blockCount * 5 + 4);
  const view = new DataView(out.buffer);
  out[0] = 0x78; // zlib CMF
  out[1] = 0x01; // zlib FLG
  let outPos = 2;
  let rawPos = 0;
  for (let block = 0; block < blockCount; block += 1) {
    const length = Math.min(maxBlock, raw.length - rawPos);
    const isFinal = block === blockCount - 1 ? 1 : 0;
    out[outPos] = isFinal; // BFINAL, BTYPE = 00 (stored)
    view.setUint16(outPos + 1, length, true);
    view.setUint16(outPos + 3, ~length & 0xffff, true);
    out.set(raw.subarray(rawPos, rawPos + length), outPos + 5);
    outPos += 5 + length;
    rawPos += length;
  }
  view.setUint32(outPos, adler32(raw));
  return out;
}

function paletteChunkBytes(): Uint8Array {
  const out = new Uint8Array(48);
  for (let i = 0; i < 16; i += 1) {
    const index = i < PALETTE.length ? i : PALETTE.length - 1;
    out[i * 3] = PALETTE[index][0];
    out[i * 3 + 1] = PALETTE[index][1];
    out[i * 3 + 2] = PALETTE[index][2];
  }
  return out;
}

// Dessin : soleil voilé par un nuage sur un dégradé nocturne. Le motif reste
// dans la zone de sécurité "maskable" (cercle central de 80 % du canevas).
function drawIconPixels(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size);
  const sunX = 0.5 * size;
  const sunY = 0.42 * size;
  const sunR = 0.15 * size;
  const highlightX = 0.46 * size;
  const highlightY = 0.372 * size;
  const highlightR = 0.06 * size;
  const cloudShift = 0.025 * size;
  const circles = [
    { x: 0.375 * size, y: 0.615 * size, r: 0.125 * size },
    { x: 0.625 * size, y: 0.615 * size, r: 0.125 * size },
    { x: 0.5 * size, y: 0.545 * size, r: 0.105 * size },
  ];
  const baseX0 = 0.3 * size;
  const baseX1 = 0.7 * size;
  const baseY0 = 0.615 * size;
  const baseY1 = 0.735 * size;

  const inCloud = (px: number, py: number): boolean => {
    if (px >= baseX0 && px <= baseX1 && py >= baseY0 && py <= baseY1) {
      return true;
    }
    for (const circle of circles) {
      const dx = px - circle.x;
      const dy = py - circle.y;
      if (dx * dx + dy * dy <= circle.r * circle.r) {
        return true;
      }
    }
    return false;
  };

  for (let y = 0; y < size; y += 1) {
    const t = size > 1 ? y / (size - 1) : 0;
    const background = Math.min(3, Math.round(t * 3));
    for (let x = 0; x < size; x += 1) {
      let color = background;
      const sunDx = x - sunX;
      const sunDy = y - sunY;
      if (sunDx * sunDx + sunDy * sunDy <= sunR * sunR) {
        color = 4;
        const hiDx = x - highlightX;
        const hiDy = y - highlightY;
        if (hiDx * hiDx + hiDy * hiDy <= highlightR * highlightR) {
          color = 5;
        }
      }
      if (inCloud(x, y)) {
        color = 7; // ombre portée, position nominale
      }
      if (inCloud(x, y - cloudShift)) {
        color = 6; // nuage, légèrement remonté
      }
      pixels[y * size + x] = color;
    }
  }
  return pixels;
}

function encodePng(pixels: Uint8Array, size: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, size);
  ihdrView.setUint32(4, size);
  ihdr[8] = 4; // bit depth
  ihdr[9] = 3; // color type : palette
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filtre
  ihdr[12] = 0; // interlace

  const bytesPerRow = 1 + size / 2;
  const raw = new Uint8Array(bytesPerRow * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * bytesPerRow;
    raw[row] = 0; // filtre None
    for (let pair = 0; pair < size / 2; pair += 1) {
      const left = pixels[y * size + pair * 2];
      const right = pixels[y * size + pair * 2 + 1];
      raw[row + 1 + pair] = (left << 4) | right;
    }
  }

  const signature = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const parts = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("PLTE", paletteChunkBytes()),
    pngChunk("IDAT", zlibStore(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function generatePwaIconPng(size: number): Uint8Array {
  if (!Number.isInteger(size) || size <= 0 || size % 2 !== 0) {
    throw new Error(
      "Taille d'icône invalide (entier pair strictement positif attendu) : " +
        size,
    );
  }
  return encodePng(drawIconPixels(size), size);
}
