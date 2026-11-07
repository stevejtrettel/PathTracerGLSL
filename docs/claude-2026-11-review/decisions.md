# Owner decisions — November 2026 review

This file records only what the owner decided, with the date and the owner's words where
useful. Proposals by the model live in the plan documents next to this file and are never
copied here until the owner accepts them.

## 2026-11-06 (start of the review)

1. **Scope of the review.** A thorough review of the whole project, then plans to improve and
   simplify the App, its extension system, the parameter system and anything else that needs
   it, *without losing important functionality*. Unbuilt or unused pieces are usually
   in-progress work and are not to be deleted as "dead code".
2. **Changes and commits are allowed on this branch** (`claudeapp`): "you are allowed to make
   changes and commits to this branch: that's why i branched you off". Every action is planned
   before it is taken and every decision is documented.
3. **Goal of the project:** a state-of-the-art photorealistic *unidirectional* path tracer for
   meshes, algebraic surfaces and SDFs, working in Euclidean space, S³, H³ and product
   geometries (at least H²×R) — spaces where the two-point geodesic problem is solvable
   analytically and SDFs can be ray-marched analytically.
4. **Black holes.** The owner is "quite interested" in black-hole spacetimes — Schwarzschild
   and Majumdar–Papapetrou (implemented in `~/Code/charged-blackholes`) — but the two-point
   geodesic problem is the worry. If a way can be found that is reliably correct and efficient
   enough, pursue it; otherwise record the research and skip.
5. **Quotient manifolds.** Nothing is built for quotients yet. The owner would love to build
   them eventually "and really take good care of light". Could be a side project here if
   there is time and capability, or wait if the plate is full.
6. **WebGL2 for good.** This repo stays WebGL2. A feature that is very hard in WebGL2 but easy
   in WebGPU is noted and skipped here (it belongs in the owner's next tracer), even if that
   leaves out some spacetimes. Bidirectional methods are already out of scope.
7. **The App is open for redesign.** The previous AI plan was withdrawn because it was bad, not
   because the topic is closed. The owner's App decisions 1–17 (docs/claude-app-decisions.md
   history, and the goals in its current text) remain the owner's decisions.
8. **Priority order for the review's plans:** (b) curved-space architecture first, then (a) App,
   extension and parameter simplification, then (c) photorealism gaps (textures, normal mapping,
   layered materials, …). Owner: "yes b then a then c is a good move".

## 2026-11-06 (after the survey)

9. **Curved spaces: build H³ and S³ first, with a subset of features.** The owner said yes to
   all five proposals: (1) points stored as 4-vectors (hyperboloid model for H³, unit sphere in
   R⁴ for S³), each object intersected in its own local frame; Klein/gnomonic charts only inside
   mesh acceleration structures; (2) a feature subset first (SDF and analytic shapes, area and
   point lights, pinhole/fisheye cameras, homogeneous media), with unsupported features as
   explicit compile errors, never guesses; (3) sky per space: E³ unchanged, H³ a picture on the
   sphere at infinity looked up by the ray's endpoint, S³ no sky and an exact far limit of 2π;
   directional lights only in E³ for now. The owner added: "eventually we need a clean way to
   keep track of who implements what" (which components support which spaces).
10. **Black holes: left out of building for now.** Record the research and its leads; build
    nothing.
11. **Quotients: think about them if time and reasoning permit**, after the curved-space plan.
    (H²×R stays a goal from decision 3; this decision names H³ and S³ as the first spaces.)

## 2026-11-06 (evening: photorealism)

12. **Photorealism is built tonight, in parallel with the curved-space design**, while the App
    waits to be talked through with the owner. Goal: "total photorealism" — renders that look
    identical to photographs, of many kinds, "including photographs of purely math scenes".
13. **Assets.** Textures, HDRIs, models and the like may be downloaded "and saved for trial
    periods".
14. **Witnesses.** Targeted witness runs are allowed; never the full slow sweep.
15. **Procedural textures.** Research shader-based procedural textures too, where they are
    better (e.g. for math scenes without UVs).
16. **No license work.** "what if we skip all the license stuff im just a hobbyist academic" —
    data and assets are used without license research. Each data file still records where it
    came from (a source URL), as an academic citation. Owner: "i dont need agents wasting their brains on that", "just grab the spectra and report the sources".

## 2026-11-06 (before the overnight run)

17. **New material models are added beside the old ones**; the old ones may be DEMOTED if the
    new are better, and eventually (decided together) replaced, or several kept.
18. **Locked contract changes are allowed** for tangents (normal maps, anisotropy) and texture
    arrays — "make sure to not change them in a sloppy way; do what is clean and useful".
19. **No mipmaps** for image textures.
20. **3D models: offline conversion** (glTF → OBJ + textures) for now; a runtime loader may be
    considered later.
21. **The real GPU may be used** for renders ("you can definitely use the gpu").
22. **Curved spaces tonight: design + step 1**, and the owner expects a lot more work done than
    proposed ("i kind of think you can get a lot done here").
23. Question 7 (the five small confirmed bugs) was not answered. Any bug fix made overnight is
    a provisional choice, logged under "Provisional choices" below.

## Provisional choices (model's choices, unconfirmed by the owner)

(Each entry: what was chosen, why, and how to undo it.)
