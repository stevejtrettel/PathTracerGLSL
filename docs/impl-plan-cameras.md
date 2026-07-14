# Camera models — carving the measurement axis + thin-lens

**Author:** Fable (July 2026) · **Status:** PLANNED
**Authority context:** `fable-strategy-taxonomy.md` (camera = the measurement functional W_j;
changing it changes the integral — no cross-camera convergence), `fable-components.md`
(1 component = 1 folder; a new occupant = one folder + one registry line), the camera
family contract `src/components/camera/README.md`, the trace-loop contract (`Ray` = pure
geodesic seed). This plan carves the camera axis to match materials/lights/phase, then
ships thin-lens as the first occupant through the new door.

## 1. What is already true

- **Sub-pixel antialiasing is BUILT.** `pinhole.glsl` jitters `pixel + (xi − 0.5)` (box
  filter over the pixel footprint), `xi` drawn from the sampler stream in the film
  occupant (`accumulate_average.glsl:12`), QMC-stratified. Not on this plan's ledger; a
  wider reconstruction filter (tent/Gaussian) would be a separate film-side change.
- **Camera is a measurement pick-one family** with a one-function contract:
  `Ray camera_generateRay(vec2 pixel, vec2 xi)`. `pinhole/` is the sole occupant.
- **It is NOT registry-driven yet** — the odd family out. Adding a camera today means
  editing two if-chains in `src/compiler/generate/features/camera.ts` (`cameraOrigin`,
  `buildCameraSource`), not dropping in a folder. Two symptoms of the half-done state:
  - Type drift: `CameraDescription` (types.ts:345) already declares `thinlens` /
    `orthographic`, but the ProgramDescription-side `CameraDesc` (plan/types.ts:102) —
    the real link map Generate reads — only knows `pinhole`.
  - The Planner silently coerces any non-pinhole to pinhole (Planner.ts:241–243).

## 2. The committed interface (owner-decided July 13 2026)

**Camera randomness splits into two categories with different seams.**

**Category A — camera-local**, consumed inside `generateRay` to produce the geometric
ray. Complete list, and it is the ceiling: **pixel (2D) + lens (2D)**. Realistic
multi-element lenses, polygonal bokeh, and fisheye all still bottom out here.

> **Geometric signature (COMMITTED):**
> `Ray camera_generateRay(vec2 pixel, vec2 xiPixel, vec2 xiLens)`
> Film draws both; pinhole/panoramic ignore `xiLens`. Explicit two-vec2 (not
> camera-pulls-its-own-`random2`) keeps the camera a pure, stratifiable, TS-twin-able
> function — the taxonomy's "xi from the sampler stream" applied to every camera
> dimension, not just the pixel.

**Category B — seeded at the sensor, carried through the whole path** (NOT `generateRay`
args): **shutter time (1D, motion blur)** — read by `scene_intersect` for moving
geometry — and **wavelength (1D, spectral sensor)** — read by every downstream IOR /
throughput. These are fields on the `Ray`/`PathState` seed, not more `xi`. **Consciously
prepared-for, not built** (the project's prepare-for-don't-build stance; spectral is the
reserved `color: 'spectral'` axis). Note the convergence with the non-Euclidean goal: a
time coordinate on the seed is also what a Schwarzschild geodesic wants (`Point`→vec4).

> **Documentation obligation of this batch:** write the A/B split into `camera/README.md`
> and the `Ray` struct comment (`structs.glsl:12`), so no future motion-blur/spectral
> work jams a `xiTime`/`xiLambda` arg into `generateRay`. The seam is a decision, recorded.

## 3. The carve — minimum-now (owner-decided: minimum, defer descriptor richness)

Goal: make "a new camera = one folder + one registry line" TRUE, with the smallest
descriptor that achieves it. Do **not** port the full materials-style schema machinery
(capabilities, `PropertySchema`, region-tables) — the second occupant reveals which
fields earn their place.

**`CameraModelDescriptor`** (new, in `components/camera/descriptor.ts` or folded into
`components/descriptors.ts`):

```ts
interface CameraModelDescriptor {
    type: CameraType;              // 'pinhole' | 'thinlens' | ...
    glsl: string;                  // ?raw — provides camera_generateRay
    /** Model-specific uniforms/defines/UI params emitted from the camera desc.
     *  Declares facts about ONE model (the fov Value<number> block, thin-lens's
     *  aperture/focusDistance) — never composition. Shared uniforms
     *  (position/target/imageSize) + the film sample plumbing stay in the feature. */
    contribute(cam: CameraDesc): Pick<FeatureContribution, 'uniforms'|'defines'|'parameters'>;
}
```

- `components/camera/index.ts` — the registry: `{ pinhole: pinholeDescriptor }`, plus a
  `cameraModel(type)` lookup that throws on unregistered (Validator rejects upstream —
  reject-not-remove, matching `materialModel`).
- `components/camera/pinhole/pinhole.ts` — the descriptor; `contribute` holds today's fov
  `Value<number>` block verbatim (const→`#define TAN_FOV <literal>`; `{param}`→`u_tanFov`
  aliased through the same define).
- `camera.ts` feature becomes ~15 lines: shared uniforms/params + `provides` (new
  signature) + `...cameraModel(program.measurement.camera.type).contribute(cam)`. Both
  if-chains (`cameraOrigin`, `buildCameraSource`) DELETED.
- **Reconcile the types**: `CameraDesc` (plan/types.ts) gains the same variants as
  `CameraDescription`; Planner maps them straight through, the pinhole-coercion fallback
  (241–243) deleted; Validator rejects an unregistered `type` (one lookup).

**Proof of the carve: ZERO snapshot churn for pinhole** — byte-identical emitted GLSL and
uniform/param sets across every registry pair (same discipline as the GGX planner fix and
the components move). Provenance origin string stays `components/camera/pinhole/pinhole.glsl`.

## 4. The film sample-plumbing change (step 3 of the interface)

Both film occupants (`accumulate_average.glsl`, `accumulate_variance.glsl`) draw the
camera's samples and hand them in:

```glsl
vec2 xiPixel = random2();
vec2 xiLens  = random2();
Ray ray = camera_generateRay(pixel, xiPixel, xiLens);
```

`provides` signature in `camera.ts` and the `requires` in the film features update to
match. **RNG-stream note:** pinhole now consumes a second `random2()` it ignores, so its
downstream stream shifts by one draw → its converged image is unchanged but its noise
realization differs. This is the one place pinhole's pixels are not byte-identical
post-carve; the snapshot proof (§3) is over emitted GLSL, and the witness gate (furnace
0.4 etc., which are means) is unaffected. Called out so it isn't mistaken for a bug.

## 5. Occupant #1 — thin-lens (defocus / depth of field)

**The math.** Thin-lens reuses the pinhole's look-at frame and fov to form the pinhole
primary direction `d`, then applies the lens transform:

- **Focus point:** the primary ray crosses the focus plane at distance `focusDistance`
  measured along `forward`: `pFocus = o + d · (focusDistance / dot(d, forward))`.
- **Lens sample:** `vec2 lens = concentric_disk(xiLens) · aperture` (aperture = lens
  radius; `concentric_disk` is the equal-area Shirley map — same helper GGX/quad sampling
  want, lives in a shared sampler helper if not already present).
- **New ray:** origin `o' = o + lens.x·right + lens.y·up`, direction
  `d' = normalize(pFocus − o')`. Return `make_ray(o', d')`.

`aperture → 0` collapses to the pinhole ray exactly — this is the witness's structural
anchor (§5.3). Self-contained file (frame construction duplicated from pinhole, per
"1 component = 1 folder" — static occupants don't over-share).

**Schema fields (minimum-now).** `aperture` and `focusDistance` are plain scalars on the
`thinlens` variant (types already: `aperture: number; focusDistance: number`). Both emit
as **live uniforms** `u_aperture` / `u_focusDistance` with parameter paths
`camera.aperture` / `camera.focusDistance`, group Camera, `triggersReset: true` (they
change the INTEGRAL — same reset discipline as `camera.position`/`fov`, which are already
live-uniform-with-reset). fov stays the shared `Value<number>` handling. No transport,
scene, or estimator changes — **defocus is measurement, not estimation.**

**§5.3 Witnesses.** Two, both structural (no cross-camera convergence exists to assert):

1. **`aperture = 0` ≡ pinhole** — a `thinlens` strategy with aperture 0 must match the
   `pinhole` render of the same scene to witness tolerance (the exact limit). The strong
   correctness gate; catches frame/focus-math sign errors.
2. **`focus-wedge`** — a row of spheres receding in depth, one placed exactly at
   `focusDistance`. Assert: the in-focus sphere has the sharpest edge (max luminance
   gradient across its silhouette), and the circle-of-confusion grows monotonically with
   `|depth − focusDistance|` on both sides. Optional quantitative arm: measured CoC
   diameter vs the thin-lens formula `c = aperture · |z − f| / z · (focal terms)` for one
   off-focus sphere. Converged visual DoF is the owner's standing check.

## 6. The anatomy test — what lands where

| Piece | File | Kind |
|---|---|---|
| `CameraModelDescriptor` type | `components/descriptors.ts` (or `camera/descriptor.ts`) | NEW, small |
| camera registry + lookup | `components/camera/index.ts` | NEW |
| pinhole descriptor (fov block moved here) | `components/camera/pinhole/pinhole.ts` | NEW |
| feature iterates registry, if-chains deleted | `compiler/generate/features/camera.ts` | rewrite ~15 lines |
| `CameraDesc` gains variants, coercion deleted | `plan/types.ts`, `Planner.ts` | ~1 line each |
| Validator rejects unregistered camera type | `Validator.ts` | ~5 lines |
| film draws two vec2 | `film/accumulate_{average,variance}.glsl` + their features' `requires` | ~2 lines each |
| A/B seam doc | `camera/README.md`, `structs.glsl` Ray comment | prose |
| **thin-lens occupant** | `components/camera/thinlens/{thinlens.glsl, thinlens.ts, thinlens.md}` | NEW folder |
| thin-lens registry line | `components/camera/index.ts` | **1 line** |
| `concentric_disk` helper (if absent) | `components/sampler/` | small/shared |
| witnesses | `witnesses/scenes/` (aperture-0-≡-pinhole, focus-wedge) + `witnesses/index.ts` | small |

Acceptance measurement (matching the equiangular batch's rule): once the carve lands,
**adding thin-lens touches only its own folder + one registry line + the two witness
files.** If pinhole's emitted GLSL churns, or a film/feature edit is needed to add the
*second* camera, the carve is wrong — stop and fix the seam.

## 7. Occupant #2 (next batch, sketched) — panoramic / equirectangular

Zero new sample plumbing (pixel only, `xiLens` ignored): replace the NDC→direction map
with a spherical map — `pixel` → (θ, φ) → unit direction over the full sphere (equirect)
or a hemisphere/disk (fisheye). Higher payoff for the curved-space direction: it's where
"view over the full sphere in the ambient space" is established, and it stress-tests that
the `Ray` seed + `ambient_*` seam is genuinely camera-agnostic. Witness: a known
lat/long test pattern, and that a 90°-fov crop of the equirect matches a pinhole render.

## 8. Deferred ledger

- **Motion blur** (Category B): shutter time on the seed, read by `scene_intersect`;
  needs animated scene transforms — its own batch, seam prepared here.
- **Spectral sensor** (Category B): wavelength on the seed; rides the `color: 'spectral'`
  axis (contracts §8).
- **Orthographic camera** — trivial third occupant once the axis is carved (direction
  constant, origin varies over the film plane); folded in when wanted.
- **Realistic lens** (pbrt multi-element), **polygonal/cat's-eye aperture** — still
  Category-A (pixel+lens); occupants when research calls.
- **Curved-space cameras** — the equirect/fisheye in H³/Schwarzschild; the `ambient_*`
  seam is ready, the spaces are not.
- **Wider reconstruction filter** (tent/Gaussian) — film-side, not camera.
