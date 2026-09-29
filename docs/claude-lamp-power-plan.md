# Plan: the sky's share of light samples under the light tree

**Status:** approved by the owner and built, September 28, 2026 (see the CHANGELOG entry). The
owner approved fixing review item A3 (docs/claude-spectral-review-2026-09-28.md) and asked for
the simplest fix.

## The problem

When a scene has a sky that can be sampled as a light, next-event estimation first chooses the
sky or the other lights. It picks the sky with probability `u_envSelectProb`. That probability
affects only noise, never the image: the sampler and the MIS weights read the same number.

Today it is an estimate of the sky's share of the power, Φ_sky / (Φ_sky + Φ_lights), for every
way of selecting lights (lighting.ts:481–510). Under the light tree the estimate is badly wrong:
- Φ_lights leaves out instanced lamps (lighting.ts:508).
- Φ_sky uses a guess at the scene's size that leaves out instanced objects (lighting.ts:456–471).

Measured:
- **`instance-lights-sky`:** the sky gets 0.99 of the light samples, the clamp.
- **The twin scenes:** `spectral-packed` gets 0.405, and `spectral-packed-ref`, the same lamps
  written as ordinary spheres, gets 0.220.

## The fix: under the light tree, the sky and the tree each get half

The light tree already decides among the lamps by their power and position. What remains is the
split between the sky and the tree. Here we do what pbrt-v4's light-tree sampler does:

    p_sky = (number of skies) / (number of skies + 1) = 1/2

pbrt-v4, src/pbrt/lightsamplers.h:267–269 (commit b4ce968, read):
`pInfinite = Float(infiniteLights.size()) / Float(infiniteLights.size() + (nodes.empty() ? 0 : 1))`.

**Why this is better, not just simpler:**
- **The worst case is bounded.** With a fixed half, a badly matched sky or tree costs at most
  about twice the noise in the other's light. The power estimate has no bound: today it wastes
  99% of samples in one witness.
- **Nothing is left to estimate for tree renderers.** No lamp-power total, no scene size.

**Other selection methods keep their rules.** Under 'uniform' the sky gets 1/(n+1), as today.
Under 'power' it keeps the power estimate, which is also what pbrt's power sampler does. Instanced
lamps are sampled only under the tree, so the missing lamps do not affect 'power'.

## What changes

- **`envSelectionProbability`** (lighting.ts:481) gets the tree's rule, one line beside the
  existing 'uniform' rule.
- **Comments.** The comments that call the sky's share a power partition for every selection
  method (lighting.ts:38–46 and the function's own comment) state the tree's rule.

Nothing else changes: no new data, no new parameters, no App change, no shader change.

**Considered and dropped.** An earlier draft had the compiler compute every instanced lamp's
power and count instances in the scene size. It worked, but it touched five files and needed a
shared fold and a new per-instance column, all to improve a heuristic that the tree does not need.

## Verification, written first

1. **Twin test (fails today):** `spectral-packed` and `spectral-packed-ref`, compiled with the
   same light-tree strategy, have equal `u_envSelectProb`. Today 0.405 ≠ 0.220; after, both
   are 0.5.
2. **`instance-lights-sky`'s share is 0.5 (fails today: 0.99).**
3. **The 'power' renderer is unchanged:** `spectral-packed-ref` under 'power' stays at 0.220.
4. **Digest before and after:** only the uniform-closure values of light-tree renderers that
   have a sky change. Every shader and all other output are identical.
5. **GPU:** `npm run witness -- spectral-packed spectral-packed-ref instance-lights-sky`, plus any
   other light-tree scene with a sky that the digest shows changed. Estimator equalities must hold;
   noise changes, images do not.
6. **Review:** an independent review of the diff.

## Non-goals, left in the review's list

- **Instanced lamps' power** is still computed by the App while building the tree (review B6).
- **The scene-size guess** still leaves out instanced objects; it now matters only under 'power'.
