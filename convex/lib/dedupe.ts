/**
 * §5 dedupe key — the single source of truth (computed server-side only, so
 * Python scrapers can never drift from it).
 *
 *   vin present            -> VIN, uppercased/trimmed
 *   all components present -> sha1(year|make|model|round(mileage,-3)|zip3)
 *   anything missing       -> "<source>:<sourceListingId>" (cannot cross-source
 *                             dedupe without the components; one row per source
 *                             listing is the honest floor)
 *
 * make/model are lowercased+trimmed inside the hash input so "Chevrolet" from
 * KSL and "chevrolet" from a parsed FB title produce the same key — case
 * normalization serves the formula's intent (same real car ⇒ same key).
 * Mileage rounds to the nearest 1,000 half-up (Math.round), zip3 = first 3
 * digits. Convex's isolate runtime has no crypto.subtle in mutations, hence
 * the self-contained SHA-1 below (vitest-pinned to sha1sum vectors).
 */

export interface DedupeFields {
  vin?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  mileage?: number | null;
  zip?: string | null;
  source: string;
  sourceListingId: string;
}

export function dedupeKeyFor(fields: DedupeFields): string {
  const vin = fields.vin?.trim().toUpperCase();
  if (vin && vin.length >= 11) return vin;

  const { year, make, model, mileage, zip } = fields;
  const zip3 = zip?.trim().slice(0, 3);
  if (year && make && model && mileage && zip3 && zip3.length === 3) {
    const roundedMileage = Math.round(mileage / 1000) * 1000;
    const input = [
      year,
      make.trim().toLowerCase(),
      model.trim().toLowerCase(),
      roundedMileage,
      zip3,
    ].join("|");
    return sha1Hex(input);
  }
  return `${fields.source}:${fields.sourceListingId}`;
}

// ---------------------------------------------------------------- SHA-1
// Standard FIPS 180-1 implementation over UTF-8 bytes. Inputs here are short
// ASCII key strings; correctness is pinned by lib/__tests__/dedupe.test.ts
// against sha1sum-generated vectors.

export function sha1Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLength = bytes.length * 8;

  // pad: 0x80, zeros, 64-bit big-endian length
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const block = new Uint8Array(paddedLength);
  block.set(bytes);
  block[bytes.length] = 0x80;
  const view = new DataView(block.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (n << 1) | (n >>> 31);
    }

    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}
