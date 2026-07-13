# Smooth dielectric — what it computes and why

The interface between two transparent media (air/glass, glass/water): every incoming
ray splits into exactly one reflected and one refracted direction (Snell), with the
energy split given by the Fresnel equations. There is no spread — the BSDF is a pair
of delta functions — so `eval` and `pdf` are identically zero and NEE never samples
this surface (`nonDeltaLobes: false`): the only way to shade it is to follow it.

**Sampling** is a coin flip weighted by Fresnel: with probability F reflect, else
refract. Because the lobe probability equals the lobe's energy fraction, the weight is
exactly 1 (reflection) or the tint × η² factor (transmission) — no arithmetic
survives, which is the point of sample-returns-weight (§2.1). Total internal
reflection is not a special case: it is the reflection branch with F = 1.

**The two facts everything else depends on:**

- **IORs come from the HIT, not the material.** The ray crosses from `region_from`
  into `region_to`; η = n_from/n_to via the generated `ior_of` table (§4.1). A
  material can't know what's on its far side — the region system can.
- **The η² factor** — radiance is compressed by (n_t/n_i)² when entering a denser
  medium; camera paths transport radiance backwards, so throughput carries the
  inverse. It cancels on any enter-and-exit round trip, which is exactly why omitting
  it "looks fine" until a path *terminates* inside the medium (emitter in glass,
  camera underwater) and the brightness is silently wrong. The F-ETA witness pins the
  number: converged center pixel 0.5540; 0.98 means the factor is missing.

**Fields:** `transmittance` (interface tint per crossing; interior *absorption* is the
region's medium block, §4.4 — two different physical effects, kept apart), `ior`.
Transport side-effects on transmission: `current_medium` tracking and the `eta_scale`
RR metric (efficiency only — RR keyed on raw compressed throughput over-kills inside
dense media).

**Witnesses:** F-ETA (0.5540), R-SUBMERGED (nested regions + per-owner normals),
cornell-glass/analytic-glass twins, X-GLASS (delta bookkeeping through specular
chains). Source: reference-implementations §2.
