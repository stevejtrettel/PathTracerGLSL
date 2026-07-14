# impl-plan-scattering.md — scattering-kernel unification + volume occupants

**Status:** PLANNED (Jul 14 2026).
**Depends on:** nothing structural. The rename (Stage 1) lands ALONE, before occupants.

## Why

A material's BRDF `f(ω_i, ω_o)` and a medium's phase function `p(ω_i, ω_o)` are the
SAME mathematical object — the **angular scattering kernel**. The two family contracts
already prove it: both supply `eval / sample / pdf`, both return `InteractionSample`,
both owe the §11.3 sample≡pdf triple, both use the §3.4 schema machinery. The tree
should SAY this. Today `phase/` is jargon that hides the parallel with `materials/`.

**Do NOT fold phase into materials.** Two signature differences are real and
load-bearing — folding would carry a meaningless `Hit` and re-introduce the cosine
confusion the contract works to keep out:

| | surface (BRDF) | volume (phase) |
|---|---|---|
| cosine | bare `f`; transport multiplies `\|cosθ\|`, the surface Jacobian (§2.2) | none ever — a phase fn already integrates to 1 on the sphere |
| context | `Hit` + `Frame` + normal (hemisphere, two-sided) | `MediumProperties` only (full sphere, no normal) |

One concept, two families distinguished by domain. Fix by NAMING + a shared-contract
note, not by merging.

## Stage 1 — rename `phase/` → `volume_scattering/` (pure rename)

- `src/components/phase/` → `src/components/volume_scattering/`. Occupant `hg/` moves
  with it; GLSL bytes IDENTICAL (function names stay `hg_*` — the family folder renames,
  not the occupant symbols).
- Update: the registry `index.ts` import paths, every `components/phase/...` provenance
  string / ShaderIR block id, `structure.test.ts` family-root list, `README.md`.
- **Unification note** into BOTH `materials/README.md` and `volume_scattering/README.md`
  (one paragraph each): *surface and volume scattering are the same angular kernel; the
  surface instance carries the cosine Jacobian and a `Hit`, the volume instance carries
  neither. The `eval/sample/pdf` triple and the §11.3 harness are shared obligations.*
- When the SECOND volume occupant lands (Stage 2), the medium event stops calling `hg_*`
  directly and gets a generated phase dispatch — mirror `generateInteractionDispatch`
  for surfaces. (Single-occupant today calls `hg_*` inline; the dispatch is the
  registry-driven upgrade, same pattern GGX forced for `brdfModels`.)

**Gate:** `npx vitest run` green (provenance-only snapshot churn), `npm run witness`
numbers unchanged (haze, X-FOG, F-BOX-M).

## Stage 2 — volume occupants: `rayleigh`, then a Mie-approximation

The contract per occupant (unchanged from HG):
```glsl
Spectrum          <id>_eval  (Direction wi, Direction wo, MediumProperties mp);
InteractionSample <id>_sample(Direction wo, MediumProperties mp, vec2 xi);
float             <id>_pdf   (Direction wi, Direction wo, MediumProperties mp);
```
NO cosine. Exact samplers return `weight = SPECTRUM_ONE`; `sample.pdf` MUST equal
`<id>_pdf` (the §11.3 triple — build the TS-twin histogram test per `ggx.test.ts`,
which is also HG's still-unbuilt first customer; do HG's while here).

### `rayleigh` — exact, analytic
- `eval = (3 / (16π)) · (1 + cos²θ)`, `cosθ = dot(wi, −wo)` (forward convention, same
  as HG — do NOT consult pbrt for the sign). Grayscale (the wavelength-dependence of
  Rayleigh scattering lives in the medium's σ_s ∝ λ⁻⁴, NOT in the phase — phase is the
  angular shape only). **No phase parameters** (optionally a depolarization factor,
  default 0 → skip until wanted).
- `sample`: analytic inverse-CDF — the Rayleigh CDF is a cubic in `cosθ`, invertible in
  closed form (standard: solve `2u−1 = (3μ+μ³)·¼` for μ via the depressed-cubic root).
- Witness: a `rayleigh` variant of the haze witness — the sky-blue tint must emerge from
  σ_s(λ), and forward/back symmetry (no g) distinguishes it from HG at equal σ.

### Mie — be precise about what we build
"Mie" proper is the Lorenz–Mie solution to Maxwell's equations for dielectric spheres:
tabulated, size-parameter-dependent, expensive. HG is already the *crude* analytic Mie
stand-in. The production-practical occupant is the modern **HG–Draine blend**
(Jendersie & d'Eon 2023) — an analytic phase with a droplet-size → `(g, α)` mapping that
reproduces Mie's forward peak AND the backward glory/fogbow lobe HG misses, WITH an
analytic sampler.
- Occupant **`draine`** (name it honestly): fields = droplet size `d` (or direct
  `g`,`α`). `eval` = the Draine closed form; `sample` = its analytic inverse-CDF.
- **Full tabulated Lorenz–Mie: DEFERRED** (needs a texture LUT keyed by size parameter —
  a real feature, out of scope here). Note it in the family's deferred table.
- Witness: `draine` fog showing a backscatter glory that HG at matched `g` cannot
  produce (the qualitative discriminator), plus the §11.3 triple.

**Gate per occupant:** one GLSL file + one descriptor + one `index.ts` line (the axis
the phase dispatch from Stage 1 makes cheap); `npx vitest run` + the §11.3 twin test +
`npm run witness` with its new witness.

## Ordering

Stage 1 (rename) lands alone. Stage 2 occupants are independent of each other — build
`rayleigh` first (exact, no approximation debt), then `draine`. Do HG's deferred §11.3
twin test as part of Stage 1's dispatch upgrade so all three occupants share the harness.
