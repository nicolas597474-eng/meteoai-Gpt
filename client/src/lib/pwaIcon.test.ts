import { describe, expect, it } from "vitest";
import {
  generatePwaIconPng,
  PWA_ICON_ENTRIES,
  PWA_ICON_SIZES,
  PWA_THEME_COLOR,
} from "./pwaIcon";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readU32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function findChunk(png: Uint8Array, type: string): Uint8Array {
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = readU32be(png, offset);
    const chunkType = String.fromCharCode(
      png[offset + 4],
      png[offset + 5],
      png[offset + 6],
      png[offset + 7],
    );
    if (chunkType === type) {
      return png.slice(offset + 8, offset + 8 + length);
    }
    offset += 12 + length;
  }
  throw new Error("Chunk PNG introuvable : " + type);
}

// Décode les blocs deflate "stored" produits par le générateur.
function inflateStored(zlib: Uint8Array): { raw: Uint8Array; adler: number } {
  const blocks: Uint8Array[] = [];
  let position = 2;
  let finalBlock = false;
  while (!finalBlock) {
    const header = zlib[position];
    expect((header >> 1) & 3).toBe(0);
    finalBlock = (header & 1) === 1;
    const length = zlib[position + 1] | (zlib[position + 2] << 8);
    const complement = zlib[position + 3] | (zlib[position + 4] << 8);
    expect(~length & 0xffff).toBe(complement);
    blocks.push(zlib.slice(position + 5, position + 5 + length));
    position += 5 + length;
  }
  const adler = readU32be(zlib, position);
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const raw = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    raw.set(block, offset);
    offset += block.length;
  }
  return { raw, adler };
}

function computeAdler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return b * 65536 + a;
}

describe("generatePwaIconPng", () => {
  it("produit un PNG signature + IHDR palette 4 bits", () => {
    const png = generatePwaIconPng(192);
    expect(Array.from(png.slice(0, 8))).toEqual(PNG_SIGNATURE);
    const ihdr = findChunk(png, "IHDR");
    expect(ihdr.length).toBe(13);
    expect(readU32be(ihdr, 0)).toBe(192);
    expect(readU32be(ihdr, 4)).toBe(192);
    expect(ihdr[8]).toBe(4);
    expect(ihdr[9]).toBe(3);
    expect(ihdr[12]).toBe(0);
  });

  it("embarque une palette complète de 16 couleurs", () => {
    const png = generatePwaIconPng(192);
    expect(findChunk(png, "PLTE").length).toBe(48);
  });

  it("produit des scanlines filtre None protégées par Adler-32", () => {
    const size = 192;
    const png = generatePwaIconPng(size);
    const idat = findChunk(png, "IDAT");
    expect(idat[0]).toBe(0x78);
    const { raw, adler } = inflateStored(idat);
    const rowLength = 1 + size / 2;
    expect(raw.length).toBe(rowLength * size);
    expect(computeAdler32(raw)).toBe(adler);
    for (let y = 0; y < size; y += 1) {
      expect(raw[y * rowLength]).toBe(0);
    }
  });

  it("dessine le motif attendu (fond, soleil, nuage)", () => {
    const size = 192;
    const png = generatePwaIconPng(size);
    const { raw } = inflateStored(findChunk(png, "IDAT"));
    const rowLength = 1 + size / 2;
    const pixel = (x: number, y: number): number => {
      const byte = raw[y * rowLength + 1 + (x >> 1)];
      return x % 2 === 0 ? byte >> 4 : byte & 0x0f;
    };
    expect(pixel(4, 4)).toBe(0);
    expect(pixel(96, 60)).toBe(4);
    expect(pixel(96, 96)).toBe(6);
    expect(pixel(4, 188)).toBe(3);
  });

  it("est déterministe : deux exécutions produisent les mêmes octets", () => {
    const first = generatePwaIconPng(192);
    const second = generatePwaIconPng(192);
    expect(first.length).toBe(second.length);
    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it("rejette les tailles invalides", () => {
    expect(() => generatePwaIconPng(193)).toThrow();
    expect(() => generatePwaIconPng(0)).toThrow();
    expect(() => generatePwaIconPng(-64)).toThrow();
  });

  it("expose les tailles et entrées attendues par le manifeste", () => {
    expect(PWA_ICON_SIZES).toContain(192);
    expect(PWA_ICON_SIZES).toContain(512);
    expect(PWA_ICON_ENTRIES.map(entry => entry.size)).toEqual([192, 512, 512]);
    expect(PWA_THEME_COLOR).toMatch(/^#[0-9a-f]{6}$/);
  });
});
