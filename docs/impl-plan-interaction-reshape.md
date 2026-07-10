# Impl plan — §10.1 item 1: reshape the surface interaction to §3.2

Reshape the surface material interaction from the slice's ad-hoc shape to the pinned
§3.2 contract. This is the "shape-setter" — the interface every future material fits.
Lambert itself is trivial (`weight = albedo`); the work is fixing the signature + laws.

**Provenance of this plan:** the interface (§3.1/§3.2), the dispatcher (§3.3), and the
Lambert body are transcribed from `fable-compiler-contracts.md` and
`fable-reference-implementations.md` §1. The transport call sites are transcribed from
`fable-reference-implementations.md` §5 (surface path only). Three deviations from Fable
are deliberate, agreed decisions (see Design). Everything not in scope is mapped to a
later item in **Deferred** below.

---

## Design (the locked signature)

```glsl
InteractionSample <m>_sample  (Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u);
Spectrum          <m>_eval    (Direction wi, Direction wo, Hit hit, MaterialProperties mp);
float             <m>_pdf     (Direction wi, Direction wo, Hit hit, MaterialProperties mp);
Spectrum          <m>_emission(Direction wo, Hit hit, MaterialProperties mp);
struct InteractionSample { Direction wi; Spectrum weight; float pdf; uint flags; };
```

- **sample-returns-weight** (`weight = f·|cosθ|/pdf` inside; Lambert = albedo exactly) **+
  separate `pdf`** — delta-safe, honest `pdf=0` for deltas.
- **bare-`f` eval, cosine applied in transport** (§2.2) — enables surface/medium unification.

**Deviations from Fable (agreed decisions, not the doc):**
1. `sample`'s `vec2 xi` → **`(float uc, vec2 u)`** (lobe-select + direction; keeps QMC
   transport-controlled). Consequence: transport passes `random(), random2()`.
2. **`LOBE_NULL` dropped** → a compile-time `is_null_interface(hit)` predicate (arrives with
   media). Committed flags: `REFLECTION`, `TRANSMISSION`, `DELTA`, `MEDIUM`.
   `GLOSSY`/`DIFFUSE` deferred (no reader until regularization).
3. **No `TransportMode`/`eta`** — light tracing is infeasible in WebGL2 (fragment shaders
   can't scatter); always radiance-mode. Belongs to the future WebGPU tracer.

---

## In scope for item 1

1. **New `interaction.glsl`**: `InteractionSample` struct + `LOBE_REFLECTION/TRANSMISSION/DELTA/MEDIUM`.
2. **New spectral helpers** (§2.5, currently missing): `SPECTRUM_ZERO=vec3(0)`, `SPECTRUM_ONE=vec3(1)`,
   `spectrum_average`, `spectrum_is_black`. Add to `math.glsl`. (`PI`/`TWO_PI`/`EPSILON` already exist.)
3. **Reshape `lambert.glsl`** to the four functions (transcribe reference-impl §1; `u` for
   direction, `uc` ignored; `emission = mp.emission * mp.emission_strength` — fixed-struct form).
4. **Generated dispatcher** (`materials.ts`, per §3.3): `interaction_surface_{sample,eval,pdf,emission}(int mat, …)`,
   switching over models present. One arm for Lambert-only; dielectric is additive later.
   **Keyed on `hit.material_to`** (current `Hit`) — NOT region identity (that's item 2).
5. **Reshape `path_trace.glsl` call sites** to the §5 surface form, minimal version (current
   `Hit`, current `lighting_sample`):
   - emission: `radiance += throughput * interaction_surface_emission(hit.material_to, wo, hit, props);`
     (added unconditionally — the §6.2 one-sided/MIS gating is deferred)
   - NEE: `f = interaction_surface_eval(...)`, **explicit `* abs(dot(ls.wi, hit.frame.n))`**, `/ ls.pdf`
   - BSDF: `InteractionSample bs = interaction_surface_sample(..., random(), random2()); throughput *= bs.weight;`
     `if (spectrum_is_black(bs.weight)) break;`
6. **`prev_was_delta` hook (included, per decision)**: `bool prev_was_delta = true;` init,
   `prev_was_delta = (bs.flags & LOBE_DELTA) != 0u;` after each BSDF sample. **Tracked but not
   yet consumed** — its readers (env-samplable weight, emission MIS weight) are deferred (§6.2/§8).
   Included now because it's the seam MIS will need and it's one bool; documented as inert for Lambert.

---

## Deferred — NOT in item 1, must plan for later

Every line the faithful §5 loop needs that item 1 does **not** implement, mapped to its home:

| Deferred piece | Why not now | Lands in |
|---|---|---|
| **Region identity** — `material_of`, `hit_owner_region`, `hit.region_to/from`, `light_of` | current `Hit` has only `material_to/from`; item 1 keys the dispatcher on `material_to` | **§10.1 item 2** (Hit → `region_from/to` + `material_of`) |
| **Emission one-sided rule** — key on `region_to`, `(emat==mat)` fetch, exit-interface = 0 | needs region identity; item 1 adds emission unconditionally (correct for opaque emitters hit from outside) | item 2 + §6.2 |
| **MIS weights** — the `w = … ? 1.0 : 0.0` scaffold on emission + env | no MIS in the slice; NEE-only. `prev_was_delta` is pre-threaded for it | **§8 (MIS)** |
| **Compile-time material gates** — `material_is_emissive`, `material_has_nondelta_lobes` | need the TS material **descriptor** (capability flags); no reader until item 2 | item 2 (descriptor) |
| **TS material descriptor** — `{reads, delta, transmission, emissive}` | its flags' only consumers are the gates above; adding now = unused code | item 2 |
| **Explicit `xi` to `lighting_sample`** (§2.9) | current `lighting_sample(p)` draws internally; §5 wants `lighting_sample(p, random2())` | **§10.1 item 3** (LightSample → CDF) |
| **`shadow_transmittance`** (media-general visibility) | no media; item 1 uses boolean `scene_intersect_any` | media item |
| **`current_medium` tracking + `LOBE_TRANSMISSION` → `region_to`** | no media; transmission not reachable with Lambert | media item |
| **Null interfaces** — `is_null_interface(hit)`, the null-crossing branch | no bounded volumes yet; `LOBE_NULL` already dropped to this predicate | media item (§3.6) |
| **Curved-space geometry** — no stepper (`GeodesicState` retired); `Ray` seed + `ambient_geodesic` | item 1 uses the Euclidean offset | curved-space item |
| **Generated `MaterialProperties`** (§3.4, per-scene field union) | keep the fixed struct (`albedo/emission/emission_strength/roughness`) | §3.4 |
| **Spectral** — `Spectrum` as anything but `vec3` | typedef discipline only; RGB now | later strategy axis |
| **`LOBE_GLOSSY` / `LOBE_DIFFUSE`** | no reader (path regularization/guiding not built); flags are non-breaking to add | when regularization lands |
| **Stochastic-eval BSDFs** — `eval` needing `xi` | closed-form only; tabulate layered materials (LUT) | explicit "break the signature" exception |
| **`TransportMode` / `eta`** — adjoint/importance transport | light tracing infeasible in WebGL2 (no scatter) | the future WebGPU tracer |

---

## Verification

- **Snapshot** (`generated-glsl.snapshot.test.ts`) will legitimately diff — review that it's
  exactly the interaction reshape (new `interaction.glsl` block, reshaped `lambert`, reshaped
  `path_trace`, generated dispatcher), then `npx vitest run -u`.
- **Typecheck** clean (`materials.ts` dispatcher generation is the only TS change).
- **Live GPU** (the real gate): render Cornell, confirm it still converges correctly and is
  **energy-conserving** — a sample/eval/pdf inconsistency biases the image here. Playwright
  capture pattern from the RNG session works (drive `channel:'chrome'`, read `app.readExport`).
  The §11.1 furnace test (0.4 exact) is the eventual automated form.

---

## Open decisions for implementation

1. **Descriptor: defer to item 2 (recommended).** Its capability flags have no reader until
   item 2's gates exist; adding now = unused code (the RNG episode's lesson). The dispatcher
   uses the existing `plan.program.materials.models` list, no descriptor needed.
2. **RR uses `spectrum_average`** (per §5's `russian_roulette`) vs the current `luminance` —
   switch to `spectrum_average` for the §5 form, or keep `luminance` and defer. Trivial.
3. **Emission added unconditionally** in item 1 (no `material_is_emissive` gate yet) — correct
   for Lambert + point light; the gate + one-sided rule arrive with item 2.

Related: `fable-compiler-contracts.md` §3, `fable-reference-implementations.md` §1 & §5,
`docs/deferred-owen-sobol-sampler.md` (parked, unrelated).
