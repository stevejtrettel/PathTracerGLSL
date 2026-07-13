# materials/ — surface scattering models

**Taxonomy:** scene (defines the integrand's kernel f). **Kind:** mix-many — several
occupants coexist per program, selected per hit; the compiler generates the dispatch,
the scene-scoped `MaterialProperties` struct, and the capability tables.

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
present model declares it), `capabilities { nonDeltaLobes, transmission, emissive }`.

**Registry line** in `index.ts`. Registry insertion order = generated dispatch order.

## How the compiler consumes it

Planner: authored models filtered through this registry → `program.materials.models`.
Generator: per-model GLSL included for models PRESENT; `generateInteractionDispatch`
emits `interaction_surface_{sample,eval,pdf,emission}`; the schema union builds
`MaterialProperties` + the resolver arms; capabilities feed `material_has_nondelta_lobes`,
the ior table (transmission), and the emission gate (emissive ∧ authored value).

## Invariants & witnesses

Furnace closure (F-BOX = 0.4 exactly, for lambert), §11.2 cross-strategy convergence
(any two estimator strategies agree on the same scene), the §11.3 pdf-histogram triple
(TS-twin form: see `ggx/ggx.test.ts`). Occupants: `lambert/` (the shape-setter),
`dielectric/` (delta, η² factor — F-ETA 0.554), `ggx/` (VNDF; see `ggx/ggx.md`).
