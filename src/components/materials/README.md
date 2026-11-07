# materials/ — surface scattering models

**Taxonomy:** scene (defines the integrand's kernel f). **Kind:** mix-many — several
occupants coexist per program, selected per hit; the compiler generates the dispatch,
the scene-scoped `MaterialProperties` struct, and the capability tables.

**Unification (see also `volume_scattering/README.md`):** a surface BRDF and a medium
phase function are the SAME mathematical object — the angular scattering kernel. The
surface instance carries the cosine **Jacobian** (this family returns bare `f`; transport
multiplies `|cosθ|`, §2.2) and a `Hit` (hemisphere, two-sided); the volume instance carries
neither. Same `eval`/`sample`/`pdf` triple and §11.3 obligation — do NOT fold them into one
family (folding would carry a meaningless `Hit` and re-introduce the cosine confusion).

## What an occupant supplies

**GLSL** (`<id>.glsl`), four functions in the `(uc, u)` sampler form:

```glsl
Spectrum          <id>_eval    (Direction wi, Direction wo, Hit hit, MaterialProperties mp);
InteractionSample <id>_sample  (Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u);
float             <id>_pdf     (Direction wi, Direction wo, Hit hit, MaterialProperties mp);
Spectrum          <id>_emission(Direction wo, Hit hit, MaterialProperties mp);
```

Conventions (pinned; see contracts §2/§3 and trace-loop-contract):
- `eval` returns **bare f** — NO cosine (§2.2: the cosine is transport's surface
  Jacobian). `sample.weight` = f·|cosθᵢ|/pdf (the §2.1 cancellation — do the algebra,
  don't compute the quotient). `sample.pdf` must equal `<id>_pdf` on the same pair —
  MIS depends on it (§11.3's triple).
- Direction·normal products via `ambient_dot(v, n, p)` (metric discipline).
- Delta lobes: `pdf` field 0, `LOBE_DELTA` flag, `eval/pdf` functions return zero
  (§3.1); pure-delta models set `nonDeltaLobes: false` so NEE skips them.
- `uc` selects among lobes; `u` is the 2D draw. Single-lobe models ignore `uc`.

**Descriptor** (`<id>.ts`): `id`, `glsl` (?raw), `properties` (the §3.4 schema — the
fields this model READS; a field exists in `MaterialProperties` only because some
present model declares it), `capabilities { nonDeltaLobes, transmission, emissive }`, and
`albedo` — the model's color for the albedo guide (components/aov): `{ row }`, one of its own
Spectrum properties, or `{ fn }`, a function its own `.glsl` defines with the signature
`Spectrum fn(Hit hit, MaterialProperties mp)`. Diffuse color for a diffuse model, reflectance
at normal incidence for a metal, transmittance for a dielectric (OIDN's recommendations);
the compiler clamps it to [0, 1]. Required: a new model cannot forget it.

**Registry line** in `index.ts`. Registry insertion order = generated dispatch order.

## How the compiler consumes it

Planner: authored models filtered through this registry → `program.materials.models`.
Generator: per-model GLSL included for models PRESENT; `generateInteractionDispatch`
emits `interaction_surface_{sample,eval,pdf,emission}` (and `material_albedo` from the
albedo facts, only in programs whose AOVs call it); the schema union builds
`MaterialProperties` + the resolver arms; capabilities feed `material_has_nondelta_lobes`,
the ior table (transmission), and the emission gate (emissive ∧ authored value).

## Invariants & witnesses

Furnace closure (F-BOX = 0.4 exactly, for lambert), §11.2 cross-strategy convergence
(any two estimator strategies agree on the same scene), the §11.3 pdf-histogram triple
(TS-twin form: see `ggx/ggx.test.ts`). Occupants: `lambert/` (the shape-setter),
`dielectric/` (delta, η² factor — F-ETA 0.554), `ggx/` (VNDF; see `ggx/ggx.md`),
`mirror/` (delta conductor, Schlick — shares the `f0` row with ggx, the first real
§3.4 union-dedupe pair; F-MIRROR = f0·L convex).


Index-consuming models mark their region-table row with `role: 'index'`.
`modelIndexRow` exposes that declaration to the planner. Smooth and rough dielectrics
accept scalar indices, [Cauchy](../color/spectra/cauchy/README.md), or
[Sellmeier](../color/spectra/sellmeier/README.md); spectral transport
collapses once before index-dependent scattering/NEE. Radiometric rows still declare
reflectance/emission roles separately; an index is not an RGB lift.

## Image textures

A reflectance row (albedo, f0, transmittance, checker's colors) may read an image:
`{ texture: name, uvScale? }`, with `scene.textures[name] = { url, colorspace: 'srgb' | 'linear' }`.
The field is pbrt-v4's at zero footprint (src/glsl/shared/image_texture.glsl, twin
tests/glsl/imageTextureTwin.ts): t = 1 − v (uv (0, 0) is the image's bottom-left corner), texel
centers at half-integers, each texel decoded to linear before the bilinear blend, repeat wrap. No
mipmaps: the pixel filter integrates the field, so the converged pixel is exact (a prefiltered
texture would change the converged image wherever the BSDF is nonlinear in the value). The value
is read once per hit by `scene_material_properties`, so eval, sample and pdf see one `props`.

The images a scene's materials read are its layers of one RGBA8 2D-array texture (one sampler
unit), in first-use order; they must share one size, and a declared image nobody reads is not
loaded. Errors, not yet built: textures in emission, index or float rows (roughness waits for
derived rows computed per hit), in media, lights or the sky, and on spheres (the sphere chart is
pbrt's rotated 180°, and which one to keep is not decided). Shapes without a uv chart (plane, box,
the SDF shapes) and meshes without uvs read the planar placeholder `(x, z)·0.1`; other meshes read their interpolated vertex uvs.

## Shading-normal perturbation (bump)

Any surface model takes the meta-key `bump: { height, step }`. `height` is a float GLSL
expression h(p) in the world point `p` (world units; it may declare sliders and call the Perlin
functions); `step` is the finite-difference step in world units, required. The geometry does not
move: silhouettes, shadows and `Hit.ng` stay those of the true surface. The code is
`glsl/core/shading_normal.glsl`; its TS twin is `tests/glsl/shadingNormal.test.ts`.

**Model.** The bumped surface p + h(p)·n_out has, to first order in h, the outward normal
n_out − ∇_S h, where ∇_S h = (∂h/∂t) t + (∂h/∂b) b for any orthonormal tangent pair (t, b). This
is pbrt-v4's `BumpMap` without its h·∂n/∂u terms (the curvature of the base surface); dropping
them is the definition of the model, not a hidden approximation. The derivatives are central
differences along geodesics (`ambient_geodesic`), four height evaluations per hit; pbrt uses
one-sided differences (three evaluations), the central form has error O(step²) instead of
O(step). No uv chart and no tangent field are needed, so it works on meshes, analytic shapes and
marched SDFs alike.

**Orientation σ.** `hit.frame.n` faces `region_from`. It equals n_out exactly when the ray
entered the owner (`region_to == region_owner`, σ = +1), and −n_out otherwise. The shading
normal is n' = σ(n_out − ∇_S h) = n − σ∇_S h: the same relief from both sides.

**Soundness** (Mitsuba 3's `PerturbedBSDF`, with one change):
1. *Flip* (Schüssler et al. 2017). If wo·n' ≤ 0, n' is mirrored across the base normal:
   n'' = 2(n'·n)n − n'. Since wo·n > 0 and n'·n > 0, wo·n'' > 0, so every model sees wo above its
   shading normal (the dielectric's `cos_i` clamp relies on this).
2. *Mask.* A direction wi is kept only if (wi·ng)(wi·n'') > 0, in eval, pdf and sample alike; a
   masked sample is killed (weight 0, pdf 0), so the sampler's density on the surviving set is
   the model's pdf. Mitsuba masks against the base shading normal; this masks against `Hit.ng`,
   the surface `ray_spawn` actually crosses. That is required, not a preference: the walk updates
   the medium from the lobe flags, so a "reflection" below ng would cross the surface unrecorded.
3. *One frame.* The walk replaces `hit.frame` with the perturbed frame
   (`material_shading_frame`) right after the hit, before the guides, NEE's cosine, the light
   query and the BSDF ops, so every technique uses the same cosine |wi·n''| and pt, pt-nee and
   pt-mis converge to the same image.

**Consequences.** No energy is gained (the mask only removes directions). Energy is lost in the
wedge between n'' and the true horizon: a Lambert plane with a constant slope tan θ under a
uniform sky L reads ρL(1 + cos θ)/2 for every view, flipped or not (the `bump-tilt` witness).
The BSDF is not reciprocal (the frame depends on wo, the mask on ng); that matters only for
light tracing, which this renderer does not do. The perturbation reads no spectrum, so RGB and
spectral programs are identical here.

**The step.** For relief features of size ℓ, the gradient's worst error relative to max|∇h| is
about (step/ℓ)²/2 (truncation) + 2·|p|·2⁻²⁴/step (float rounding of p ± step). Example: ℓ = 0.025
(a noise at frequency 40) with |p| ≤ 10 gives 2·10⁻³ at step = 10⁻³, 0.08 at 10⁻² and 0.12 at
10⁻⁵. The twin pins this law.

Witnesses: `bump-tilt` (the lune value, flipped and unflipped rows, pt / pt-nee / pt-mis /
spectral) and `bump-sides` (σ and the gradient's sign, seen from both sides of a thin quad).
