# Image textures for material properties, and the asset pipeline

**Date:** 2026-11-06 · **Status:** draft for owner review, nothing built.
**Key:** image-textures. Baselines before coding: `npm run digest -- .digest/tex-before.json`.

Labels: [checked-code file:line] = read in this repo; [checked-src URL file:line] = read in the
reference's source (downloaded copies in `scratchpad/photoreal/image-textures/refs/`);
[checked-num script] = measured with a script in `scratchpad/photoreal/image-textures/`;
[reasoning] = argued, not measured.

## 1. The problem, with evidence

- No material property can come from an image. Rows take constants, `{param}`, GLSL
  expressions in `p`/`uv`, per-instance attributes and named spectrum kinds
  [checked-code src/components/color/spectra/rgb/rgb.ts:1-2]. The survey lists image textures
  as not built (sota-10, docs/claude-2026-11-review/survey/findings.md:3009). Wood, marble,
  fabric, worn metal: none of them can be authored today.
- The uv side exists. `Hit.uv` is filled by the shape's own chart where one is declared
  (sphere, quad, disk, torus [checked-code src/components/geometry/{sphere,quad,disk,torus}/*.ts
  `uvChart: true`]), by interpolated vertex uvs on meshes (the OBJ loader reads `vt`
  [checked-code src/authoring/loadOBJ.ts:121]), and by the planar placeholder
  `(x, z)·0.1` otherwise [checked-code src/compiler/generate/features/intersection.ts:680,
  src/glsl/core/structs.glsl:62]. The resolver already receives `uv`
  [checked-code src/compiler/generate/features/materials.ts:378].
- **Texture units.** The engine binds every input with `gl.bindTexture(gl.TEXTURE_2D, …)`
  [checked-code src/engine/RenderExecutor.ts:398-399], so an array texture cannot be bound
  today. The compile-time sampler budget counts only `sampler2D`/`usampler2D`; its regex
  `/uniform\s+(?:highp\s+)?u?sampler2D\s+(\w+)/` would not see a `sampler2DArray`
  [checked-code src/compiler/generate/Generator.ts:42]. Measured across all 1010 compiled
  programs of the synchronous suite, the most samplers any fragment program declares is
  **8** (spectral + mesh scenes: 2 spectral tables, 5 data channels, 1 accumulation input);
  histogram {0:1, 1:308, 2:445, 3:162, 4:22, 5:23, 6:26, 7:19, 8:4}
  [checked-num count-samplers.ts]. The worst case the code can produce is higher: 7 data
  channels + 3 environment tables + 2 spectral tables + up to 4 picture inputs = 16
  [reasoning from the extern list in compiler/generate/features/*.ts and the 4-picture floor,
  Generator.ts:27]. So all material images must share **one** unit, and the budget check must
  count it.
- **Derived rows cannot be spatial.** GGX and rough-dielectric compute `alpha =
  max(1e-3, roughness²)` on the host [checked-code src/components/materials/ggx/ggx.ts:19-22,
  rough_dielectric.ts:23-26]. An expression roughness today crashes the compiler: `GLSL format:
  cannot format non-finite number: NaN` [checked-num probe-rough-expr.ts, veach-mis with
  `roughness: { kind: 'glsl', source: '0.1 + 0.2 * uv.x' }`]. A roughness map needs this fixed
  first (Step 0).
- **MLC-16** (findings.md:1667): `materialReadsUv` treats every expression as a uv reader
  [checked-code src/compiler/plan/dataTenants.ts:51-55]. A texture value *does* read uv, by
  construction, so for textures the fact is exact. This plan does not change the expression
  rule.

## 2. The model

An image texture defines a **field** on the surface chart. Given an `W × H` image of 8-bit
codes `k[i,j]` (row 0 = the top row of the file) and its declared encoding:

1. **Decode each texel** to linear: `c = k/255`, `d(c) = c/12.92` if `c ≤ 0.04045`, else
   `((c + 0.055)/1.055)^2.4` (sRGB), or `d(c) = c` (linear data).
   pbrt decodes per texel before interpolating: `Image::GetChannel` → `encoding.ToLinear`
   [checked-src github.com/mmp/pbrt-v4 src/pbrt/util/image.h:255-276]; the sRGB curve is
   `SRGBToLinear` [checked-src src/pbrt/util/color.h:526-531].
2. **Map uv to texel space**: `s = fract(u·a)`, `t = 1 − fract(v·b)` (a, b = the row's uv
   scale), `x = s·W − ½`, `y = t·H − ½`. The flip `t = 1 − v` is pbrt's
   [checked-src src/pbrt/textures.cpp:365-367]; the half-texel offset is
   [checked-src src/pbrt/util/image.h:281]. So uv (0,0) is the image's bottom-left corner
   (the OBJ convention).
3. **Bilinear, repeat-wrapped**:
   `f(u,v) = Σ` of the four decoded neighbors of `(x, y)` with weights `(1−dx)(1−dy)`, …,
   indices taken mod `W`, `H`. pbrt's defaults are `filter "bilinear"`, `wrap "repeat"`
   [checked-src src/pbrt/textures.cpp:419,428]; Mitsuba's are `filter_type "bilinear"`,
   `wrap_mode "repeat"`, with **mip filtering disabled** for bilinear
   [checked-src github.com/mitsuba-renderer/mitsuba3 src/textures/bitmap.cpp:266-273,291].
4. **No mipmaps.** The camera's pixel filter integrates the field over the pixel by
   supersampling, so the converged pixel is the exact pixel integral of the BSDF built from
   `f`. A prefiltered (mipmapped) texture averages the *parameter* before the BSDF sees it,
   which changes the converged image whenever the BSDF depends nonlinearly on it (roughness,
   any reflectance seen through a nonlinear lobe). pbrt only reaches level 0 when the
   footprint is zero [checked-src src/pbrt/util/mipmap.cpp:229-250]. Here the footprint is
   always zero, so the field in item 3 *is* the scene. If prefiltering is ever wanted, it is a
   declared measurement field in the bias ledger, not part of this plan [reasoning].
5. **Color rows**: `f` is linear RGB in `[0,1]³` by construction (decoded 8-bit, convex
   blend). An RGB program uses it directly. A spectral program lifts it **after** filtering:
   `color_lift_reflectance(f(u,v), wl)`, as pbrt does (`RGBAlbedoSpectrum(cs, Clamp(rgb,0,1))`
   of the filtered RGB [checked-src src/pbrt/textures.cpp:369-378]) and as this project
   already defines for RGB expressions ("performs all RGB arithmetic before the resolver lifts
   its result … Lifting the inputs before blending is a different field"
   [checked-code src/components/color/spectral/README.md:192-195]). Mitsuba lifts each of the
   four texels and then blends [checked-src src/textures/bitmap.cpp:1124-1140]; that is a
   different field and is not adopted, because it would make a texture and an equivalent
   expression disagree. The reflectance domain (each component in [0,1]) holds by
   construction, not by author contract.
6. **Scalar rows** read one channel of the decoded field (e.g. `.g` of a Poly Haven "ARM"
   map = roughness). Not radiometric; identical in RGB and spectral programs.

Sampling is untouched: the field is evaluated once per hit, in `scene_material_properties`
[checked-code src/components/transport/integrators/pt/pt.ts:419], and the same `props` goes to
`eval`, `sample` and `pdf`, so the §11.3 triple and pt ≡ pt-nee ≡ pt-mis are inherited from
the models [reasoning]. Nothing here is Euclidean: the lookup is a function of the chart
coordinates only.

## 3. The change and its boundaries

### Step 0 (prerequisite, its own commit and review): derived rows computed in GLSL

- `MaterialDerivedSpec` (src/components/descriptors.ts:92-101): replace the host `fn` with
  `glsl(inputs: Record<string, string>): string`, which writes the derived value from the
  inputs' emitted GLSL. ggx and rough_dielectric declare
  `({ roughness: r }) => \`max(1e-3, ${r} * ${r})\``.
- materials.ts: the resolver arm emits `props.alpha = max(1e-3, R * R);` with `R` = the
  roughness row's emitted value (literal, uniform, expression or texture). This deletes the
  host-derivation path (`resolveDerivedInputs`, `materialDerivedExpr`, the derived uniforms
  `u_alpha_<id>`, about 50 lines: materials.ts:64-67, 248, 333-370, 406-408) [checked-code].
- Validator.ts:1223-1230 (per-instance attributes may not feed a derived row) is then
  unnecessary. Keep or drop is the owner's call (§6).
- Expected effect: the digest changes only in ggx/rough_dielectric scenes (arm text and the
  `u_alpha_*` uniforms disappear). Pixels may change in the last bit, because `0.1*0.1` in fp32
  and the fp64-computed literal `0.01` can differ by one ulp [reasoning]. The NaN crash goes away.

### Step 1: the feature

**Authoring (compiler/types.ts):**
```ts
scene.textures?: Record<string, { url: string; colorspace: 'srgb' | 'linear' }>;
// a row value, accepted wherever a material GLSL expression is accepted (rules below):
{ texture: 'wood_diff', uvScale?: number | [number, number] }                  // Spectrum row
{ texture: 'wood_arm', channel: 'r' | 'g' | 'b' | 'a', uvScale?: … }           // float row
```
`colorspace` is required. It is not guessed from the file extension (pbrt guesses `sRGB` for
.png and `linear` otherwise [checked-src textures.cpp:436]) or from an embedded ICC profile:
the Poly Haven diffuse JPG carries one and the ARM JPG does not
[checked-num `sips` on dl/diff.jpg and dl/arm.jpg].

**Validation** (analyze/propertyValidation.ts `valueProblems` + Validator):
- unknown texture name; extra keys; `uvScale` not positive and finite;
- `channel` required on float rows and forbidden on Spectrum rows;
- accepted only in material rows with `storage: 'field'` whose role is `reflectance` or that are
  plain floats. Errors (deferred, named as such): emission rows, `index` rows (region-table ior),
  medium coefficients, lights, environment;
- (until Step 0 lands: rows feeding a derived field are errors).
- A declared texture that no material reads is not uploaded (exact linkage); no warning.

**Plan** (plan/values.ts, Planner.ts):
- `planScene` assigns layers in first-use order (materials in insertion order, rows in schema
  order) and **lowers** each texture value to an expression binding with `glslValue(...)`
  [checked-code src/compiler/generate/color.ts:15-19; the comment there already names "an image
  lookup" as an expression binding]:
  `image_texture(<layer>, uv * vec2(a, b), <srgb>).rgb`, or `.<channel>` for a float row.
  The `rgb` kind then emits it unchanged in RGB and as `color_lift_reflectance(…, wl)` in
  spectral programs [checked-code rgb.ts:27-30, color.ts:48-51]. No new spectrum kind; the
  spectra README's list of `rgb` forms gains "an image texture".
- `materialReadsUv` (dataTenants.ts:54): add `|| Object.values(mat).some(isTextureValue)`.
- `SceneDataPlan` (compiler/sceneData.ts:34) gains `images: Array<{ name; url; colorspace }>` in
  layer order. `ProgramDescription.materials.images: boolean` gates the feature.

**Generate:**
- New fixed file `src/glsl/shared/image_texture.glsl` (~35 lines): `srgb_decode`, and
  `vec4 image_texture(int layer, vec2 uv, bool srgb)` doing items 1-3 of §2 with four
  `texelFetch`es on `u_material_textures`, size from `textureSize(u_material_textures, 0).xy`.
  `texelFetch` (not `texture()`) makes the filter, the wrap and the decode-before-blend live in
  GLSL, independent of engine sampler state and of the device (ENG-3 class,
  findings.md:1145) [reasoning].
- materials.ts: when `images`, push the block, `provides: image_texture`, and
  `textures.push({ name: 'u_material_textures', source: 'extern:material_textures',
  samplerType: 'sampler2DArray', precision: 'highp' })`.
- features/types.ts:22: `samplerType?: 'usampler2D' | 'sampler2DArray'`; the shader builder
  declares it `highp` (ES 3.00 gives `sampler2DArray` no default precision) [reasoning; the
  glslang compile test will confirm].
- Generator.ts:42: the regex counts `u?sampler2D(?:Array)?`.

**Engine** (stays blind; the locked contract still passes names only):
- `TextureRegistry.register(name, texture, target = TEXTURE_2D)` stores the target;
  RenderExecutor.ts:399 binds with it.
- `TextureFactory.createRGBA8Array(layers: ImageBitmap[])`: `texStorage3D(TEXTURE_2D_ARRAY, 1,
  RGBA8, W, H, L)`, `UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE`,
  `UNPACK_PREMULTIPLY_ALPHA_WEBGL = false`, `UNPACK_FLIP_Y_WEBGL = false`, `texSubImage3D` per
  layer, NEAREST.

**App** (new `app/images.ts`, ~90 lines, called next to `_uploadSceneGeometry`, App.ts:301, and on
context restore, App.ts:276):
- `fetch(url)` → blob → `createImageBitmap(blob, { colorSpaceConversion: 'none',
  premultiplyAlpha: 'none' })`;
- errors, each naming the file: a PNG whose IHDR bit depth (byte 24) is not 8 (browsers silently
  decode 16-bit PNG to 8 bits); sizes that differ across the scene's images (one array, one
  layer size); size over `MAX_TEXTURE_SIZE`; more than `MAX_ARRAY_TEXTURE_LAYERS` images;
- registers `material_textures`.

**Assets:**
- `tools/trial-assets.json` + `tools/fetch-trial-assets.mjs` (already fetch 4k HDRIs into the
  gitignored `public/trial/`, MD5-checked [checked-code]) gain texture entries
  `{ "id": "wood_table_001", "kind": "texture", "maps": ["Diffuse", "arm"], "res": "2k",
  "format": "jpg" }` → `public/trial/textures/<id>/<Poly Haven file name>`. The API's files
  endpoint keys textures by map name (`Diffuse, Rough, arm, nor_gl, nor_dx, AO, Displacement`),
  not by `kind` [checked-num api/wood_table_001.json], so the fetcher needs about 10 more lines.
- **Use JPG, not PNG**: Poly Haven's PNG maps are 16-bit RGB (IHDR: 2048×2048, depth 16, color
  type 2 for both Diffuse and Rough) [checked-num `curl -r 0-32` + `xxd`]; the 2k JPGs are
  2048×2048, 8 bits [checked-num `sips`].
- License: Poly Haven assets are CC0 ("You do not need to give credit", "You can redistribute
  them") [checked-src polyhaven.com/license]. Add `public/licenses/polyhaven.txt` saying so and
  pointing at trial-assets.json as the list.
- Models: Poly Haven offers `blend, gltf, fbx, usd` and **no OBJ** [checked-num api/Barrel_01,
  Camera_01, marble_bust_01]. Out of scope (§5).

**HDRI side (no code change):** a 4k equirect (4096×2048) is 100.7 MB of float RGB on the CPU
(kept for the variant tables), the same again as an RGB32F texture, plus 33.5 MB per CDF
variant; parse 193 ms and table build 392 ms in node [checked-num hdr-cost.ts on
venice_sunset_4k.hdr]. An 8k map is 4× that (~400 MB CPU + ~400 MB GPU + 134 MB per CDF) and
8192 px exceeds the 2048 floor of `MAX_TEXTURE_SIZE`, which the loader checks
[checked-code src/errors/resources/validation.ts:184]. Recommendation: 4k is the maximum.

**Texture memory:** one RGBA8 layer is 16.8 MB at 2k and 67 MB at 4k. Five materials × 3 maps at
2k = 15 layers = 252 MB [reasoning, arithmetic]. Recommendation: 2k.

## 4. Verification, written first

**Twin tests (vitest, before any GLSL):**
- `tests/components/imageTexture.test.ts`, a TS twin of `image_texture` (prototype:
  `scratchpad/photoreal/image-textures/twin.ts`, all checks pass [checked-num]):
  1. at texel centers the field equals the decoded texel exactly;
  2. continuous across the repeat seam (`u = 0` vs `u → 1`): difference 0;
  3. integral over one period = mean of the decoded texels (0.2371131 = 0.2371131 for the
     witness image);
  4. integral over the top half = `(⅞(r̄₀+r̄₁) + ⅛(r̄₂+r̄₃))/2` (0.3997433 both ways); bottom half
     0.0744830 both ways;
  5. a deliberately wrong implementation (blend codes, then decode) gives 0.1883057 over the
     period and must fail check 3;
  6. `srgb_decode(0) = 0`, `srgb_decode(1) = 1`, continuous at 0.04045 to 1e-7.
  There is no χ² or pdf test, because no sampling routine changes (§2, last paragraph).
- `tests/compiler/imageTextures.test.ts`: (a) the RGB resolver arm contains `image_texture(`;
  the spectral one contains `color_lift_reflectance(image_texture(`; float rows read
  `.g`; (b) `u_material_textures` is declared exactly once, as `highp sampler2DArray`, and only
  in programs whose scene reads a texture; (c) layers follow first use, and unused textures are
  absent from `sceneData.images`; (d) every Validator error in §3 fires with its message;
  (e) `materialReadsUv` is true for a texture material; (f) a synthetic program with 16
  `sampler2D` + 1 `sampler2DArray` trips the budget error.
- `tests/app/images.test.ts` (pure helpers): the PNG bit-depth reader on a 16-bit header (the
  measured Poly Haven bytes) and on an 8-bit one; the size-mismatch message.
- Step 0: the existing `ggx.test.ts` / `rough_dielectric.test.ts` twins stay green; a new
  compiler test checks that an expression roughness compiles to `max(1e-3, (expr) * (expr))`.
- glslang static compile: a new suite scene with textures (the witness below is in the suite) is
  compiled by `tests/compiler/glsl-compile.test.ts` automatically.
- `npm run digest` before/after Step 1: **no** existing suite scene changes (none reads a
  texture). Step 0: only ggx/rough_dielectric scenes change, as listed in §3.

**New witness fixtures** (`tests/witnesses/scenes/imageTextureWitness.ts` + registry entries):
- The image is a 4×4 gray 8-bit PNG, inlined in the fixture as a `data:` URL, generated once by
  a tool script. A vitest inflates it in node and checks its bytes equal the code table
  (rows from the top: 255 200 160 230 / 128 64 192 96 / 32 0 16 48 / 8 80 24 40,
  `colorspace: 'srgb'`).
- `image-texture`: a quad (corner (−1,−1,0), edge1 (2,0,0), edge2 (0,2,0), so u runs along x and
  v along y [checked-code src/components/geometry/quad/quad.glsl:33-41]) seen by an
  orthographic camera (`scale: 1`, square frame) that it exactly fills. The quad is lambert with
  the textured albedo, under a constant environment of 1, with `maxBounces: 1`. Then
  `L = ρ(u,v)` [reasoning: Lambert under unit uniform radiance]. Checks, exact tier:
  frame mean **0.2371131**, top-half mean **0.3997433**, bottom-half mean **0.0744830** (a
  v-flip swaps the last two; decode-after-blend gives 0.188), with pt / pt-nee / pt-mis
  equality.
- `image-texture-spectral`: the same scene in the spectral color model. The texels are gray, and
  a gray RGB lifts to the constant spectrum exactly
  [checked-code src/components/color/spectral/lookup.glsl:40], so it has the same three exact
  values (relying on the spectral film's gray exactness, which `spectral-furnace` gates)
  [reasoning].
- `image-texture-roughness` ⇄ `image-texture-roughness-ref` (after Step 0): ggx with roughness
  from a uniform linear texture (every texel code 77 in G) against a constant roughness of 77/255,
  as a twin check.

**Existing witnesses to run** (targeted only, never the full sweep): `furnace`, `expr-const`,
`expr-const-ref`, `spectral-expressions-constant`, `spectral-expressions`, `guides` (the albedo
guide reads textured rows through `{ row }`), and for Step 0 `veach-mis`, `rough-mis`,
`rough-smooth-limit`, `rough-furnace` [names checked-num keys.ts against `witnessSuite`].

## 5. What it does NOT do

- No mipmaps or texture differentials (a declared future measurement field if ever wanted).
- No emission, index, medium, light or environment textures; no alpha/opacity cutouts.
- No normal or bump maps (they need `dpdu` tangents; survey sota §2 item 2), and no
  displacement.
- No 16-bit, EXR or HDR image textures (8-bit PNG/JPG only).
- No textures of different sizes in one scene (one array, one layer size).
- No new uv charts: plane, box, cylinder and all SDF/fractal shapes keep the planar placeholder
  `(x,z)·0.1`. Textures on math shapes without charts need triplanar projection or procedural
  fields: separate plans (owner decision 15).
- No glTF/FBX model loading (Poly Haven has no OBJ). That is a separate plan; note glTF puts the
  uv origin at the image's top-left [reasoning, from memory of the glTF spec, unchecked], so a
  converter must flip v to match §2.
- No change to the expression rule of MLC-16.

## 6. Risks and open questions

1. **Step 0 changes ggx/rough_dielectric output** by up to one ulp in alpha, and drops the
   derived-uniform machinery. Recommendation: accept, as its own commit with a digest diff.
   Alternative: roughness textures stay an error, and Step 1 ships color and non-derived float
   rows only.
2. **Sphere chart orientation.** `sphere_uv` has `v = acos(y)/π`, which is 0 at the north pole
   [checked-code src/components/geometry/sphere/sphere.glsl:84-88]. With `t = 1 − v`, an
   equirect image (a globe, a planet) renders upside down, and possibly mirrored, depending on
   the direction of `atan(z, x)` [reasoning]. Flipping the chart would swap checker colors on
   existing checker spheres when the scale is even [reasoning]. The owner decides; it is not
   part of this plan.
3. **Shared layer size.** Mixing a 4k hero texture with 2k maps forces every layer to 4k, or is
   an error. Option later: one array per size (one more unit each).
4. **Minified textures alias.** Distant tiled textures converge correctly but slowly (texel-level
   noise until many samples per pixel), and an unmipmapped array thrashes the GPU cache. This is
   performance only [reasoning].
5. **Context loss.** Images must join the restore path (App.ts:276). The survey already notes four
   different restore policies (app-11). This adds no fifth: it uses the geometry route.
6. **SwiftShader.** Witnesses decode the `data:` PNG in headless Chromium. Expected to work but
   not run [reasoning].

## 7. Estimate

Step 0: about −50 / +25 lines of source, +30 of tests. Step 1: source about 380 lines (types 30,
validation 60, plan 50, generate 35, GLSL 35, engine 40, App 90, fetch tool 15, docs (materials
and spectra READMEs, CHANGELOG) 25); tests about 300 (twin 90, compiler 130, app 30, witness
fixtures and registry 50). Total about 700.
