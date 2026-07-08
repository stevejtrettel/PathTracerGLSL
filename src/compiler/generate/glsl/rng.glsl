// RNG — counter-based pcg hash, dimension-indexed (contracts §2.11)
// Provides: rng_init(), random(), random2()
//
// Counter-based (not stateful) so the sample stream is an addressable field,
// keeping the §2.9 stratification/QMC door a drop-in: rng_dim is the dimension
// index; a later QMC swap replaces pcg4d(base, dim) with sobol(sampleIndex, dim).

uint rng_base;   // per (pixel, sample, reset) seed
uint rng_dim;    // dimension / draw index

// Jarzynski–Olano "Hash Functions for GPU Rendering" — pcg4d
uvec4 pcg4d(uvec4 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
    v ^= v >> 16u;
    v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
    return v;
}

// Seed on two independent axes: sampleCount (within a converging render) and
// resetSalt (bumped per accumulation reset — kills replay + frozen-motion noise).
void rng_init(uvec2 pixel, uint sampleCount, uint resetSalt) {
    rng_base = pcg4d(uvec4(pixel, sampleCount, resetSalt)).x;
    rng_dim = 0u;
}

uint rng_u32() {
    return pcg4d(uvec4(rng_base, rng_dim++, 0u, 0u)).x;
}

// Top 24 bits scaled by 2^-24: exactly representable, guaranteed in [0, 1).
// (Dividing the full u32 by 2^32-1 rounds values near the top UP to >= 1.0,
// which NaN-poisons sqrt(1-xi) in cosine sampling and overruns CDF selection.)
float random() {
    return float(rng_u32() >> 8) * (1.0 / 16777216.0);
}

vec2 random2() {
    return vec2(random(), random());
}
