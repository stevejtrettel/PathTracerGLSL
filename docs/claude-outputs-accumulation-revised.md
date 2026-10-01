> **SUPERSEDED (2026-09-29).** Merged into `claude-outputs-accumulation.md`, which is now the
> one plan. This draft is kept only as the record of that review. Do not implement from it.

# Outputs and accumulation: revised plan for review

**Date:** 2026-09-29
**Status:** Review draft transcribed from the owner's conversation. Not approved for
implementation. No renderer code has been changed for this plan.

Read `../CLAUDE.md` first. The original design and owner decisions are in
`claude-outputs-accumulation.md`, especially §§3.4 and 3.6. This is a consolidated
candidate replacement, not another set of amendments to implement alongside that
document. Until the owner approves it, the original owner decisions remain authoritative.
After approval, consolidate the authoritative document and retire this draft.

The owner requested an in-depth review and then a revised plan, not implementation.
Independent architecture, numerical, and verification reviews informed this draft.
**Read** means checked in source. **Expected** means a prediction that implementation
must verify. No tests, renders, or performance measurements were run for this revision.

## Questions awaiting the owner

These recommendations are proposals, not accepted decisions:

1. **Automatic saving:** when production finishes, should the automatic main-image save
   always save radiance even when another picture is displayed? Recommended: yes;
   manual saving still follows the displayed picture. In the implementation, identify
   the main picture from its declared role/order rather than testing its name.
2. **Switching during production:** should the displayed picture be switchable while
   production is running? Recommended: yes, while fixing the picture chosen for a tiled
   export for the entire job.
3. **Raw normal files:** until a signed file format is supported, should raw normal
   saving be unavailable? Recommended: yes; mapped PNGs and raw in-memory reads remain
   available. This concerns new data-picture exports and does not silently change the
   existing spectral-radiance HDR-export policy, which also encounters signed values.

The mathematical meaning and implementation of medium-aware guides remain an explicit
step-6 planning gate; see §6. Do not treat the category wording below as a proof of their
estimator invariance.

## 1. Objective

Give the renderer one consistent way to keep, display, read, and save its per-pixel
pictures. Then add OIDN using those pictures.

Preserve the Monte Carlo calculation, keep the engine independent of rendering
algorithms, and derive each repeated decision from one declared fact.

The initial pictures are radiance, optional variance, and optional albedo and normal
guides. No render may request more than four pictures.

## 2. Separate a picture's meaning from its output role

| Question | Categories |
|---|---|
| What does the quantity describe? | A measurement of the scene, or a diagnostic of the calculation |
| What role does its output have? | The main picture, or an additional picture |

Radiance and its physical decompositions are scene measurements. Variance, sample count,
elapsed time, and executed-work counters describe the calculation. A weighted observable
of physical path length is different from a count of executed bounces.

“First-hit” describes where a value is obtained. “Auxiliary” describes its output role.
Neither, by itself, determines its mathematical meaning.

**Read:** Mitsuba exposes moments through its auxiliary-channel interface and supports
depth both as a main result and an auxiliary output. Cycles includes sample count among
data passes. These sources support separating the questions rather than treating their
terminology as a universal taxonomy:

- [Mitsuba moments](https://github.com/mitsuba-renderer/mitsuba3/blob/fd9c9ceb38deb511a5c3f8479c8b14c0b552167e/src/integrators/moment.cpp#L94)
- [Mitsuba depth](https://github.com/mitsuba-renderer/mitsuba3/blob/fd9c9ceb38deb511a5c3f8479c8b14c0b552167e/src/integrators/depth.cpp#L37)
- [Cycles passes](https://github.com/blender/blender/blob/v4.5.0/intern/cycles/scene/pass.cpp#L63)

The convergence rule must be precise: changing the estimator preserves the defined scene
measurements. Diagnostic pictures may change because they describe that estimator.
Any amendment to the pinned taxonomy needs the owner's approval.

For this implementation, keep `measurement.response` for the main radiance measurement,
`measurement.aovs` for requested first-hit guides, and variance under accumulation.
Future debug outputs get a mathematical definition before receiving an API home.

Medium-aware guides require a mathematical specification: they depend on sampled medium
histories as well as camera rays. Step 6 must establish their intended expectation and
check that the capture rules implement it.

## 3. One ordered picture list

The Planner produces the complete list in this order:

1. Main picture.
2. Requested estimator statistics.
3. Requested AOVs, in authored order.

Each entry supplies the facts needed for its sample, update, storage, and display. Names
come from the producing component's declaration.

Generate from this list:

- Accumulation attachments and shader outputs.
- Previous-frame texture inputs.
- Accumulation statements.
- Export targets.
- Display inputs and selection.
- The after-frame view recipe.

Names must be unique. Unknown requests, duplicates, unsupported statistics, and more than
four pictures are compiler errors.

Every accumulation mode keeps its existing ping-pong pair. `oneshot` loses its unused
previous-frame input.

One compiler function determines a picture's buffer reference: current during the frame,
previous after the swap. Display, redraw, and exports use that function.

## 4. Explicit accumulation rules

`average` keeps an equal-weight running mean. `oneshot` keeps the latest sample. Variance
becomes an option supported by `average`.

Component descriptors declare supported statistics. The compiler checks that declaration
rather than inferring support from whether a mode reads history.

Camera sampling and radiance conversion are generated once. Numerical update rules remain
static GLSL in the accumulation components.

| Picture | Update inputs |
|---|---|
| Radiance | Converted radiance sample and previous mean |
| Variance | Same sample, previous mean, newly calculated mean, previous variance |
| Albedo | Captured albedo sample and previous albedo |
| Normal | Captured normal sample and previous normal |

Write out this four-picture example in the step-4 plan before implementation. Show
initialization, update order, and how every input is obtained without picture-name tests.
Also show the `oneshot` case. The main-first order accommodates the known dependency.

**Read:** existing variance stores `M2/n`. Preserve this convention and the existing
Welford arithmetic. The witness uses the stored value divided by `n - 1` to estimate
variance of the mean (`tools/witness.mjs:263`). Do not change normalization in the refactor.

AOV values bypass `color_to_pixel`, which applies sensor response even in the RGB
implementation (`src/components/color/rgb/rgb.glsl:7`). Misses contribute zero and still
count as samples. Averaged normals are not renormalized.

## 5. Generic compiled contract and engine

Picture metadata rides on named export targets. There is no second named picture
collection.

The contract states that picture entries preserve planned order and that the first
picture-bearing entry is main. This supplies the default selection and the meaning of
“extras” without an App-side radiance-name test.

Picture metadata is optional. The environment bake remains a renderer with an ordinary
table export and no picture selector.

The view recipe explicitly relates its render target to its named display export. Do not
assume a framebuffer ID and export name match (`src/compiler/types.ts:1083`).

Extend compiled validation to cover ordinary passes, texture inputs, export targets, and
view recipes. Check attachment ranges, valid buffer suffixes, the four-picture limit, and
the existence of the referenced pass and target.

Only picture-backed display inputs move to post-swap buffers. External inputs such as
blue noise remain unchanged.

## 6. Complete AOV capture definition before implementation

Guides are RGB-only initially. Transport returns them through explicit `out` parameters
generated only for programs requesting them.

Capture draws no random numbers and does not change radiance throughput, sampling, or
event decisions.

The accepted defaults, with the termination cases identified by review made explicit:

| Outcome before a guide has been captured | Guide result |
|---|---|
| First eligible surface after null interfaces | Material albedo and shading normal facing the incoming ray |
| Miss | Zero |
| First medium scattering event | Zero |
| First GRIN traversal counted as an event | Zero |
| Sampled absorption termination or GRIN no-return | Zero |

Ordinary attenuation through an absorbing medium does not itself mean the ray terminated.
If the walk reaches a surface without an earlier qualifying event, that surface remains
eligible. Once a surface has been captured, later scattering, absorption, or termination
does not erase its guides.

Albedo uses the accepted material conventions and is clamped to `[0,1]`:

| Material | Guide value |
|---|---|
| lambert | albedo property |
| checker | its existing albedo function |
| mirror, ggx | normal-incidence reflectivity property `f0` |
| dielectric, rough_dielectric | transmittance property |

These are this renderer's chosen guide definitions, not claims of numerical equivalence
to every reference renderer. Visible area lights retain their zero-albedo convention.
Normals use the shading normal with an explicit facing operation through `ambient_dot`.
Mirrors and glass use their own surface guides. Following specular chains remains deferred.

**Read:** medium results can represent termination using zero weight without a separate
termination flag. The transport can then fall through to its earlier straight-ray
intersection. Reaching surface-material evaluation therefore does not establish that the
surface was reached:

- `src/components/transport/volume/delta_tracking/delta_tracking.glsl:97`
- `src/components/transport/volume/grin/grin.glsl:165`
- `src/components/transport/integrators/pt/pt.ts:332`

Before coding step 6, its plan must specify how actual surface arrival is distinguished
from medium termination. Zero radiance throughput is not a general surface-validity
test. The plan must explain the near-wall GRIN pass-through case and prove that programs
without AOVs remain byte-identical. The representation of this distinction remains to be
designed and reviewed; no shared transport-interface change is implicitly approved.

The same plan must define the guides' expectation in scattering media. If existing
sampling rules cannot implement the accepted meaning, stop and bring that specific
conflict to the owner.

**Reference qualification:** pbrt supports explicit surface information, but does not
develop all G-buffer channels with identical averaging rules. It divides albedo by total
weight, position/UV by valid-surface weight, and normalizes normal sums. Its variance
update is conditional on a valid visible surface. Preserve this renderer's accepted
definitions rather than silently importing those differences:
[pbrt film](https://github.com/mmp/pbrt-v4/blob/b4ce9687e6c695f5582997c61b0c66cf064bdb4a/src/pbrt/film.cpp#L739).

## 7. One view operation for screen and PNG

Persistent selection is the picture's name in `renderer.picture`.

Generate name-to-index conversion once through the existing uniform-binding mechanism.
The App obtains available names from compiled metadata.

The engine receives a generic request to execute the declared view recipe into a target.
It does not interpret picture names.

Redrawing or saving a PNG must not trace a sample, swap buffers, reset accumulation, or
change the random salt. A temporary export selection uses scoped parameters for that
draw; it does not change and later restore persistent selection.

| Picture | Display mapping |
|---|---|
| Radiance and variance | Strategy exposure and tonemap |
| Albedo | Clamp, then sRGB encoding |
| Normal | `0.5 * normal + 0.5` |

**Pending owner answer:** allow switching during production. If accepted, permit only
this control through the existing parameter-update path while retaining the production
lock on render-changing controls. Do not broadly exempt every non-resetting parameter.

Tiled output selection is fixed when the job starts. Later on-screen selection cannot
change which picture subsequent tiles save.

## 8. Unambiguous saving behavior

Manual saving uses the selected picture. Explicit named reads remain available for
consumers such as OIDN.

**Proposed, pending owner answer:** automatic main-image saving always saves main.
Saving extras excludes main, preventing duplicate saves.

Every saved image records the actual picture captured. Capture its stamp with its pixels
rather than infer it later from the current selection.

Batch capture reads all required buffers synchronously before asynchronous encoding
begins. This preserves a coherent snapshot while rendering continues.

**Proposed, pending owner answer:** raw normal saving is unavailable until a signed
format exists. Mapped PNGs and raw in-memory values remain available. Batch saving
identifies unsupported outputs explicitly. Its precise reporting/failure policy belongs
in the step-5 plan; it must neither silently corrupt a picture nor claim every picture
was saved.

Spectral radiance can also contain negative RGB values. The proposal concerns introducing
raw data-picture exports and does not silently change existing spectral HDR-export policy.

## 9. Verify comparison tools before relying on them

Add a separately approved preparation step before changing renderer behavior.

The frame tool records raw float pictures, display pixels, dimensions, picture identities,
sample count, salt, and runtime configuration. Retain arrays as well as hashes.

Equality means exact picture and display-pixel equality. Check PNG stamps separately;
whole-file equality is not the image invariant. **Read:** stamps contain time, Git
revision, and strategy (`src/app/App.ts:870`, `src/app/utils/file-export.ts:23`).

Failures report affected picture, changed-pixel count, largest difference, and nonfinite
values.

Use representative average, variance, `oneshot`, spectral, medium/GRIN, and tiled cases.
Ordinary fixtures can use 64×64 at 8 spp with a pinned salt. The tiled fixture needs
larger, nonmultiple dimensions and an explicit tile size to exercise multiple tiles and
partial edges. **Read:** tile sizes round upward to multiples of 64
(`src/app/tiling.ts:43`), so a 64×64 image cannot exercise multiple tiles.

Before trusting the tool:

- Repeat an unchanged render and establish reproducibility.
- Verify that an intentionally changed recorded pixel is detected.
- Verify that different metadata does not cause a false image failure.
- Verify that nonfinite output is rejected.

Extend digest tooling to retain inspectable before-and-after structural output. A later
“show” command cannot reconstruct an old structure from its hash
(`scripts/digest-compiled.ts:54`).

## 10. Separately approved implementation steps

| Step | Work | Written prediction |
|---|---|---|
| 0 | Comparison tools and inspectable digest output | Renderer compilation and behavior unchanged |
| 1 | Rename the radiance export | Shaders and pixels unchanged; export identity changes |
| 2 | Make variance an `average` option | Equivalent strategies retain identical mean and variance |
| 3 | Introduce planned picture list | Declared structural changes only; pixels unchanged |
| 4 | Generate accumulation `main()` | Shader text changes; numerical results remain identical |
| 5 | Picture selection, view recipe, saving, stamps | Accumulated pictures unchanged; display behavior expands |
| 6 | Albedo and normal AOVs | Disabled programs unchanged; enabled capture preserves radiance |
| 7 | OIDN integration | Raw accumulated pictures unchanged |

The rename targets export identity only. Preserve file formats, extensions, HDR
color-control metadata, and unrelated uses of the word. In particular,
`ParameterMetadata.hdr` is not an export identity (`src/compiler/types.ts:818`).

Each step has its own written plan, approval, commit, and dated CHANGELOG entry. The
tooling step establishes the first frame baseline; subsequent steps record comparisons
before their changes. Predictions are relative to the immediately preceding step.

## 11. Verification and review

Run `npx tsc --noEmit`, `npx vitest run`, and compilation digests before and after each
implementation step. Once the frame tool exists, record and compare frames too.

Add focused checks for:

- Picture ordering, individual AOVs, reordered selections, duplicates, and all four
  attachments.
- Correct current/post-swap references everywhere, including recipes.
- First-sample initialization and both ping-pong parities.
- Stopped-render switching and saving without changing accumulated state.
- One subsequent traced sample matching an unswitched control.
- Radiance and variance with AOVs enabled matching the same render with them disabled.
- Accepted guide outcomes, including medium termination, null boundaries, zero-bounce
  renders, emitters, mixed hits/misses, and smooth shading normals.
- Tiled picture consistency and matching export stamps.

Targeted numerical witnesses require owner approval and run under `caffeinate -i`.
No full witness sweep starts automatically, including after a failed frame comparison.

A result outside the written prediction means stop, report evidence, and discuss it.

Each diff receives independent contract and simplicity reviews. Numerical shader changes
also receive a numerical review. The CHANGELOG records literal command results, reviewer
findings and their disposition, and unresolved expectations.

## 12. OIDN after the output system

OIDN consumes radiance, albedo, and normal captured from one render at one sample count.
Take the snapshot before asynchronous denoising begins.

Rendering may continue afterward. The denoised result remains associated with the snapshot
that produced it, so it cannot be mistaken for a newer frame.

Denoising is a view operation and never writes into accumulation. Its implementation plan
must reuse the established display and export machinery.

Retain verified oidn-web API and encoding facts from `claude-oidn-test-plan.md`. Replace
its separate-renderer workflow and superseded restrictions. No feasibility phase is added.

## Instructions for the next reviewer

Review this draft against the original owner decisions and actual code. Do not implement.
Label facts as read, measured, or expected. Check proposed changes in pbrt-v4 and Mitsuba
3 source, and Cycles source for the classification discussion. Treat the unanswered
questions as unanswered. Focus especially on medium-guide semantics, one-source-of-truth
composition, export policy, and whether the verification can establish its promises.
