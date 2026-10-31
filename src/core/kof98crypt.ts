// KOF98 (MVS set "kof98", 242-p1.p1) program encryption.
// The 2MB P1 on the cart is scrambled; the 68k sees a 1MB P1 built from 2-byte words picked out of it
// (same word shuffle as MAME's kof98_decrypt_68k). The shuffle is one-to-one, so edits made on the
// decrypted view can be written back to the exact source words and the dump still works in FBNeo/MAME.

/** CRC32 of the encrypted 242-p1.p1 dump as stored by MAME/FBNeo. */
export const KOF98_P1_CRC = 0x8893df89;

/**
 * The MVS kof98 P1 is 2MB with the plain NEO-GEO header and NGH 0242 at $100 (the header area is not
 * scrambled). The unencrypted AES/home sets (kof98h, kof98n) use a 1MB P1 instead. Edited dumps keep the
 * header, so they are still recognised after their CRC changes.
 */
export function isKof98EncryptedP1(data: Uint8Array, crc: number): boolean {
  if (data.length !== 0x200000) return false;
  if (crc === KOF98_P1_CRC) return true;
  const hdr = String.fromCharCode(...data.subarray(0x100, 0x107));
  return hdr === "NEO-GEO" && data[0x108] === 0x02 && data[0x109] === 0x42;
}

let cached: Int32Array | null = null;

/** For every word of the decrypted 1MB P1, the word index it comes from in the encrypted 2MB file. */
export function kof98WordMap(): Int32Array {
  if (cached) return cached;
  const src = new Int32Array(0x100000); // word indexes of the 2MB working copy
  for (let i = 0; i < src.length; i++) src[i] = i;
  const sec = [0x000000, 0x100000, 0x000004, 0x100004, 0x10000a, 0x00000a, 0x10000e, 0x00000e];
  const pos = [0x000, 0x004, 0x00a, 0x00e];
  // dst is the untouched copy, so dst word n == n
  const cp = (d: number, s: number) => {
    src[d >> 1] = s >> 1;
  };
  for (let i = 0x800; i < 0x100000; i += 0x200) {
    for (let j = 0; j < 0x100; j += 0x10) {
      for (let k = 0; k < 16; k += 2) {
        cp(i + j + k, i + j + sec[k / 2] + 0x100);
        cp(i + j + k + 0x100, i + j + sec[k / 2]);
      }
      if (i >= 0x080000 && i < 0x0c0000) {
        for (const p of pos) {
          cp(i + j + p, i + j + p);
          cp(i + j + p + 0x100, i + j + p + 0x100);
        }
      } else if (i >= 0x0c0000) {
        for (const p of pos) {
          cp(i + j + p, i + j + p + 0x100);
          cp(i + j + p + 0x100, i + j + p);
        }
      }
    }
    cp(i, i);
    cp(i + 2, i + 0x100000);
    cp(i + 0x100, i + 0x100);
    cp(i + 0x102, i + 0x100100);
  }
  cached = src.slice(0, 0x80000);
  return cached;
}

/** On-disk offset (multiple of 4) of 4 bytes of the 2MB file that the decryption never reads, searched from the end. */
export function kof98UnusedSpot(): number {
  const used = new Uint8Array(0x100000);
  for (const w of kof98WordMap()) used[w] = 1;
  for (let w = used.length - 2; w >= 0; w -= 2) if (!used[w] && !used[w + 1]) return w * 2;
  return -1;
}

/** Encrypted 2MB P1 (68k byte order) → decrypted 1MB P1. */
export function kof98Decrypt(raw: Uint8Array): Uint8Array {
  const map = kof98WordMap();
  const out = new Uint8Array(0x100000);
  for (let o = 0; o < map.length; o++) {
    out[o * 2] = raw[map[o] * 2];
    out[o * 2 + 1] = raw[map[o] * 2 + 1];
  }
  return out;
}

/** Write a decrypted 1MB P1 back into a copy of the original encrypted 2MB file. */
export function kof98Encrypt(dec: Uint8Array, rawOrig: Uint8Array): Uint8Array {
  const map = kof98WordMap();
  const out = new Uint8Array(rawOrig);
  for (let o = 0; o < map.length; o++) {
    out[map[o] * 2] = dec[o * 2];
    out[map[o] * 2 + 1] = dec[o * 2 + 1];
  }
  return out;
}
