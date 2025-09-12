awesome — here’s a **thinking map + pick-your-own-adventure roadmap** you can mull over tonight and start biting off tomorrow. I grouped items by theme, noted rough complexity (S/M/L), and gave crisp “what done looks like” so you can tell when to stop.

---

# 1) Image quality & stability

**A. Progressive accumulation (M)**

* Add `u_frame`, `u_sampleCount` and a history texture; blend new samples into an HDR buffer.
* Reset on resize/variant/parameter changes.
  **Done when:** a noisy integrator (e.g., cosine-hemisphere) visibly refines over time without ghosting.

**B. Jittered camera (M)**

* Add subpixel jitter (R2 or Halton) to `generateRay`.
* Works great with accumulation; helps resolve aliasing.
  **Done when:** diagonal edges look less stair-steppy after a few frames.

**C. Simple temporal clamp (S)**

* Before blending, clamp incoming color to history neighborhood (min/max).
  **Done when:** bright “sparks” don’t pollute your history.

---

# 2) Lighting & integrators

**A. Any-hit / shadow query (S)**

* Scene optional: `bool scene_occluded(Ray r, float tMin, float tMax)`
* Lambert uses this to cast a single shadow ray.
  **Done when:** directional light produces shadows.

**B. Lights as a first-class role (M)**

* Role `"lights"` with chunks: `lights.sample()`, `lights.eval()`, `lights.pdf()`.
* Start with 1 directional + 1 point light; add UI params.
  **Done when:** Lambert can choose between lights via a simple switch.

**C. Path-tracer skeleton (M→L)**

* Next-event estimation (sample light) + cosine BSDF; Russian roulette.
* MIS later.
  **Done when:** you can render soft shadows from an area light with visible noise that cleans up via accumulation.

---

# 3) Scene & geometry evolution

**A. Bounds (S)**

* Optional `Scene.Bounds`: `float scene_far();`
* Integrators default `tMax` to this.
  **Done when:** removing the magic 100.0 doesn’t hurt anything.

**B. Auto-marcher injection (M)**

* If `Scene.SignedDistance` present and `Scene.Intersect` absent, inject a library marcher at build time.
  **Done when:** an SDF-only scene compiles and runs without writing its own intersect.

**C. Any-hit fast path (M)**

* Specialized, cheaper marcher for occlusion (early exit, bigger eps).
  **Done when:** the shadow ray is 2–3x cheaper than the full intersect on SDF scenes.

**D. Analytic normals (M)**

* Optional `Scene.NormalAnalytic(Point p, Hit h)`; if present, prefer it.
* Keep numeric fallback.
  **Done when:** demo sphere uses analytic normal and “normal” debug view looks cleaner.

**E. Mesh/BVH scaffold (L)**

* Add `"geometry/tri"` module + CPU-built BVH; scene’s `Intersect` chooses SDF vs BVH.
  **Done when:** a simple triangle mesh renders and self-shadows.

---

# 4) Materials & textures

**A. Material system v1 (M)**

* Add fields: `albedoTexId`, `emissiveStrength`, `ior`.
* Optional **texture role**: lookup by `sampler2D` via uniform indirection.
  **Done when:** one sphere reads baseColor from a texture.

**B. IBL / environment map (M)**

* Add environment sampling: background color from lat-long HDR; optional rotation.
  **Done when:** miss rays return environment; glossy highlights reflect it.

---

# 5) Camera & controls

**A. Thin-lens camera (M)**

* Add focus distance, aperture; sample lens disk for DOF.
  **Done when:** you can rack focus between near/far spheres.

**B. Camera motion blur (M)**

* Per-sample shutter time; interpolate camera transform.
  **Done when:** moving camera + accumulation shows motion blur streaks.

---

# 6) Performance & robustness

**A. Marching diagnostics (S)**

* Count steps/pixel; track avg/max per frame; overlay tiny HUD.
  **Done when:** you can spot pathological scenes instantly.

**B. Epsilon policy (S)**

* Centralize hit/step eps in each scene; consider screen-space epsilon for hit test.
  **Done when:** fewer acne/terminator artifacts at grazing angles.

**C. NaN/Inf watchdog (S)**

* Guard in integrator: sanitize color; blink red if detected (dev only).
  **Done when:** experiments don’t nuke the frame with NaNs.

---

# 7) Tooling, tests, and DX

**A. Chunk order log (S)**

* Dev flag to print sorted chunk names once per build.
  **Done when:** a missing dep is obvious from logs.

**B. Golden thumbnails (S)**

* Script to capture 128×72 PNGs per (scene × integrator).
  **Done when:** you can eyeball regressions or add a quick pixel RMS check.

**C. Hot-reload nicety (M)**

* Rebuild only changed program on a file change; preserve accumulation reset logic.
  **Done when:** editing a scene or integrator re-links that program without a full reset.

---

# Suggested “tomorrow” picks (small bites)

1. **Any-hit / shadow query (S)** + wire into Lambert.
2. **Bounds hook (S)** to remove `100.0`.
3. **March diagnostics HUD (S)** to see steps/pixel.
4. **Progressive accumulation (M)** if you want a slightly bigger bite.

Each of these is self-contained and gives immediate feedback without ripping up today’s work.

If you tell me which thread you want to pull first, I’ll sketch the minimal API/contract additions and test plan for that item so you can implement swiftly.
