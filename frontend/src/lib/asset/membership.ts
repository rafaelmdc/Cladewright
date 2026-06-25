// Client reader for the binary-fuse8 membership filter built by the backend
// (apps/gamedata/membership.py). It MUST query byte-identically: same FNV-1a/64 reduction
// of the normalized key to a 64-bit key, same murmur mix with the stored seed, same
// segment subhashes, same fingerprint XOR, same little-endian header. A "no" is definitive
// (the name can't be in the scope → reject locally, no network); a "yes" is "probably" →
// fall through to the remote tail. No false negatives. Construction lives only in Python.

export interface FuseFilter {
  seed: bigint;
  segLen: number;
  segMask: number;
  segCountLen: number;
  fps: Uint8Array;
}

const MASK64 = (1n << 64n) - 1n;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function fnv1a64(s: string): bigint {
  const bytes = new TextEncoder().encode(s);
  let h = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) h = ((h ^ BigInt(bytes[i])) * FNV_PRIME) & MASK64;
  return h;
}

function murmur64(h: bigint): bigint {
  h &= MASK64;
  h ^= h >> 33n;
  h = (h * 0xff51afd7ed558ccdn) & MASK64;
  h ^= h >> 33n;
  h = (h * 0xc4ceb9fe1a85ec53n) & MASK64;
  h ^= h >> 33n;
  return h;
}

/** Parse the serialized filter header + fingerprint bytes. */
export function parseFilter(buf: ArrayBuffer): FuseFilter {
  const dv = new DataView(buf);
  return {
    seed: dv.getBigUint64(0, true),
    segLen: dv.getUint32(8, true),
    segMask: dv.getUint32(12, true),
    segCountLen: dv.getUint32(16, true),
    fps: new Uint8Array(buf, 24),
  };
}

/** True if `key` (already normalized) MIGHT be in the scope; false = definitely absent. */
export function mightContain(f: FuseFilter, key: string): boolean {
  const h = murmur64((fnv1a64(key) + f.seed) & MASK64);
  const fp = Number((h ^ (h >> 32n)) & 0xffn);
  const hi = (h * BigInt(f.segCountLen)) >> 64n;
  const h0 = Number(hi & 0xffffffffn);
  // segLen ≤ 2^18 and array_length ≪ 2^31 for any real scope, so these stay safe 32-bit ints.
  const h1 = (h0 + f.segLen) ^ Number((h >> 18n) & BigInt(f.segMask));
  const h2 = (h0 + 2 * f.segLen) ^ Number(h & BigInt(f.segMask));
  return (fp ^ f.fps[h0] ^ f.fps[h1] ^ f.fps[h2]) === 0;
}
