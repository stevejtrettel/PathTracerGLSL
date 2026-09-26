# Batch 5 plan — tests that can't fail (review Part 3)

**Status:** done Sep 26 except 5.5 (paused; see below) and the three owner items (2269993 …
18a6051; CHANGELOG "review batch 5"). The owner approved doing the test-only work directly ("if
this is test stuff do it"). This plan records the re-check of every Part 3 item, the test-only steps, and the items that
need production code, which come back to the owner and are not done here. All line numbers are at
ef5cfdd. "Confirmed" means read in the code, with complete searches.

**How every new or changed test is shown to be able to fail.** Each is run against a deliberately
broken version of the code it guards: the bug put back, or a plausible regression. It must fail
there and pass on the real code. The breakages are temporary and never committed; each one is
recorded here and in the CHANGELOG.

---

## Re-check

| # | Review claim | Finding |
|---|---|---|
| 1 | `mesh-light-smooth` guards the spawn rule, not the MIS pdf's normal | **Confirmed** (CHANGELOG): no fix, mis 5% bright; pdf fix alone, 4.95%; spawn fix too, agree. The pdf-normal fix is worth about 0.05% in this scene, below its noise, so no tolerance on this scene can guard it. Its description (index.ts) still claims it guards the pdf. |
| 2 | No witness checks the bounce limit inside media at small `maxBounces` | **Confirmed**: every medium witness runs at a large budget. The fog branch's budget is one line (pt.ts:361, `if (bounce == N) break;`). |
| 3 | `null-budget`'s pt tripwire is at 1.2× its noise, against the README's ~1.5× | **Confirmed** (CHANGELOG): measured rmse 64.5% (default budget) and 74.4% (budget 11), both gated at 90%, which is 1.40× and 1.21×. |
| 4 | Rough glass's η = 1 test exercises the twin's own branch | **Confirmed**: it checks that the test file's own `if (eta === 1.0)` shortcuts return what they return. |
| 5 | The light census test compares the roster with values built from the roster | **Confirmed**: `PlannedLight.values` are the roster's values passed through (Planner.ts:296–335), so lightCensus.test.ts:80 and :98 compare a thing with itself. |
| 6 | The CWBVH test asserts `order.length`, which is always n | **Partly**: in the structure test (cwbvh.test.ts:61) the next line checks the full permutation, so that test can fail. In the coincident-centroids test (:261) the four-identical-boxes half checks only the length, which is n by construction (`new Uint32Array(n)`). |
| 7 | Tiled rendering's pixel identity is claimed but untested | **Confirmed**: CLAUDE.md already says it was checked once by hand. An automated check needs a GPU (the witness runner), so it is infrastructure, not a unit test. |
| 8 | The procedural-environment Validator test passes the wrong `params` shape behind `as any` | **Confirmed**: validator.test.ts:856 passes `params` as an object keyed by name; the type is an array of `{ param, default }` (types.ts:291). |
| 9 | A `{param}` fov's slider range is not checked against (0, π) | **Confirmed**: only the default is checked (Validator.ts:800). The fix is a Validator rule, which is production code. |
| 10 | The PNG encoder's multi-batch path and the RGBE negative clamp are untested | **Confirmed**: the PNG test image (37×23) fits in one ~1 MiB batch, so the Paeth filter's carry of the previous row across batches never runs. No test gives `floatToRGBE` a negative channel. |

---

## Steps (test-only; one commit each)

- **5.1 CWBVH, coincident boxes** (cwbvh.test.ts:261). Check that the order is a permutation of
  0..3, as the other half of the test already does.
  *Breakage:* the builder writes item 0 twice.
- **5.2 Procedural sky params** (validator.test.ts:854–859). Use the real `params` shape (an array,
  no `as any`), and add the empty-list case, which must be accepted.
  *Breakage:* the rule inverted to fire only on an empty list.
- **5.3 RGBE negative channel** (fileExport.test.ts). A pixel with a negative channel encodes that
  channel as 0, not 230.
  *Breakage:* the `Math.max(0, …)` clamp removed.
- **5.4 PNG across batches** (fileExport.test.ts). Round-trip an image several ~1 MiB write batches
  tall through the independent decoder.
  *Breakage:* the Paeth filter's previous row reset to zero at each batch start.
- **5.5 Rough glass at η = 1** (rough_dielectric.test.ts). Replace the self-check with a limit
  check: at η = 1 ± 10⁻⁴ the general (non-shortcut) branch sends every sample to within a small
  angle of −wo with weight → tint, which is what the η = 1 shortcut returns.
  *Breakage:* the shortcut's weight or direction changed.
- **5.6 Light census against the planned surface** (lightCensus.test.ts). For emissive sphere,
  quad and disk objects (translated, rotated, scaled; scalar, vec3 and blackbody emission) and an
  emissive mesh, the roster's light values must equal the kind's `valuesFromRegion` applied to
  the **planned object's** parameters and the **planned material's** emission. The two
  tautological assertions are replaced.
  *Breakage:* the roster's emission resolution, then its placement fold, broken in turn.
- **5.7 `mesh-light-smooth`'s description** (index.ts): say it guards the spawn rule. The
  pdf-normal fix has no witness (see "For the owner").
- **5.8 `null-budget`'s pt tripwires**: 1.5× the measured rmse, per the README rule: 97% at the
  default budget, 112% at budget 11. The Δmean gates (3%) are unchanged; those are the real bias
  checks.
- **5.9 New witness `emit-sat-budget`**: the `emit-sat` fog (ε = (1, 2, 4), σ_a = 2, σ_s = 1,
  α = 1/3, camera deep inside, pt with delta tracking, RR off) at `maxBounces` 0, 1 and 2. Exact:
  L_N = (ε/σ_t)·Σ_{n=0}^{N} αⁿ:
  - N = 0: (0.33333, 0.66667, 1.33333);
  - N = 1: (0.44444, 0.88889, 1.77778);
  - N = 2: (0.48148, 0.96296, 1.92593).

  Tolerances come from a three-salt spread measured first.
  *Breakage:* the fog branch's budget off by one (pt.ts:361, `bounce + 1 == N`). N = 1 must then
  read 25% low. Rendered with the Mac kept awake.

---

## Paused while building

- **5.5 is paused: its premise was wrong.** Measured with the twin: at η = 1 ± 10⁻⁴ the general
  branch's samples do converge on −wo (within ~0.01 rad), but its weight does not converge to the
  shortcut's full transmission. For (cos θ, roughness) = (0.9, 0.3), (0.3, 0.8), (0.1, 0.9) the
  mean weight is 0.999, 0.612, 0.219 — the microfacet masking loss. So the rough dielectric is
  discontinuous at η = 1: nearly index-matched rough glass transmits 22–61% at grazing
  incidence, exactly matched glass 100%. The shortcut is the physical answer (no interface), not
  the model's limit, so a limit test cannot back its weight. For the owner: keep only a
  direction-limit test, or treat the discontinuity as a modelling question first.

## For the owner (not done here)

1. **The fov slider range (item 9)** — **approved Sep 26**, done as 5.10. The rule: a `{param}`
   camera row's slider bounds (`min`, `max`) must satisfy the row's constraint, as its default
   already must. Only `fov` on pinhole and thin-lens is such a row, with the open interval (0, π).
   - Without both bounds the panel shows a free number box and the value is unchecked, so a
     missing bound gets a warning (precedent: a driven scale without a positive `min` warns).
   - Boundaries: the camera loop in Validator.ts, and validator.test.ts.
   - Tests first; they fail today.
   - All 20 slider-driven fovs in the suite declare bounds inside (0, π), so no scene gains a
     diagnostic.
2. **Tiled rendering (item 7)**: an automated pixel-identity check means teaching the witness
   runner to render a scene in tiles and compare it with a one-piece render. That is test
   infrastructure, but a new feature of the runner. Do it, or leave it as checked once by hand?
3. **A witness for the mesh light's pdf normal (item 1)**: in the one scene we have, that fix is
   worth about 0.05%. A witness that isolates it would need a scene built to make the shading and
   true normals disagree where both MIS techniques matter. That is research with an uncertain
   outcome. Want it?
