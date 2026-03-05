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
    return float(rng_u32()) / 4294967295.0;
}

vec2 random2() {
    return vec2(random(), random());
}
