# Sphere area light — what it computes and why

A spherical emitter sampled by the **visible cone**: from outside, only the spherical
cap facing p can contribute, and that cap subtends a circular cone of directions —
sampling the cone uniformly gives a pdf directly in solid angle, no area→angle
conversion and no wasted back-hemisphere samples (pitfall 3: uniform-surface sampling
throws away half its budget).

`sphere_light_sample(center, radius, Le, p, xi)`:

- Cone half-angle from `sin²θ_max = r²/|c−p|²`; `cos_t = 1 − xi.x·(1 − cos_max)` is
  uniform over the cone's solid angle, so `pdf = 1 / (2π(1 − cos_max))` — constant.
- The direction is assembled in a `build_basis` frame around `w = normalize(c − p)`;
  `distance` is the near root of the ray-sphere quadratic (guaranteed real by the
  cone construction).
- `radiance = Le`, no falloff — as with the quad, distance is the pdf's business:
  as p recedes, `1 − cos_max` shrinks like r²/d² and the constant pdf grows.
- **p inside the sphere: `pdf = 0` punt** (OPEN — pbrt falls back to uniform-area
  sampling there; on the deferred list). The descriptor's `emitPdfArm` punts
  identically, keeping sampler and pdf-query consistent.

Descriptor facts (`sphere.ts`): `power = π·4πr²·mean(Le)`; the pdf arm depends only
on p and the precompiled center/radius — the same cone formula as the sampler (§6.1
byte-match). Witnesses: orb (sampleAsLight route + glass reflections of the emitter),
veach-mis (three sizes at equal power — the MIS stress test).
