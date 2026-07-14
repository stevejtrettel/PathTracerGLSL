// Box pixel filter — the reconstruction kernel h(u) is the indicator of the pixel square,
// so a sample is placed uniformly over the footprint (plain sub-pixel jitter).
// Provides: pixel_sample(coord, xi) → continuous film point (pixel units).

vec2 pixel_sample(vec2 coord, vec2 xi) {
    return coord + (xi - 0.5);   // uniform over the unit footprint
}
