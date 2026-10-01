# Step 4: a generated accumulation `main()` (outputs and accumulation plan)

**Date:** 2026-09-30
**Status:** Built 2026-09-30. Every prediction held; the results are in the CHANGELOG.
Part of `claude-outputs-accumulation.md` §2 and §9. Baselines at commit `d6e4b0e`:
`.digest/step3-commit-frames`, and `.digest/step3c.json` with `.digest/step3c-keep`.

## Why

There are three hand-written mains: `average/average.glsl`, `variance/variance.glsl` and
`oneshot/oneshot.glsl`. They repeat the same camera setup: the seed, the pixel jitter, the
lens sample, the wavelengths, the camera ray, the trace and the color conversion (read:
the three are identical from `vec2 pixel = …` through `vec3 color = color_to_pixel(…)`).
They differ only in how the new sample is folded into each picture.

Step 6 adds pictures (albedo and normal). Each would need another hand-written variant of
the same setup. The rule is "math is static GLSL; policy and plumbing are generated". So
the setup and the per-picture writes become generated, and each fold becomes a small
static function in its mode's folder.

## The change

**Static rules,** one function per folder. Each replaces that folder's `main()`, and the
arithmetic is today's, operation for operation.

| File | Function | Body |
|---|---|---|
| `average/average.glsl` | `vec3 average_update(vec3 previous, vec3 x, int n)` | `n == 0` → `x`; otherwise `mix(previous, x, 1.0 / (float(n) + 1.0))` |
| `variance/variance.glsl` | `vec3 variance_update(vec3 previous, vec3 mean_previous, vec3 mean_new, vec3 x, int n)` | `n == 0` → `vec3(0.0)`; otherwise `mix(previous, (x − mean_previous) · (x − mean_new), 1.0 / (float(n) + 1.0))` (Welford, normalized form) |
| `oneshot/oneshot.glsl` | `vec3 oneshot_update(vec3 x)` | `x`; the latest sample, with no history |

**Facts (descriptor data, no names tested in code):**
- **Each mode** declares its `update` function name. A mode that reads history is called
  with `(previous, sample, n)`; one that doesn't, with `(sample)`.
- **A statistic** declares its `update` name. It is called with `(previous, the main
  picture's previous value, its new value, sample, n)`, which is the contract for "a
  statistic of the main picture".

The family README states both signatures.

**The generated `main()`** (`features/accumulation.ts`, origin
`generated:accumulation-main`), built from the planned picture list:

```glsl
void main() {
    <the camera setup, verbatim from today's mains>
    vec3 color = color_to_pixel(film, ray.direction, L, camera_sample);
    ivec2 coord = ivec2(gl_FragCoord.xy);                                   // only if the mode reads history
    vec3 radiance_previous = texelFetch(u_previous, coord, 0).rgb;          // one per picture, ditto
    vec3 variance_previous = texelFetch(u_previousMoment, coord, 0).rgb;
    vec3 radiance = average_update(radiance_previous, color, u_sampleCount);
    vec3 variance = variance_update(variance_previous, radiance_previous, radiance, color, u_sampleCount);
    fragColor = vec4(radiance, 1.0);
    fragMoment = vec4(variance, 1.0);
}
```

- **The previous values are fetched unconditionally.** Today they are fetched only when
  `n > 0`. At `n = 0` the buffers were just cleared, and the rules return `x` and `0`
  without reading them. So the written values are the same (expected), and the frames
  check measures it.
- **What goes:** the three hand-written mains; the per-mode `glsl` "main" fields; and the
  statistic's separate main, now just its `update` function.
- **The block layout:** each rule file is included as a block, then the generated `main()`.
- **The `requires` seams are unchanged:** `pixel_sample`, `camera_generateRay`,
  `wavelengths_sample`, `transport_trace` and `color_to_pixel`.

## Verification, with the prediction written first

**Prediction.**
- **Shader text changes in every program:** the main and the rule blocks. So the digest's
  `shaders` parts differ everywhere, and `rest` differs through the source maps.
- **Closures, scene data, data reads and warnings** are identical.
- **Every picture is bit-identical** (expected, not certain). Same seed and draw order,
  same arithmetic per picture. The risk is that a compiler fuses or reorders differently in
  the new code shape. **If any picture differs, stop and report the largest difference;
  don't adjust the code to chase it.**

1. `npx tsc --noEmit` clean; `npx vitest run` passes. That includes the glslang compile of
   every suite program, and `colorContract.test.ts`, which pins the main's camera lines and
   exactly two `random2()` draws. The GLSL snapshot is updated, and its diff is reviewed by
   kind of line (CLAUDE.md): only the main and the rule blocks may differ.
2. **The digest** against step 3's commit:
   - only `shaders` and `rest` parts differ;
   - a script confirms every `rest` difference is in `sourceMaps` alone;
   - the kept shader text, with the accumulation blocks removed, is identical: everything
     before the accumulation feature is unchanged.
3. **The frames:** 18 of 18 bit-identical. **This is the gate.**
4. **The table test** (`tests/compiler/pictures.test.ts`) gains one assertion per
   configuration: the generated main calls exactly the mode's and the statistic's update
   functions, and writes one output per picture.
5. **A minimal witness:** `npm run witness -- furnace two-light`, about a minute.
   `two-light`'s χ² checks read the variance through the new main.
6. **The literal search:** `git grep -n "void main" -- src/components/accumulator` → 0 hits.

## Not in this step

- AOVs (step 6).
- Moving `variance/` into `average/`.
- Any change to the rules' arithmetic.
