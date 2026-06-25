"""A binary-fuse8 membership filter over a scope's full set of valid name keys.

Huge-scope clients hold only the notable blob's alias index locally; a typed name that
misses it would otherwise fire /search + /resolve — wasteful for the typos and
out-of-scope names that dominate a guessing game. This filter answers "could this name
exist in the scope?" locally: a **no is definitive** (reject, zero network), a yes is
"probably" (fall through to the remote tail). No false negatives, so a real tail species
is never wrongly rejected; the only error is a rare (~0.39%) false positive — one wasted
lookup.

Binary-fuse8 (Graf & Lemire 2022): ~9 bits/key at ~0.39% FP — smaller and more accurate
than a Bloom filter. The construction (3-wise peeling) lives here; the **query** is a tiny
fingerprint XOR that the browser reproduces byte-identically (frontend
lib/asset/membership.ts), reading the same serialized layout. Each string key is reduced
to a 64-bit key via FNV-1a/64 over its UTF-8 (deterministic, language-agnostic).

Wire format (little-endian): ``<u64 seed><u32 segment_length><u32 segment_length_mask>
<u32 segment_count_length><u32 array_length>`` then ``array_length`` fingerprint bytes.
"""
from __future__ import annotations

import math
import struct
from typing import Iterable

_MASK64 = 0xFFFFFFFFFFFFFFFF
_FNV_OFFSET = 0xCBF29CE484222325
_FNV_PRIME = 0x100000001B3
_INITIAL_SEED = 0x726B2B9D438B9D4D


def fnv1a64(data: bytes) -> int:
    h = _FNV_OFFSET
    for b in data:
        h = ((h ^ b) * _FNV_PRIME) & _MASK64
    return h


def _murmur64(h: int) -> int:
    h &= _MASK64
    h ^= h >> 33
    h = (h * 0xFF51AFD7ED558CCD) & _MASK64
    h ^= h >> 33
    h = (h * 0xC4CEB9FE1A85EC53) & _MASK64
    h ^= h >> 33
    return h


def _mix(key: int, seed: int) -> int:
    return _murmur64((key + seed) & _MASK64)


def _fingerprint(h: int) -> int:
    return (h ^ (h >> 32)) & 0xFF


def _geometry(size: int) -> tuple[int, int, int, int]:
    """(segment_length, segment_length_mask, segment_count_length, array_length) for n keys."""
    arity = 3
    if size == 0:
        segment_length = 4
    else:
        segment_length = 1 << int(math.floor(math.log(size) / math.log(3.33) + 2.25))
    segment_length = min(segment_length, 1 << 18)
    size_factor = max(1.125, 0.875 + 0.25 * math.log(1_000_000.0) / math.log(max(size, 2)))
    capacity = int(round(size * size_factor))
    init_segment_count = max((capacity + segment_length - 1) // segment_length - (arity - 1), 1)
    array_length = (init_segment_count + arity - 1) * segment_length
    segment_count = (array_length + segment_length - 1) // segment_length
    segment_count = 1 if segment_count <= arity - 1 else segment_count - (arity - 1)
    array_length = (segment_count + arity - 1) * segment_length
    segment_count_length = segment_count * segment_length
    return segment_length, segment_length - 1, segment_count_length, array_length


def _subhashes(h: int, seg_len: int, seg_mask: int, seg_count_len: int) -> tuple[int, int, int]:
    hi = (h * seg_count_len) >> 64
    h0 = hi & 0xFFFFFFFF
    h1 = h0 + seg_len
    h2 = h1 + seg_len
    h1 ^= (h >> 18) & seg_mask
    h2 ^= h & seg_mask
    return h0, h1, h2


def build_filter(keys: Iterable[str], **_ignore) -> bytes:
    """Serialize a binary-fuse8 filter over ``keys`` (already-normalized alias keys)."""
    hashes = sorted({fnv1a64(k.encode("utf-8")) for k in keys if k})
    size = len(hashes)
    seg_len, seg_mask, seg_count_len, array_length = _geometry(size)

    block_bits = 1
    while (1 << block_bits) < (array_length // seg_len):
        block_bits += 1
    block = 1 << block_bits

    reverse_order = [0] * (size + 1)
    reverse_order[size] = 1  # sentinel so the placement scan can't run off the end
    reverse_h = bytearray(size)
    t2count = bytearray(array_length)
    t2hash = [0] * array_length
    alone = [0] * array_length
    start_pos = [0] * block

    seed = _INITIAL_SEED
    for _ in range(100):
        for i in range(block):
            start_pos[i] = (i * size) >> block_bits
        for i in range(size):
            reverse_order[i] = 0
        for key in hashes:
            h = _mix(key, seed)
            seg = h >> (64 - block_bits)
            while reverse_order[start_pos[seg]] != 0:
                seg = (seg + 1) & (block - 1)
            reverse_order[start_pos[seg]] = h
            start_pos[seg] += 1

        for i in range(array_length):
            t2count[i] = 0
            t2hash[i] = 0
        for i in range(size):
            h = reverse_order[i]
            h0, h1, h2 = _subhashes(h, seg_len, seg_mask, seg_count_len)
            t2count[h0] = (t2count[h0] + 4) & 0xFF
            t2hash[h0] ^= h
            t2count[h1] = (t2count[h1] + 4) & 0xFF
            t2count[h1] ^= 1
            t2hash[h1] ^= h
            t2count[h2] = (t2count[h2] + 4) & 0xFF
            t2count[h2] ^= 2
            t2hash[h2] ^= h

        queue = 0
        for i in range(array_length):
            alone[queue] = i
            if (t2count[i] >> 2) == 1:
                queue += 1
        stack = 0
        while queue > 0:
            queue -= 1
            index = alone[queue]
            if (t2count[index] >> 2) != 1:
                continue
            h = t2hash[index]
            found = t2count[index] & 3
            reverse_h[stack] = found
            reverse_order[stack] = h
            stack += 1
            slots = _subhashes(h, seg_len, seg_mask, seg_count_len)
            for j, slot in enumerate(slots):
                if j == found:
                    continue
                t2count[slot] = (t2count[slot] - 4) & 0xFF
                t2count[slot] ^= j
                t2hash[slot] ^= h
                if (t2count[slot] >> 2) == 1:
                    alone[queue] = slot
                    queue += 1
        if stack == size:
            break
        seed = _murmur64(seed)
    else:
        raise RuntimeError("binary-fuse8 construction failed after 100 seeds")

    fingerprints = bytearray(array_length)
    for i in range(size - 1, -1, -1):
        h = reverse_order[i]
        found = reverse_h[i]
        slots = _subhashes(h, seg_len, seg_mask, seg_count_len)
        fp = _fingerprint(h)
        for j, slot in enumerate(slots):
            if j == found:
                continue
            fp ^= fingerprints[slot]
        fingerprints[slots[found]] = fp & 0xFF

    header = struct.pack("<QIIII", seed, seg_len, seg_mask, seg_count_len, array_length)
    return header + bytes(fingerprints)


def filter_contains(blob: bytes, key: str) -> bool:
    """Query a serialized filter — the reference the TS reader must match exactly."""
    seed, seg_len, seg_mask, seg_count_len, _array_length = struct.unpack("<QIIII", blob[:24])
    fingerprints = blob[24:]
    h = _mix(fnv1a64(key.encode("utf-8")), seed)
    f = _fingerprint(h)
    h0, h1, h2 = _subhashes(h, seg_len, seg_mask, seg_count_len)
    return (f ^ fingerprints[h0] ^ fingerprints[h1] ^ fingerprints[h2]) == 0
