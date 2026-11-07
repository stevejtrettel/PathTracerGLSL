# Check of "capability-tracking"

Checker script: check/checks.mts (float64), run from the repo with npx tsx. Repo HEAD is
0120472 (the notes say 818d433; the newer commit adds only trial HDRI assets, so no cited line
moved). Nothing in the repo was edited.

## Re-runs
- matrix.mts: re-run, prints the same table, "64 occupants in 18 registries" [checked-num].
- design1-mock.mts: re-run, prints the quoted diagnostic exactly [checked-num]. It is a toy of
  three hand-written entries; it shows the message format, nothing about the real registries.
- ideal-endpoint.mts: re-run, worst error 4.6e-13 (unseeded; notes say 2.4e-13; same size)
  [checked-num]. The formula is right [math: cosh t p + sinh t v = (e^t/2)(p+v) + (e^-t/2)(p-v)].

## Citations re-read (all correct unless listed below)
Validator.ts (src/compiler/analyze/Validator.ts) :56 :82 :299 :364 :484 :625 :675 :685 :706
:756 :896 :1045 :1056 :1153 :507 :547 :587 :595 :629 :646 :696 :714 :864 :867 :878 :903 :928
:941 :1007 :1210 :1466; descriptors.ts :9-12 :116 :124 :136-139 :218 :228 :248-251 :270-277
:287 :394 :405 :411 :420 :425 :445; geometry/index.ts:115-122; intersection/index.ts:186;
Planner.ts:558; env/index.ts:14-17; the GLSL readers intersection.ts:166,176, lighting.ts:119,
materials.ts:75,178, camera.ts:110, environment.ts:58, EnvironmentBake.ts:60, aov.ts:14,
core.ts:28; analyze/types.ts:3-7; sensor/index.ts:10,17; cie1931.ts:8; color/index.ts:14;
accumulator/index.ts:43; spectrumKind.ts:58; propertyValidation.ts:105; spectral.ts:11;
geometryContract.test.ts:66,67,121,126; spectrumDiagnostics.test.ts:147;
program-description.snapshot.test.ts:42; vitest 3.2.4 installed, toMatchFileSnapshot present.
The 12 directly imported component GLSL files: confirmed by grep of ?raw imports in src/compiler.
The 38 descriptor count (11+9+6+2+6+2+2) is right.

## Corrections

1. COUNT ERROR (labeled checked-num). The occupants without a glsl field are 3+2+3+2 = 10,
   not 8; so 54 (not 56) carry glsl. matrix-output.md itself shows 10 "no glsl field" rows.

2. WRONG CLAIM (labeled checked-code + math): "materials and phase functions call only
   ambient_dot, the frame and microfacet_to_local, so the same file is correct in every space".
   The files apply Euclidean normalize()/dot() to world Directions:
   lambert.glsl:23, checker.glsl:34, mirror.glsl:27, dielectric.glsl:31,39 (normalize);
   hg.glsl:13 and rayleigh.glsl:11 (raw dot(wi,-wo); hg.glsl:8 says the raw dot is forced);
   hg.glsl:33, rayleigh.glsl:28, core/microfacet.glsl:26 (normalize of a world vector).
   checker.glsl:34 is inside the very range the notes cite as evidence. In H³ (hyperboloid,
   Minkowski form) these are wrong at any point other than the origin: a Minkowski-unit tangent
   vector at distance d, after GLSL normalize(), has Minkowski length 0.887 (d=0.5), 0.648
   (d=1), 0.266 (d=2) [checked-num: checks.mts]. They still compile, which is the trap the notes
   warn about. In S³ (R⁴, Euclidean induced metric) normalize and dot on tangent vectors are
   correct [math]. So: sharing these bodies is valid in S³ as written; in H³ only if the design
   shades in a frame moved to the origin, or after the files are rewritten through ambient_*.
   That is a design decision the notes should name, not assume. ggx and rough_dielectric do
   their dot/reflect on local vec3s and are fine.

3. MISSED SITES, the most important gap: shared, always-linked GLSL with Euclidean distance.
   transport/shadow/opaque/opaque.glsl:17 and shadow/media/media.glsl:39 compute the shadow
   distance as length(light_p - origin) (media.glsl:23 says so). Every NEE program in the
   owner's subset (area/point lights) links one of them. Also equiangular.glsl:26-27,45 (raw
   dot; already Euclidean-only by a part-B row), core/ray.glsl, march.glsl, placement.glsl,
   microfacet.glsl. Design 1 has no place for these: they have no descriptor (part A) and are
   not optional features (part B rows). The matrix would show "sphere + lambert + point: yes in
   H³" while the shadow code is Euclidean. The design should state that every always-linked
   shared file must be made space-correct through ambient_* before any curved space is
   registered, and that this is checked by the curved-space witnesses, not by the table. The
   notes list these files under part B but give no row for them and do not say this.

4. ENVIRONMENT IN H³ IS OVERSTATED. The notes' "env charts reusable" is right for LOOKUP only.
   The map from a tangent direction at p to its ideal point is a Möbius map of S², not an
   isometry: its stretch along the boost is 0.38, 0.65 and 2.29 at d=1 (three angles) and
   0.14..2.90 at d=2 [checked-num: checks.mts]. So importance-sampling the sky
   (env/sampler_cdf.glsl, no descriptor) and its MIS pdf need this Jacobian in H³. The part-B
   row "environment: euclidean, hyperbolic" would claim support that does not exist yet.
   It also states hyperbolic env support twice (chart keys in part A plus the row); one answer
   per fact. A constant sky is fine in H³ (constant radiance; any tangent-direction pdf works).

5. merge.ts: "a provide nobody requires ⇒ dead-code error" is wrong. merge.ts:80-88 adds a
   WARNING ('seam-unused'), which is why 221 scenes warn about light_query_medium (CLAUDE.md).
   seam-conflict and seam-missing are errors (merge.ts:50-67).

6. Minor: EnvironmentBake.ts is in src/compiler (compiled there; the App runs it), not
   "App-side". "14 gates" counts :1153 as a gate in addition to resolveBackend; the
   Validator line is the gate and resolveBackend is its helper; harmless.

7. Minor math caution: I/sin²r is the irradiance along ONE geodesic. In S³ a point light at
   distance r is also reached along the opposite geodesic (length 2π−r), with the same sin²
   factor [math]. Not a capability-tracking issue, but the transport design must decide it.

## Over-engineering (owner wants the simplest design)
- Part B rows table naming 'bvh'/'table' in compiler code: the notes admit this is the CF-7
  smell. The P2 precedent they themselves call closest (sensor.colorModels) is simpler and
  more uniform: a `spaces` list on the GLSL-less estimator descriptors (LIGHT_SELECTIONS,
  MESH_TRAVERSALS, INSTANCE_ACCELS, OBJECT_DISPATCHES), checked by the same helper at the
  existing gates :625/:675/:685/:706. Rows would remain only for scene features with no
  descriptor at all (mesh objects, instanced objects, GRIN, tracking media). The Planner
  default at :558 still needs a separate check either way (a gate sees only explicit settings).
- The "absorb the scattered rules" option (extra read-only matrix columns for P2/P3 facts):
  not needed for H³/S³; drop it from this design.
- The checked-in snapshot matrix is modest and matches the owner's "keep track of who
  implements what"; fine. The per-(occupant, space) contract tests are fine.
- The GlslFile/origin change is needed only for bodies shared between spaces. After
  correction 2, sharing in H³ depends on a design choice; S³ sharing and env lookup still need
  it, so the change stands, but its justification should be restated.
- Size estimates (≈200 lines; design 2: 300-500) are labeled estimates; not verified here.
  The design-2 grep counts were not re-run.

## Verdict
The direction (design 1: a body keyed by space, "supports X" = "has a body for X", one gate
helper at the existing registry gates, no wildcard) is sound and is the simplest of the three
candidates. Citations are accurate. But two load-bearing claims are wrong: materials/phase
functions are NOT space-free in H³ as written (they use Euclidean normalize/dot on world
directions), and the always-linked shadow arms (opaque.glsl:17, media.glsl:39) are Euclidean
and are not covered by either part of the design. The H³ environment claim holds for lookup
only; sampling needs a Jacobian. The no-glsl count is 10, not 8. Accept with these corrections;
replace the part-B name table with P2-style `spaces` lists on the estimator descriptors.
