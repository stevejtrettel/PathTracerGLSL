# Gaussian pixel filter: what it computes and why

The pixel's footprint kernel is the isotropic normal density

```
h(u) = exp(−|u|² / 2σ²) / (2πσ²),   σ = 0.5 px,
```

centered on the pixel center, untruncated. σ = 0.5 px is the default of both pbrt-v4 and
Mitsuba 3. Neighboring pixels' kernels overlap, which removes the hard, aliased look of the box
filter's edges at the cost of a slight blur.

**Sampling.** `pixel_sample` draws the offset exactly from h by Box–Muller:
`r = σ √(−2 ln(1 − ξ₀))`, `φ = 2π ξ₁`, offset `r (cos φ, sin φ)`, transcribed from pbrt-v4
`SampleTwoNormal` (util/sampling.h). Because the sample's density is h itself, every sample has
weight 1: the plain average the accumulator keeps is an unbiased estimate of
`∫ h(u) L(camera(c + u)) du`. Nothing is splatted into neighboring pixels. The variance
statistic, the first-hit guides and tiled renders work unchanged, since each pixel still draws
its own samples from its own stream.

**Truncation.** None is declared. The only cutoff is numerical: `random()` returns values below
1 on a 2⁻²⁴ grid, so `1 − ξ₀ ≥ 2⁻²⁴` and the largest offset is `σ √(48 ln 2) ≈ 2.884 px`. The
mass of h beyond that radius is `2⁻²⁴ ≈ 6·10⁻⁸`. pbrt-v4 instead truncates the kernel to a
1.5 px square, subtracts the edge value and samples a table (its sample weights are then not
1); Mitsuba cuts off at 4σ with the edge value subtracted. The untruncated kernel needs neither
a table nor a cutoff constant.

**Border pixels.** The film point may fall outside the image. Every camera maps such a point
to a valid ray (the projections extend past the frame; fisheye clamps), so no special case is
needed.

The sample is two-dimensional and wavelength-free, so RGB and spectral programs use the same
code. `tests/components/pixelFilters.test.ts` is the TypeScript twin, with a χ² test of the
warp's density against products of Φ; the `filter-edge` witness checks the kernel's
x-marginal on the GPU.
