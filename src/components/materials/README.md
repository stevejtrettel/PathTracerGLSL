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
`rough_dielectric/` (GGX microfacet glass; see `rough_dielectric/rough_dielectric.md`),
`checker/` (a two-color Lambertian checkerboard on the shape's uv chart),
`plastic/` (smooth clear coat over a Lambertian base, Mitsuba's interfaced Lambertian: a
delta coat lobe and a non-delta diffuse lobe in one model, so a single sample can carry
LOBE_DELTA; albedo in [0, 1]; `coat_eta` is relative to the outside medium; see
`plastic/plastic.md`),
`thin_dielectric/` (an infinitely thin glass sheet, pbrt's ThinDielectricBxDF: delta reflection
2R/(1 + R) and straight-through transmission, both of weight 1; `sheet_eta` is relative to the
medium around it; it passes light through without changing region, so the Validator rejects it
in scenes with media; see `thin_dielectric/thin_dielectric.md`).
`sheen/` (OpenPBR fuzz over a Lambertian base: an LTC fuzz lobe and the base, mixed by the
fuzz albedo E(μ_o); exact pdf, no tangent field needed, not reciprocal; see `sheen/sheen.md`).
`conductor/` (smooth metal with the exact conductor Fresnel term of a complex index η + iκ,
per wavelength lane; rows `eta` and `k` have role `optical` and take numbers, a scalar
`{param}` or a [measured](../color/spectra/measured/README.md) table; see
`conductor/conductor.md`), `rough_conductor/` (the GGX lobe with that Fresnel term; shares
`eta`, `k` with `conductor` and `roughness` with `ggx`; single scattering only).


**Microfacet models** (`ggx`, `rough_dielectric`) declare `microfacet: { energy }`: the gate
for `glsl/core/microfacet.glsl` and the energy gain their GLSL multiplies into eval and the
sample weight. `sheen` declares `energy: 'none'`: it reads only the library's frame maps and
calls no gain. `rough_conductor` declares `energy: 'not-built'`: its gain would need the
hemispherical average of its Fresnel term per lane, and `'energy-compensated'` rejects it. `microfacet_energy/` is the shared part behind the gains (not an occupant):
the energy table, its TS twin and builder, and `microfacet_energy.glsl`, linked under
`measurement.microfacet: 'energy-compensated'`; otherwise the compiler emits each gain as 1.
Their roughness rows lie in [0, 1], the table's range (`microfacet_energy/microfacet_energy.md`).

Optical rows (`role: 'optical'`, the conductors' `eta` and `k`) are Spectrum fields evaluated
per wavelength lane and never collapsed. They take a number, an RGB triple (RGB programs only),
a scalar `{param}` (a float slider) or a named kind with the optical role; not an expression, a
vec3 slider or a per-instance attribute.

Index-consuming models mark their region-table row with `role: 'index'`.
`modelIndexRow` exposes that declaration to the planner. Smooth and rough dielectrics
accept scalar indices, [Cauchy](../color/spectra/cauchy/README.md), or
[Sellmeier](../color/spectra/sellmeier/README.md); spectral transport
collapses once before index-dependent scattering/NEE. Radiometric rows still declare
reflectance/emission roles separately; an index is not an RGB lift.
