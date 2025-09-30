// --- Per-fragment "seed" and "counter" ---
uint rng_seed;     // unique per pixel/frame
uint rng_counter;  // increments per variate

// Stronger 32-bit mix (SplitMix32-style, Murmur-ish)
uint mix32(uint z) {
    z ^= z >> 16;
    z *= 0x7feb352dU;
    z ^= z >> 15;
    z *= 0x846ca68bU;
    z ^= z >> 16;
    return z;
}

// Hash a 2D pixel + frame into one 32-bit seed
uint hash_init(uvec2 pixel, uint frame) {
    // FNV-1a-ish with final mix
    uint h = 2166136261U;
    h = (h ^ pixel.x) * 16777619U;
    h = (h ^ pixel.y) * 16777619U;
    h = (h ^ frame   ) * 16777619U;
    return mix32(h | 1U); // avoid zero, force odd
}

// Stateless counter → random uint
uint rng_u32() {
    // Weyl progression to avoid low-bit issues
    uint x = rng_seed + rng_counter * 0x9E3779B9U; // 2^32 * golden ratio
    rng_counter++;
    return mix32(x);
}

// [0,1) float
float random() {
    return float(rng_u32()) * (1.0 / 4294967296.0); // 2^-32
}

// Two decorrelated variates (uses counter and counter+1)
vec2 random2() {
    uint a = rng_u32();
    uint b = rng_u32();
    return vec2(float(a), float(b)) * (1.0 / 4294967296.0);
}

// Optional: three at once
vec3 random3() {
    uint a = rng_u32();
    uint b = rng_u32();
    uint c = rng_u32();
    return vec3(float(a), float(b), float(c)) * (1.0 / 4294967296.0);
}
