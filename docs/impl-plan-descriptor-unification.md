# impl-plan-descriptor-unification — one descriptor grammar, doors open everywhere

**ALL FIVE BATCHES BUILT Jul 19 2026** — 1031 vitest green (glslang incl. the kitchen
sink), tsc clean; snapshot churn across the whole pass = exactly one class (the new
`measurement.ambient` decision ×125 program records); emitted GLSL byte-identical for
D1/D2/D3/D5 (snapshot suites passed un-re-goldened), D4's alpha rewiring exercised by
the kitchen-sink compile (no snapshot scene carries ggx). GPU witness sweep = owner's
(nothing in the pass should move a rendered number; flatten-tree name churn is
image-neutral). Build notes inline per batch below.

Owner-decided Jul 19 2026 (from the Jul 18 audit, front 4 — full findings:
docs/fable-audit-2026-07-18.md). The four decisions:

1. **Open ALL the doors — no more unions.** Lights, camera, tonemap, accumulation:
   registry-keyed strings gatekept by schemas, like materials/primitives already are.
2. **Carve the doorless registries NOW** (ambient ahead of the first curved-space
   occupant; accumulator + env charts kill their if-chains). Intersection HELD for the
   BVH/mesh batch — the real second backend shapes that registry.
3. **Derived values for materials** — the CameraDerived rail ported to the schema.
4. **Family name: `volume_scattering/`** (folder stays; type/registry names converge on
   it; `volumetric/` rejected as too broad — collides with transport/volume/).

The organizing principle: **converge the VOCABULARY, not the type.** One shared row
grammar — name, shape, kind, required-XOR-default, declarative constraint, derived
compute — across every family; each family keeps its own FACTS (geometry's folds,
lights' desugar, camera's controls). Rules a machine can read (data) over rules it can
only run (code): one checker, one error voice, one contract test, UI-consumable ranges.

## D1 — the row grammar (foundation; everything else builds on it)

- ONE constraint vocabulary: geometry's `constraint?: { kind: 'positive' |
  'positive-components' | 'min-length', … }` becomes the shared spelling in
  descriptors.ts. Materials' `domain:` migrates onto it; the sphere/disk lights'
  hand-written positive-radius / nonzero-normal checks become rows. `validateAuthored`
  survives ONLY for genuinely coupled rules (quad parallel-edges, spot
  `falloffStart < angle`).
- `authoredParams` gains `default?` and `kind?` slots (required XOR default, the
  geometry discipline). The disk light's `?? DEFAULT_NORMAL` at two sites collapses
  into its row — the sample-side/hit-side silent-disagreement class dies.
- Kinds-imply-shapes contract test extends to light rows (today `kind:'point',
  shape:'number'` would pass).
- New `ParamKind` **`'area'`** (scales s² under similarity) — the quad light's derived
  `area` field stops being declared `'length'` (a wrong fact sitting on the rail the
  Value<T>-light-transform table will make load-bearing).
- One shared row-grammar contract test applied per family (replaces the per-family
  near-copies).

Gate: tsc + vitest; emitted GLSL byte-identical (validation/vocabulary only).

## D2 — doors open at the type level (B1 everywhere)

- `LightDescription` → `{ kind: string; … open record }` (materials' precedent).
  `DirectionalLight` dies as a type; the Validator's reserved-'directional' message
  stays (it is name-based). The lights door test drops its `as unknown as` cast — the
  cast's disappearance IS the proof.
- `CameraDescription` / `DisplayDescription` / accumulation → open `{ type: string, … }`
  shapes; registries re-keyed `Record<string, …>`; each camera model declares an
  authored-input schema (authoredParams-style) so the validation the unions used to do
  moves to the Validator with real messages. The vestigial `Value<>` spelling on camera
  fields dies here (every camera control is live by the instrument principle).
- The hand-mirrored `CameraDesc`/`TonemapDesc`/`AccumulationDesc` in plan/types are
  DELETED — plan types import the one authored shape.
- Key-matches-id and derived-`origin` (registry key → path, the materials way) enforced
  for every family; hand-written `origin` fields removed. Stale tonemap-header
  allowlist comment fixed.

Cost accepted (owner-decided): authoring loses union autocompletion/typo-squiggles for
these families; scene/strategy validation owns it with better messages.

Gate: tsc + vitest; snapshot churn = none expected (types only); door tests per family.

## D3 — registries for the doorless families (byte-identical carves)

- **ambient/index.ts** — the non-Euclidean seam gets its door BEFORE the first
  curved-space occupant (the GGX lesson: the first tenant should walk through a
  finished front door). Keyed by `ambientSpace.type`; `euclidean` sole occupant;
  core.ts's direct import dies.
- **accumulator/index.ts** — average/variance/oneshot; descriptor facts carry what the
  if-chains encoded (occupant path/glsl, reads-previous, reads-moment/MRT);
  accumulation.ts's three type-switches collapse to registry reads.
- **env chart registry** — equirect/octahedral descriptors; environment.ts's ternaries
  and EnvironmentBake's chart pick route through it (also the clean substrate for the
  octahedral-bake bug fix, ledgered for the compiler pass).
- **intersection: HELD** for BVH/meshes (with `backends: {…}` honesty — audit M8).

Gate: emitted-GLSL hash-identical across all registry pairs (the components-move gate).

## D4 — derived values for materials (the CameraDerived port)

- `MaterialModelDescriptor` gains `derived?: [{ name, glslType, inputs: [row names],
  fn }]` — a pure function of schema rows, computed host-side: baked as a literal for
  constant inputs, a compute-closure uniform for driven ones (the u_majorant /
  u_fisheyeK pattern; `fn` runs for BOTH the plan default and the per-frame value so
  they cannot drift). The derived field lands in MaterialProperties like any row
  (storage 'field').
- First occupant: ggx's `alpha = max(1e-3, roughness²)` — declared once, the three
  in-shader computations become `mp.alpha`; ggx.test.ts twin updated in lockstep.

Gate: tsc + vitest + glslang; ggx twin green; snapshot diff = the alpha rewiring only.

## D5 — hygiene sweep (mechanical)

- Naming: folder stays `volume_scattering/`; `PhaseModelDescriptor` →
  `VolumeScatteringModelDescriptor`, `PHASE_MODELS` → `VOLUME_SCATTERING_MODELS`; GLSL
  symbols (`hg_*`, `rayleigh_*`) and row names (`phase_g` — the physics word for the
  parameter) unchanged. Stale headers fixed ("HG sole occupant" above rayleigh; hg.ts's
  dead filename). CLAUDE.md conventions updated (`phase/` → `volume_scattering/`,
  `film/` → `accumulator/` + `sensor/` + `tonemap/`).
- `lights/power.ts` hosts `radiantScalar` (breaks the index↔occupant ESM cycle;
  basis.ts/similarity.ts precedent).
- Duplicate `Vec3Tuple` (octahedral.ts) imports similarity.ts's.
- `materialsContract.test.ts` splits per family (a lights-door regression should not
  fail a file named "materials").
- `flattenGroups` leaf names become path segments like group names (two `ball` leaves
  in different groups get distinct names, diagnosed by flatten itself); flatten-tree
  witness re-checked.
- Camera param paths standardized model-prefixed (`camera.fisheyeFov` pattern wins;
  thinlens/ortho generic names migrate) — small witness/demo param churn, done here.
- Registry-order load-bearing notes documented AT the registries (geometry's style).

Gate: tsc + vitest; snapshot diff audited (renames only); flatten-tree witness.

## Sequencing & pass-level gates

D1 → D2 (schemas must exist before types stop validating) → D3/D4 (independent, either
order) → D5. Each batch: tsc + full vitest + snapshot-diff class audit. Owner witness
sweep ONCE at pass end (D3's hash gate and D4's ggx twin are the sharp edges; nothing
in the pass should move a rendered number).
