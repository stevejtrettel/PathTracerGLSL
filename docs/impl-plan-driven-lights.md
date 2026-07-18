# Driven light parameters, Stage A — radiometrics (emission) as live sliders

**Author:** Fable (July 17 2026, late session) · **Status:** PLAN — owner-approved
framing; implementation not started.
**Authority context:** `impl-plan-area-lights.md` (the deferred-table row this
implements: "Value<T> light params via the accessor"), the lights-door batches
(struct-alignment: hoisted consts + adjacent samplers/pdfs), the driven-placement
batch (`fable-transforms.md` §6 — the compute-closure + multi-path `PlannedUniform`
machinery this rides), and the **precompute-and-ship rule** (owner, this session):
the GPU consumes, it never derives — driven features are FORMATTER SLOTS fed by CPU
closures; if a sketch contains GPU-side normalization or guards, it is misframed.

**Scope pin (Stage A):** the RADIOMETRIC field of explicit lights (`emission`, any
registered kind) accepts `Value<number|Vec3>`. Geometry fields (position, edges,
radius, direction, cone angles) stay constant — that is **Stage B** (rides the
Placement contract into the desugar path; rigid-only per the transforms pin). The
`sampleAsLight` route (emissive material objects) keeps its constant-emission pin —
graduating those is Stage A′ on the ledger; an author who wants a dimmable samplable
panel writes an explicit light.

## The shape (one sentence)

The light tables grow formatter slots: every emitted line keeps today's exact form,
with compile-time literals replaced by uniform reads exactly where a value is driven
— all derivation (powers, CDF, normalization, degenerate cases) happens in ONE
shared TypeScript function evaluated at plan time (bake path) and inside a compute
closure at param-change time (ship path).

## The slot inventory (from the code, `generate/features/lighting.ts`)

| Site | Today | Driven form |
|---|---|---|
| selection CDF branches (`lighting_sample`, L297–306) | `formatFloat(cdf[i])`, `formatFloat(selectPdf[i])` | `u_light_cdf[i]`, `u_light_selpdf[i]` (both shipped — the shader never subtracts adjacent CDF entries) |
| `lighting_pdf` selection factor (mis) | `formatFloat(selectPdf[i])` | `u_light_selpdf[i]` — SAME array as the sampler, symmetric by construction |
| the hoisted const (`generateLightConsts`) | `const QuadLight light_0 = QuadLight(<literals>)` | GLSL globals can't init from uniforms: a driven light's construction moves into a tiny generated `QuadLight light_get_0()` (fields = literal or uniform per row); `sampleCall`/pdf arms substitute `light_get_0()` for `light_0`. Constant lights in the same scene KEEP their consts. |
| `lighting_query_delta` arms (equiangular) | `formatSpectrum(intensity)` literal | the intensity row's uniform (position row stays literal — Stage B) |
| the desugared `__light_n` region's material emission | constant | the SAME `{param}` flows into the synthesized material's emission row (driven material emission is live machinery — the hittable Le and the sampler's `ls.radiance` read the ONE uniform minted from the one param path; agreement by construction) |
| two-stage env wrapper (`u_envSelectProb`) | constant/binding as today | UNCHANGED — stage 0 splits env vs finite-total; the finite CDF renormalizes internally. Verify (not assume) in A2 that no stage-0 read bakes a finite-power total; if one does, it becomes one more shipped slot. |

## One truth for the power math

`lightPower` and `computeSelectPdf` are already exported pure functions (used by the
H6 invariant tests). The compute closure calls EXACTLY these, on planned lights whose
driven rows are substituted with live store values — the Planner's bake path and the
closure's ship path share one implementation (the `similarityFromTransform`
precedent). The driven≡baked witness then also proves there is only one copy of the
formula.

**Degenerate cases live in the closure, not the shader:** a zero-power light ships
zero CDF mass (the existing inversion never selects it — no guard); ALL lights at
zero ships uniform selection pdfs with zero radiance uniforms — samples cost shadow
rays and contribute exactly 0. No sentinel, no shader branch, correct by
construction; the closure is vitest-testable.

## Tasks

**A0 — input language + decisions** (gate: tsc + vitest)
1. `LightDescription.emission: Value<number|Vec3>` on every kind's authored schema
   (the generic light validation accepts ValueParam shape for the radiometric row;
   `validateAuthored` shape-checks extend).
2. `PlannedLight` carries the driven row (values keep the ValueParam, like
   PlannedMedium coefficients); desugar threads it into the synthesized material.
3. Link-map decision: `EmittersDesc.driven: boolean` (any light with a driven
   radiometric row) — gates every substitution below; constant scenes byte-identical.
4. Validator: relax the explicit-light constant-emission requirement; reserved-path/
   collision checks ride `collectParamPaths` automatically (ValueParam-shaped).
   Census: a driven emitter counts as emitting (the maybe-emitting rule, as driven
   σ_s already does for scattering).
5. **Engine check (the one infrastructure unknown):** uniform ARRAY upload
   (`float[N]`) through PlannedUniform → executor. If absent, extend the uniform
   type vocabulary + setter — engine stays blind (a type case, not a concept).

**A1 — closures + minting** (gate: tsc + vitest)
1. Multi-path `PlannedUniform`s (the buildDrivenPlacement pattern): one per driven
   emission field (`u_<path>` vec3) + `u_light_cdf` / `u_light_selpdf` float arrays
   whose compute closure re-runs `computeSelectPdf` over live values. All
   `triggersReset`.
2. ParameterMetadata for the sliders (group from the param path, range from min/max).

**A2 — formatter slots** (gate: glslang + snapshots — existing scenes byte-identical;
kitchen-sink gains a driven-emission quad light)
1. The substitutions per the slot inventory; `light_get_<id>()` emitted only for
   driven lights; the `emitters.driven` flag threads to the three selection-read
   sites; verify the env two-stage row.
2. Dump review: read the emitted GLSL of a mixed constant+driven two-light scene —
   the diff vs its baked twin must be exactly the slot substitutions.

**A3 — witnesses** (owner runs the sweep)
| Witness | Proves | Check |
|---|---|---|
| LIGHT-DRIVEN | two-light scene, ONE light's emission driven, at its DEFAULT point ≡ the constant-authored twin — covers the ctor slot, both CDF arrays, the region Le agreement | twin (near-bit gates: same values, different plumbing — the `driven` witness's pattern) |
| LIGHT-DRIVEN-θ′ | same scene, param SET post-init to a value that RESHUFFLES the power ranking (the CDF coupling made visible) ≡ baked twin at θ′ | twin |
| LIGHT-OFF | the driven light at 0: image ≡ the one-light baked scene (zero mass never selected; the dead light costs nothing but noise) | twin, looser gates |
| mis arm | one of the above under pt-mis: the u_light_selpdf symmetry between sampler and lighting_pdf | equality nee ≡ mis |

Demo: glowblobs' ceiling panel graduates to an explicit quad light with the same
`lamp.power` slider + `sampleAsLight` semantics restored (NEE-quality convergence
returns; the chance-hit workaround notes in `demos/mediaScenes.ts` come out).

## Deferred (this batch's ledger)

| Item | Note |
|---|---|
| Stage B — driven light GEOMETRY | Position/size/direction via the Placement contract through the desugar path (sampler + pdf + area-power + intersection reading one driven frame); rigid-only per the transforms pin. |
| Stage A′ — driven sampleAsLight emitters | The material-emission route into the registry (census + desugar read a ValueParam); the explicit-light form covers the use case meanwhile. |
| Driven `selectWeight` / env split | The env-vs-finite stage-0 probability as a slider — same shipped-slot pattern if wanted. |

## What this batch must NOT do

No GPU-side derivation of any shipped value (the precompute-and-ship rule — misframe
tripwire: any new `if` in emitted selection code that isn't a slot substitution);
no geometry fields driven; no engine concepts (a uniform-array TYPE at most);
constant scenes byte-identical (snapshot-gated); the sweep is owner-run.
