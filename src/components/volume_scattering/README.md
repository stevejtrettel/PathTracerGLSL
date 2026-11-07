# volume_scattering/ — medium phase functions

**Taxonomy:** scene (the RTE's angular scattering kernel). **Kind:** mix-many (occupants
hg and rayleigh; each medium names its model, and Mie would arrive as a new occupant).

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
Spectrum          <id>_eval  (Direction wi, Direction wo, Point p, MediumProperties mp);
InteractionSample <id>_sample(Direction wo, Point p, MediumProperties mp, vec2 xi);
float             <id>_pdf   (Direction wi, Direction wo, Point p, MediumProperties mp);
```

`p` is the point of the scattering event; `wi` and `wo` are tangent there.

Conventions:
- **Metric at p.** The phase-angle cosine is `ambient_dot(wi, -wo, p)` and a sampled
  direction is normalized with `ambient_normalize(…, p)` (docs/trace-loop-contract.md, the
  metric rule). The sampling basis around `-wo` is core math's `build_basis`, a Euclidean
  construction (vec3 `cross`): a curved space needs the tangent frame at `p`
  (`ambient_frame`), so hg and rayleigh are Euclidean-only until they build their basis
  that way.
- NO cosine anywhere — the cosine is a *surface* Jacobian (§2.2); phase functions are
  already densities over the sphere (eval integrates to 1).
- Exact samplers return `weight = SPECTRUM_ONE` (HG does — the §2.1 cancellation is
  total). `sample.pdf` must equal `<id>_pdf` (the §11.3 triple; HG's twin harness is
  the unbuilt first customer — GGX's `ggx.test.ts` is the pattern).
- **HG sign convention (do NOT consult pbrt for this line):** `1 + g² − 2gc` with
  `c = ambient_dot(wi, −wo, p)` — forward convention. pbrt's `+2gc` pairs with the opposite dot;
  mixing them desyncs eval from sample. The haze witness's g-drag catches it.

**Descriptor** (`<id>.ts`): `id`, `glsl`, `properties` (fields declared into
`MediumProperties` — same §3.4 schema machinery as materials, second family; e.g.
`phase_g`). **Registry line** in `index.ts`.

## How the compiler consumes it

Included when scattering arms are live. Transport never calls `<id>_*` directly: it calls
the generated dispatch (compiler/generate/features/materials.ts), which routes by `mp.model`
(the registry index `scene_medium_properties` sets) and has the occupant's signatures:

```glsl
InteractionSample interaction_medium_sample(Direction wo, Point p, MediumProperties mp, vec2 xi);  // kernel_phase
Spectrum          interaction_medium_eval  (Direction wi, Direction wo, Point p, MediumProperties mp);  // medium NEE (light_medium, equiangular)
float             interaction_medium_pdf   (Direction wi, Direction wo, Point p, MediumProperties mp);  // the medium-site MIS weight
```

Each caller passes the event point `p_evt`. `eval` exists only under NEE and `pdf` only under
MIS (exact linkage). `MediumProperties` = RTE extinction fields (σ_a, σ_s — every medium has
them) + the union of phase schemas.

## Invariants & witnesses

haze (g-drag: positive g must brighten the glow toward the light), X-FOG three-way
convergence (hg_eval/sample/pdf consistency — the audit's +2gc bug makes exactly
pt and pt-nee disagree), F-BOX-M (0.4/channel through chromatic scattering).
