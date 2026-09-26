# Batch 3 plan — aim shadow rays at the light (review 1.2)

**Status:** done Sep 26 (commits 2c894a7, da9ccd2; CHANGELOG "review batch 3"). Approved with
every recommendation in §6 taken: the named function, sky and sun aimed like every other light,
the old test removed, and the fog loop fixed. The before-fix measurements matched the predictions
below. Deviations:
- the witnesses also had to be filed in a gallery section (pages/sections.ts);
- the fog witness's registry entry went into the second commit, with its fix (its fixture is in
  the first);
- the unit test also checks that absorption only lowers the value;
- the tolerances are 0.015 for pt-nee and 0.005 for pt-mis and pt, from the measured spread.

Observed after the fix, not addressed here: pt-mis reads +0.05% and +0.14% high (march, far),
growing with ε. That is an effect of the spawn offset itself, not of the aim (CHANGELOG).

"Read" means seen in the code at f1b54a4; "computed" means worked out from the geometry;
"predicted" means not yet rendered.

---

## 1. The problem

With light sampling (pt-nee, pt-mis), the renderer lights a surface point by picking a point on
a light and shooting a **shadow ray** from the surface point to it. If something is in the way,
that light contributes nothing.

The ray cannot start exactly on the surface, or it would hit the surface it starts from. So it
starts a small step ε off the surface.

**Today the code moves the start point but keeps the old direction** (read, light.glsl:16–18).
So the ray runs parallel to the correct line, ε away from it, and passes beside the light point
instead of ending at it. The ray stops checking 0.002 before the light point (`SHADOW_BACKOFF`).
When the light is seen at a slant, the parallel line reaches the light's own surface earlier than
that. The code then decides the light blocks its own light.

(computed) For a surface facing a parallel light, this happens when ε(1/cos θ − cos θ) > 0.002,
where θ is the angle from the surface normal. With ε = 0.001, all light arriving more than 65°
from the normal is lost.

**Result:** pt-nee and pt-mis render darker than pt. pt uses no shadow rays, so pt is right.

**Where ε is large enough** (read):
- surfaces drawn by ray marching: ε = 0.001;
- every surface in a scene that has a GRIN medium: ε is at least 0.001 (intersection.ts:224);
- surfaces far from the origin, where ε grows with distance: 0.0003 at 10 units, 0.003 at 100.

**Which lights** (read): every light that is an object in the scene. That means emissive
objects, mesh lights, and also the authored quad, disk, sphere and softbeam lights. The handoff
said authored lights were safe, but they are not: the compiler turns each one into an object
(Planner.ts:290–321), and shadow rays test every object. Point, spot, sun, beam and sky lights
are not objects, so they are safe.

**The same fault in fog** (read). When a shadow ray crosses the boundary of a fog region, the
code restarts it just past the boundary, again keeping the old direction (media.glsl:55). Each
boundary crossed adds another step of offset.

**Not affected** (read): light sampling from a point inside fog (light_medium.glsl,
equiangular.glsl). Those rays start at the point itself, with no step, so they already aim at
the light point.

**How big** (predicted from the geometry). For a floor under a large round light:
- pt-nee is about 16% dark on a marched floor, and 52% dark on a floor at x = 100;
- pt-mis is 11–13% dark in both cases.

For the existing witness scenes the predicted effect is under 2%.

**Why no test caught it** (read):
- the existing checks compare pt-nee with pt-mis, and both lose the light;
- the checks against pt allow 2–3% error;
- no test scene has a marched or far-away surface under a light.

---

## 2. The fix

After moving the start point, point the ray at the light point again. The brightness
calculation (BSDF, cosine, probabilities, MIS weights) keeps using the original direction from
the surface point. Only the blocked/not-blocked test changes, which is what pbrt does.

**Surface lighting** (light.glsl):

```glsl
Point light_p = ambient_geodesic(hit.p, ls.wi, ls.distance);             // moved up one line
Ray shadow_ray = ray_spawn(hit, ls.wi);
shadow_ray.direction = ambient_direction_to(shadow_ray.origin, light_p);  // new: aim at the light point
```

**The fog loop** (media.glsl:55):

```glsl
seg_ray = ray_spawn(h, seg_ray.direction);
seg_ray.direction = ambient_direction_to(seg_ray.origin, light_p);        // new
```

**One new function**, in euclidean.glsl next to `ambient_geodesic`:

```glsl
// The unit direction at `from` of the straight line to `to`.
Direction ambient_direction_to(Point from, Point to) {
    return normalize(to - from);
}
```

Nothing else in the renderer changes.

**Why aiming is right** (computed). The correct test runs along the line from the surface point
to the light point. The aimed ray's distance from that line shrinks from ε at its start to 0 at
the light. Today's ray is ε away the whole way.

**Comments and docs** that describe the old behaviour are corrected in the same commits:
- math.glsl:31–37 says `SHADOW_BACKOFF` must cover the start offset. After the fix it only has to
  cover rounding error at the light.
- light.md and lights/README.md:91–93 give the same old explanation.
- the headers of opaque.glsl and media.glsl, and media.md;
- trace-loop-contract.md: the shadow-ray section and its list of functions;
- fable-reference-implementations.md: the two notes that say how shadow rays start (:156,
  :213–215);
- ambient/README.md, euclidean.md and ambient/index.ts: their lists of space functions.

The test at epsilonCoupling.test.ts:69–75 is removed (decision 3).

---

## 3. Tests, written first

Three small test scenes, in one new file: `tests/witnesses/scenes/shadowAimWitness.ts`. Each
has:
- a gray floor (albedo 0.5) under a round light facing down: radius 2, height 0.25,
  brightness 2;
- direct light only;
- a camera looking straight down at a tiny patch of floor under the light's centre.

The exact floor brightness is known, so pt, pt-nee and pt-mis are each checked against it.

| scene | setup | exact value | predicted today |
|---|---|---|---|
| `shadow-aim-march` | the floor is drawn by marching (ε = 0.001); the light is an authored light | 0.5 × 2 × R²/(R² + h²) = 64/65 = 0.98462 | pt right; pt-nee 0.828 (−16%); pt-mis 0.876 (−11%) |
| `shadow-aim-far` | the same scene moved to x = 100, with an ordinary floor (ε = 0.003); the light is an emissive object | 0.98462 | pt right; pt-nee 0.475 (−52%); pt-mis 0.862 (−12%) |
| `shadow-aim-fog` | an ordinary floor at the origin; a thin slab of absorbing fog between floor and light, drawn by marching, so every shadow ray crosses two fog boundaries | 2 ∫ u·e^{−0.02/u} du from u₀ = 0.124 to 1 = 0.95039 (Simpson's rule in the test file) | pt right; pt-nee 0.603 (−37%); pt-mis 0.838 (−12%) |

**A small unit test** checks the test file's own maths:
- with no fog, the Simpson integral equals the closed form;
- the fog slab covers every line from the floor patch to the light.

**Tolerance.** Before any fix, I render each scene with three different random seeds to measure
the noise. The tolerance is set to at least 3× that spread. Predicted noise: about 0.2%.

**Order:**
1. Write the three scenes and the unit test. Measure the noise and set the tolerances.
2. Run the scenes on today's code. I expect pt to be right and pt-nee and pt-mis to be dark, near
   the predictions. If not, I stop and report, because my understanding would be wrong.
3. Fix light.glsl and add the new function. Re-run: `march` and `far` pass; `fog` still fails.
4. Fix the fog loop. Re-run: all three pass.
5. Run the typecheck and the unit tests (glslang included). Update the stored shader snapshot and
   check that only the expected lines changed.
6. Re-run 21 existing witnesses that use lights, fog shadows, sun or sky, and check that none
   moves beyond its tolerance (the prediction is that none will):
   - `cornell-area`, `cornell-disk`, `orb`, `mesh-light-twin`, `mesh-light-smooth`,
     `softbeam-wall`, `tiny-sphere-light`, `veach-mis`, `hundred-spheres`, `instance-lights`,
     `field-glass`;
   - `shadow-medium`, `emit-scatter`, `fog-area`, `null-budget`, `region-overlap`,
     `instance-fog`;
   - `sun-haze`, `sky`, `beam-slab`, `spot`.

   If one moves, I stop and report. I will ask before any full 45-minute sweep.

---

## 4. Commits

1. The surface fix, with the `march` and `far` scenes and the unit test.
2. The fog-loop fix, with the `fog` scene.
3. Records:
   - the CHANGELOG, with before and after numbers and how they were measured;
   - the witness README;
   - the handoff;
   - this plan, marked done;
   - the review page.

---

## 5. Not in this batch

- **`SHADOW_BACKOFF` stays 0.002.** After the fix it only has to cover rounding error at the
  light. But it still ignores anything within 0.002 of the light point, which pt would see, so it
  is a fixed number that can change the picture. Removing it properly needs the light's surface
  normal passed along with the light sample (a change to `LightSample`). I propose it as a
  separate item.
- The fog loop measures the remaining distance with `length()`, which is flat-space only; its
  comment already says so. Not changed here.
- No change to light sampling, probabilities, MIS weights, how other rays start, or light
  sampling inside fog.

---

## 6. Decisions

1. **Named function or plain formula?** I recommend the named function. With
   `ambient_direction_to` (three lines, next to `ambient_geodesic`), a curved space later changes
   one function. Writing `normalize(light_p − origin)` at the two places leaves two flat-space
   spots to find later.
2. **Sky and sun.** I recommend no special case. With the code above they are aimed too: their
   light point is 1000 units away, where the renderer already places them. This changes their ray
   by at most 0.000001 radians, and a special case would need an extra check.
3. **Remove the old test** (epsilonCoupling.test.ts:69–75)? I recommend removing it. It checks a
   rule that only existed because of this bug.
4. **Fix the fog loop too?** I recommend yes. Otherwise the fog test stays failing.
