// Oneshot Accumulator
// No accumulation -- passes current sample directly (for single-frame rendering)

Radiance accumulator_accumulate(Spectrum spectrum, vec2 pixel) {
    return Radiance(spectrum);
}
