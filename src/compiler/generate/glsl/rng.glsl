// RNG utilities
// Provides: rng_seed, rng_counter, hash_init(), random(), random2()

uint rng_seed;
uint rng_counter;

uint mix32(uint x) {
    x ^= x >> 16;
    x *= 0x45d9f3bu;
    x ^= x >> 16;
    x *= 0x45d9f3bu;
    x ^= x >> 16;
    return x;
}

void hash_init(uvec2 pixel, uint frame) {
    rng_seed = mix32(pixel.x + mix32(pixel.y + mix32(frame)));
    rng_counter = 0u;
}

uint rng_u32() {
    rng_counter++;
    return mix32(rng_seed + rng_counter);
}

float random() {
    // Top 24 bits scaled by 2^-24: exactly representable, guaranteed in [0, 1).
    // (Dividing the full u32 by 2^32-1 rounds values near the top UP to >= 1.0,
    // which NaN-poisons sqrt(1-xi) in cosine sampling and overruns CDF selection.)
    return float(rng_u32() >> 8) * (1.0 / 16777216.0);
}

vec2 random2() {
    return vec2(random(), random());
}
