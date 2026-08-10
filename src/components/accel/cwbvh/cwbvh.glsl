// accel/cwbvh/cwbvh.glsl — scalar helpers for the compressed wide BVH walk
// (fable-accel-cwbvh §5 — the GLSL ES 3.00 strength reductions of the paper's PTX
// intrinsics; the TS blueprint is cwbvh.ts cwbvhNearestRef, pinned by the round-trip
// vitest). Included iff a cwbvh traversal occupant is selected (exact linkage).

// popcount over ≤ 8 bits (no bitCount in ES 3.00) — SWAR reduction.
uint cwbvh_popc8(uint v) {
    v = v - ((v >> 1) & 0x55u);
    v = (v & 0x33u) + ((v >> 2) & 0x33u);
    return (v + (v >> 4)) & 0x0Fu;
}

// find-MSB via the float exponent (no findMSB in ES 3.00) — exact for v < 2^24,
// which covers both fields it serves: the 8-bit child-hits mask and the ≤24-bit
// leaf-item mask (the node's meta encoding caps offset+count at 24).
int cwbvh_findMSB24(uint v) {
    return int(floatBitsToUint(float(v)) >> 23) - 127;
}
