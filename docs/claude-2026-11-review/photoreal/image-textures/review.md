# Review: image-textures plan

**Reviewer:** independent agent, 2026-11-06. **Verdict: approve with changes.**

Labels: [checked-code file:line] = read in the repo; [checked-src URL] = re-fetched by me
(copies in `image-textures/review-refs/`); [checked-num script] = run by me (scripts in
`image-textures/review-scripts/`); [reasoning] = argued, not measured.

## What holds up

- **The model is right, and it matches pbrt.** I re-fetched pbrt-v4 `textures.cpp`: the flip
  `c.st[1] = 1 - c.st[1]` and `RGBAlbedoSpectrum(*cs, Clamp(rgb, 0, 1))` applied to the
  *filtered* RGB are at lines 367 and 375-378 [checked-src raw.githubusercontent.com/mmp/pbrt-v4/master/src/pbrt/textures.cpp].
  `image.h` `BilerpChannel` uses `x = p·res − 0.5` and blends four `GetChannel` values, and
  `GetChannel` decodes each U256 texel with `encoding.ToLinear` before the blend (lines 255-291)
  [checked-src .../util/image.h]. Mitsuba's defaults are `filter_type "bilinear"` and
  `wrap_mode "repeat"` (bitmap.cpp:266, 291) [checked-src mitsuba3 src/textures/bitmap.cpp].
- **Estimator.** Textures enter only through `scene_material_properties`, evaluated once per hit
  (pt.ts:419). The same `props` then goes to eval, sample and pdf [checked-code]. The §11.3
  triple and pt ≡ pt-nee ≡ pt-mis are inherited, and no light/emission row may take a texture.
  "No mipmaps, so the field is the scene" is the right reading of the measurement/estimator split.
- **Spectral.** Lifting after filtering matches pbrt and the project's own rule for RGB
  expressions. The reflectance domain [0,1] holds by construction.
- **The cited code is real.** I checked the RGBA binding with `TEXTURE_2D` (RenderExecutor.ts:399),
  the sampler regex (Generator.ts:44), `samplerType?: 'usampler2D'` (features/types.ts:22), the
  quad chart (quad.glsl:33-41), the sphere chart (sphere.glsl:84-88), the gray-exact lift
  (lookup.glsl:40), `materialReadsUv` (dataTenants.ts:51-55), the `glslValue` comment naming
  "an image lookup" (color.ts:14-15), mesh uvs reaching `hit.uv` (intersection.ts:910, 1028), and
  the ortho half-height `scale` (orthographic.glsl) [checked-code]. All witness names in §4 exist
  in pages/sections.ts [checked-code].
- **The expression-roughness crash is real by reading.** `resolveDerivedInputs` passes the
  `GlslExpression` object into `fn`, `fn` multiplies it (NaN), and `formatFloat` throws
  (materials.ts:338-357) [checked-code]. I could not re-run the probe: tsx cannot load `?raw`
  imports.
- **Twin values reproduce.** frame 0.2371131, top 0.3997433, bottom 0.0744830, decode-after-blend
  0.1883057 [checked-num twin.ts]. Dropping the half-texel offset moves the top half to 0.2870,
  so the witness catches that error too [checked-num review-scripts/offset.ts].

## Must fix

1. **The sphere chart is the opposite of pbrt's, so equirect images render rotated 180° on
   spheres.** pbrt sets `v = (θ − θZMin)/(θZMax − θZMin)` with `θZMin = acos(zMin/r) = π`. So
   v = 0 is at the *south* pole, and `t = 1 − v` puts the north pole on the image's top row
   (shapes.h:126-127, 242-245) [checked-src pbrt-v4 src/pbrt/shapes.h]. Here v = 0 at the
   *north* pole (sphere.glsl:84-88), so the image comes out upside down. Also, `u = atan(z,x)`
   about +y turns the opposite way to pbrt's `atan2(y,x)` about +z, which mirrors the image
   [reasoning, from the two formulas]. Upside down plus mirrored is a 180° rotation. The plan
   puts this under "owner decides, not part of this plan" (§6.2). But the plan ships sphere
   textures, so it must settle the question before Step 1: either flip the chart (a declared
   change to checker-sphere images, with a digest diff and a witness), or make a texture on a
   sphere a compile error until the owner decides. Shipping it silently is not acceptable.
2. **The witness cannot catch a u-mirror.** The left-half mean is 0.24132 and the right-half mean
   is 0.23290. That is a 3.5% gap, which probably sits inside the exact-tier tolerance
   [checked-num review-scripts/lr.ts]. Change the 4×4 image so that its columns differ as
   strongly as its rows, and check all four quadrants. Also write the regions in the harness's
   bottom-left readPixels convention (tests/witnesses/types.ts:9). As written, "top half" is
   ambiguous, and the v-flip check depends on it.
3. **The roughness witness cannot catch a wrong channel.** Make R and B differ from G (for
   example R = 0, G = 77, B = 255). Then a read of the wrong channel fails, and so does an sRGB
   decode (77 sRGB → about 0.074 instead of 0.302).
4. **Values are lowered too late, so every pre-plan reader sees the raw texture object.** The plan
   lowers `{ texture }` to an expression binding in `planScene`, after Analyze and Validate. It
   names three readers that must learn the new form: `valueProblems`, the Validator and
   `materialReadsUv`. Others also dispatch on value form:
   - `kindOf` falls back to `rgbKind`, whose `is` returns true for anything (rgb.ts:14), so a
     texture value is classed as RGB.
   - `analyze/spectral.ts:52` calls `atMost(texture, 1)`, which returns true only by accident
     (an object has no components, spectral.ts:15-19).
   - `rgbPreview.ts` reads the raw value.
   - Validator.ts:986 checks region-row expressions.
   Either list every such site with the rule it gets, or (simpler) lower texture values to the
   `GlslExpression` binding in one pass right after the texture-specific shape check, so that
   everything downstream sees one form. The second route also removes the `materialReadsUv`
   edit, since expressions already count as uv readers. Testing for `isTextureValue` outside
   `components/color/spectra/` in many places also cuts against the rule that "nothing outside
   that folder tests for a particular kind".
5. **Step 0 should be its own plan, and it should name what it reverses.** The D4 comment on
   `MaterialDerivedSpec` (descriptors.ts:85-91) says "GLSL never recomputes a pure function of
   its own rows per evaluation". Step 0 reverses that recorded decision. It also fixes a crash
   that exists today, independent of textures, and CLAUDE.md asks that refactors not be mixed
   with feature work. Three changes:
   - Emit the derived value from the already-assigned struct field,
     `props.alpha = max(1e-3, props.roughness * props.roughness);`, instead of re-emitting the
     input text twice. With a texture input, `R * R` would emit two 4-texel lookups.
   - Say what happens to the `Spectrum` variant of `MaterialDerivedSpec`. It needs a role lift
     under the new GLSL form, and nothing uses it today.
   - Drop the Validator.ts:1223-1230 rule (per-instance input to a derived row), since its
     reason no longer holds, and add a test that a per-instance roughness compiles.

## Simplifications (recommended, not required)

- **Without Step 0, float/channel rows have no consumer.** The only non-derived float field row
  in any model is checker's `uv_scale`. Every roughness feeds `alpha`, and `ior` is region-table
  [checked-code grep of materials/*/*.ts]. The §6.1 alternative ("ship color and non-derived float
  rows") would build the `channel` machinery for nothing. Either ship Step 0 first, or ship color
  rows only and add `channel` together with roughness maps.
- **Drop the `UNPACK_*_WEBGL` pixelStorei calls.** The WebGL spec ignores these for `ImageBitmap`
  sources; the `createImageBitmap` options govern instead [reasoning, from memory of the spec,
  unchecked]. If row order must be exactly as stored, the relevant option is `imageOrientation`
  (EXIF), which the plan does not mention.
- **Drop the `MAX_ARRAY_TEXTURE_LAYERS` check.** The floor is 256 layers, which is 4 GB at 2k.
  Memory runs out long before that.
- **Decide the 16-bit PNG check against "no guesses".** Either keep it as an error (browsers
  narrow 16-bit to 8-bit silently, so it is defensible), or remove it and state that images are
  read at 8 bits. The plan already recommends JPG.
- **Move the HDRI-cost section out.** It changes no code. It belongs in the asset notes, not in
  this plan.
- **Untested alternative, not recommended here.** A texture could be a function callable inside
  the existing GLSL-expression form, declared by a key on the expression (for example
  `textures: ['wood']`) rather than as a new value form. That would bring remaps such as
  `0.2 + 0.5 * tex.g` and blends of two maps for free, and it reuses the expression validation
  and uv gate. The cost: authors write GLSL, and the reflectance domain falls back to an author
  contract. I have not thought this through against the validator.

## Verification: can it fail?

- The twin tests check TS against TS. Only the witness checks the GLSL. That is fine, as long as
  the witness can see each convention: the v-flip (yes), the half-texel offset (yes),
  decode-then-blend (yes), the u-mirror (no, see must-fix 2) and the channel (no, see must-fix 3).
- `image-texture-spectral` uses gray texels, so lifting before or after the blend gives the same
  value. That witness cannot catch Mitsuba's lift order. Compiler test (a)'s text check pins the
  order structurally, which is enough. Say so in the plan rather than implying the spectral
  witness covers it.
- Nothing tests the `colorspace: 'linear'` path for a *color* row. The roughness witness covers
  linear only for a float row. Swapped srgb/linear flags for color rows would go unnoticed. Add a
  linear color fixture, or have compiler test (a) check the generated `image_texture(..., false)`
  argument.

## Fit / other notes

- Using an array texture with `texelFetch` is the right call over an atlas. The layer size comes
  from `textureSize` at run time, so the compiler needs no image sizes before the App loads them
  [reasoning].
- Under the plan's worst case of 16 samplers, the texture array makes 17. The budget check will
  then reject that combination. That behavior is correct, but the plan should say it.
- JPG decoders differ slightly between browsers, so the same scene can differ in its last bits
  across browsers. Exports carry reproducibility stamps, and image hashes are not in them. Note
  this as an open question; nothing to build.
