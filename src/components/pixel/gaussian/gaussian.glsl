// Gaussian pixel filter: the kernel h(u) is the isotropic normal density with standard
// deviation PIXEL_GAUSSIAN_SIGMA pixels, untruncated. The sample is drawn exactly from h by
// Box–Muller (pbrt-v4 SampleTwoNormal), so every sample has weight 1 and the plain average is
// the h-weighted pixel value. random() is below 1 on a 2⁻²⁴ grid, so 1 − xi.x ≥ 2⁻²⁴ and the
// largest offset is σ·√(48 ln 2) ≈ 2.884 px (tail mass 6·10⁻⁸ beyond it).
// Provides: pixel_sample(coord, xi) → continuous film point (pixel units).

#define PIXEL_GAUSSIAN_SIGMA 0.5

vec2 pixel_sample(vec2 coord, vec2 xi) {
    float r = PIXEL_GAUSSIAN_SIGMA * sqrt(-2.0 * log(1.0 - xi.x));
    float phi = TWO_PI * xi.y;
    return coord + r * vec2(cos(phi), sin(phi));
}
