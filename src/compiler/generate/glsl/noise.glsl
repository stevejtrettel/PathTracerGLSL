// noise.glsl — shared noise primitive (compiler-owned, non-swappable).
// Accessor for the global blue-noise tile bound as `u_blueNoise` (a 64x64 RGB8, REPEAT-
// wrapped void-and-cluster tile — see tools/gen-bluenoise.mjs). Returns three INDEPENDENT
// blue-noise values (one per color channel), each spectrally blue (energy at high
// frequencies, a hole near DC) and mutually decorrelated, so RGB dither doesn't correlate
// the channels' quantization error. Consumed by the display dither (view). (Parks to
// src/glsl/shared/ with the layout reorg — see docs/impl-plan-glsl-layout.md.)

vec3 blue_noise(vec2 fragCoord) {
    return texture(u_blueNoise, fragCoord * (1.0 / 64.0)).rgb;   // 64 = BLUE_NOISE_SIZE (gen-bluenoise.mjs)
}
