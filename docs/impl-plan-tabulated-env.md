# Implementation Plan — Tabulated Environments (§2.10 proving case c, tabulated half)

**Author:** Opus (implementing Fable's §2.10 external-texture ruling)
**Status:** planned (analytic half — none/constant — already done)

The **analytic** environments (`none`, `constant`) are built. This plan covers the
**tabulated** environments — `image` (HDRI) and `procedural` (a sky shader) — which
share one runtime representation and one big body of machinery.

## The shared idea

A tabulated environment is **an equirect radiance texture + a CDF built from it**:
- `u_envMap` — the sky as an equirectangular RGB texture.
- CDF textures (`u_envCDFCond`, `u_envCDFMarg`) + `u_envSize`, `u_envTotalWeight` —
  a 2D distribution over directions weighted by radiance·sinθ, for importance sampling.

`image` and `procedural` differ **only in how the table is filled**:
- **image:** decode the HDR file into the table (load-once, static).
- **procedural:** evaluate the GLSL formula once into the table (regenerable — its
  uniforms may be live while editing; frozen for a fixed render, at which point it *is*
  an image). Miss-radiance may direct-eval the formula (sharp) while the CDF always
  comes from the table.

Everything downstream (CDF build, importance sampling, NEE) is identical.

## Two runtime GLSL functions the environment contributes
- `environment_radiance(dir)` — for a missed ray (already exists for analytic kinds).
- `environment_sample(xi) -> {dir, radiance, pdf}` — importance-samples the sky as a
  **light** for NEE/MIS. New; transcribe from `reference/world/environment/hdri-importance.glsl`.

## Existing infrastructure to reuse (don't rebuild)
- `src/engine/HDREnvironmentLoader.ts` + `loaders/hdr-loader.ts` — HDR decode.
- `src/engine/loaders/build-environment-sampler.ts` — CDF construction.
- `src/engine/TextureRegistry.ts` — the texture store.
- **To delete:** `Engine._bindEnvironmentTexturesToRenderer` + the hardcoded `u_envMap`/
  `u_envCDF*` names + the unit-0 reservation (the blind-executor violation, review #8).

## Phases

### T1 — Engine `extern:` texture resolution (foundational; §2.10 (2)(3))
The refactor that makes "texture as a declared resource" real. Fixes engine #2 + #8.
- `RenderExecutor._bindTextures`: resolve an `extern:<name>` input by looking `<name>`
  up in `TextureRegistry` and binding it to the next sequential unit (engine is the
  sole unit authority; framebuffer refs and `extern:` refs bind the same way).
- `TextureRegistry` → a dumb `name → WebGLTexture` store (drop the fixed-unit reservation
  and one-shot bind-at-load).
- Delete `Engine._bindEnvironmentTexturesToRenderer`.
- Reserve `extern:` as a buffer-id prefix (alongside `_current`/`_previous`).
- **Validator:** every `extern:` ref in the planned pipeline traces to a `scene.environment`
  declaration (compile-time); a missing key at bind time is a hard, named engine error.
- While here: cache `getUniformLocation` per `(program, name)` — the cheap half of engine #9.
- **Bonus (bundle i-b):** with `extern:` textures real, route the **display shader's**
  `u_radiance` (texture) + `u_resolution` through the contribution/declared-resource path
  and drop the template-owned uniforms from `tonemap_reinhard.glsl`.

### T2 — `image` environment
- `contributeEnvironment('image')`: `textures: [u_envMap→extern:env_map, cond, marg]`;
  `uniforms: u_envSize, u_envTotalWeight` (scalars on `env.size`/`env.totalWeight` params
  the loader sets); block = transcribe `hdri.glsl` (radiance = equirect texture lookup) +
  `hdri-importance.glsl` (`environment_sample`).
- Wire App/Engine: on an `image` scene, load the HDR → put `env_map` + CDF textures into
  the registry under the extern names; set the size/weight params.

### T3 — Environment as a NEE light
- Integrate `environment_sample` into transport NEE/MIS so the sky illuminates like a
  light (currently the env is only seen on a direct miss). Touches lighting + `path_trace`
  (MIS between BSDF sampling and env sampling). Align with the §6 light contracts.

### T4 — `procedural` environment
- `contributeEnvironment('procedural')`: emit the formula as the `environment_radiance`
  body (direct eval, live uniforms) + declare the CDF externs.
- Engine: a one-time GPU pass rendering the formula over an equirect grid → the table,
  then reuse the T1/T2 CDF builder. Regenerate on uniform change or freeze at render start.

## Decisions to settle when we build this
1. **Procedural miss radiance:** direct-eval the formula (sharp, resolution-free) vs read
   the baked table (simpler). Lean: direct-eval; table only for the CDF.
2. **Procedural CDF regeneration:** on every uniform change vs freeze-at-render-start.
   Lean: freeze at render start (production is where importance sampling matters); a stale
   CDF during interactive motion is acceptable.
3. **`environment_sample` signature + MIS weighting** — pin against §6 and the reference
   samplers so BSDF and env sampling agree on measure/pdf.

## Ordering note
T1 is the load-bearing foundation (and clears engine #2/#8 + i-b). T2 gives a visible
result (HDRI sky) quickly on top of the existing loader/CDF code. T3 makes it a *light*.
T4 (procedural) reuses everything from T2/T3 plus the render-to-table pass. Do them in
order; each is independently committable.
