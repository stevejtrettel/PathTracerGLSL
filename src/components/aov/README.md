# aov/ — first-hit pictures (denoiser guides)

**Taxonomy:** **measurement** — each AOV is another functional of the same camera rays and
pixel filter as the main picture. **Kind:** pick-many. `measurement.aovs: ['albedo', 'normal']`
lists them (each at most once; RGB only).

Occupants: `albedo/` (the material's albedo fact, clamped to [0, 1]) and `normal/` (the
shading normal, faced toward the arriving ray).

## What a sample is

At the first non-null surface the path reaches while it has had no scattering event
(`bounce == 0` in the walk, after the medium segment in front of it), the sample is

    g(surface) × w

where `w` is the path's throughput on arrival (the channel average of it for the normal).
Otherwise the sample is 0: a miss, a first medium scattering event, a GRIN traversal,
absorption, GRIN no-return, or exceeding `maxNullCrossings` before any surface.

Every medium arm's arrival weight is an unbiased estimate of the transmittance T along the
camera ray (the property radiance relies on), so the averaged picture is g ⊙ T, the same under
every estimator. A path a medium terminated arrives with weight 0, so it needs no flag. With
no medium in front, w = 1 exactly and the picture is the plain first-hit guide. Up to the
arms' numerical safeguards (pdf floors of 1e-20, the tracking cap) shared with radiance;
derivation and evidence in docs/claude-outputs-step6-plan.md §1.

A single sample can exceed 1 where an arm's weight does (the analytic arm's `tr/pdf`); the
average converges to at most 1. The saved `.hdr` holds the unclamped average; the `'unit'`
view clamps for display.

## The contract

- `<name>/<name>.glsl` defines
  `vec3 <name>_aov(int mat, Hit hit, Direction wo, MaterialProperties props, Spectrum weight)`.
  It draws no random numbers and changes nothing.
- `<name>/<name>.ts` declares the picture (export name, fragment output, previous and display
  samplers, view mapping, file formats) and the seams the function calls (`requires`).
- One line in `index.ts`.

The walk captures every listed AOV at one site and returns them through `out` parameters of
`transport_trace`, which exist only in programs that list AOVs. The accumulation `main()`
updates each AOV's picture with the mode's rule. The compiler links the GLSL in
`generate/features/aov.ts`.
