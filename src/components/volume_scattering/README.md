# volume_scattering/ — medium phase functions

**Taxonomy:** scene (the RTE's angular scattering kernel). **Kind:** mix-many by
design (one occupant today — HG serves every scattering medium; Mie/Rayleigh arrive
as new occupants).

**Unification (see also `materials/README.md`):** a phase function and a surface BRDF are
the SAME mathematical object — the angular scattering kernel — with two differences that
are real and load-bearing, which is why they stay separate families rather than merging:
the surface instance carries the cosine **Jacobian** (transport multiplies `|cosθ|`, §2.2)
and a `Hit` (hemisphere, two-sided); the volume instance carries **neither** (a phase
function already integrates to 1 over the full sphere). The `eval`/`sample`/`pdf` triple
and the §11.3 pdf-histogram obligation are shared.

## What an occupant supplies

**GLSL** (`<id>.glsl`):

```glsl
Spectrum          <id>_eval  (Direction wi, Direction wo, MediumProperties mp);
InteractionSample <id>_sample(Direction wo, MediumProperties mp, vec2 xi);
float             <id>_pdf   (Direction wi, Direction wo, MediumProperties mp);
```

Conventions:
- NO cosine anywhere — the cosine is a *surface* Jacobian (§2.2); phase functions are
  already densities over the sphere (eval integrates to 1).
- Exact samplers return `weight = SPECTRUM_ONE` (HG does — the §2.1 cancellation is
  total). `sample.pdf` must equal `<id>_pdf` (the §11.3 triple; HG's twin harness is
  the unbuilt first customer — GGX's `ggx.test.ts` is the pattern).
- **HG sign convention (do NOT consult pbrt for this line):** `1 + g² − 2gc` with
  `c = dot(wi, −wo)` — forward convention. pbrt's `+2gc` pairs with the opposite dot;
  mixing them desyncs eval from sample. The haze witness's g-drag catches it.

**Descriptor** (`<id>.ts`): `id`, `glsl`, `properties` (fields declared into
`MediumProperties` — same §3.4 schema machinery as materials, second family; e.g.
`phase_g`). **Registry line** in `index.ts`.

## How the compiler consumes it

Included when scattering arms are live; medium events call `hg_*` directly (v1 —
a generated phase dispatch arrives with the second occupant). `MediumProperties` =
RTE extinction fields (σ_a, σ_s — every medium has them) + the union of phase schemas.

## Invariants & witnesses

haze (g-drag: positive g must brighten the glow toward the light), X-FOG three-way
convergence (hg_eval/sample/pdf consistency — the audit's +2gc bug makes exactly
pt and pt-nee disagree), F-BOX-M (0.4/channel through chromatic scattering).
