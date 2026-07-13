# pcg4d — what it computes and why

The sample stream as a pure function: `pcg4d(uvec4)` (Jarzynski–Olano) hashes
`(pixel.xy, sampleCount, resetSalt)` into `rng_base`, and each draw is
`pcg4d(rng_base, rng_dim++)` — **counter-based, not stateful**. The stream is an
addressable field indexed by (pixel, sample, reset, dimension), which buys:

- exact reproducibility per (pixel, sample) — accumulation math never sees RNG drift;
- no correlation across tiles (seeding uses the GLOBAL pixel incl. tile offset —
  seeding with local `gl_FragCoord` replays the identical stream per tile);
- the QMC door stays a drop-in: `rng_dim` is already the dimension index a Sobol
  occupant consumes (`sobol(sampleIndex, dim)` replaces `pcg4d(base, dim)`).

`random()` maps the top 24 bits by `2⁻²⁴`: exactly representable, guaranteed in
[0, 1). Dividing the full u32 by 2³²−1 instead rounds top values UP to ≥ 1.0 — which
NaN-poisons `sqrt(1−ξ)` in cosine sampling and overruns CDF selection (the header's
warning is load-bearing).

`resetSalt` bumps per accumulation reset (§2.11): within a converging render the
stream is deterministic; across resets it never replays (no frozen-noise ghosting).
`engine.frameIndex` was deliberately DROPPED as a seed — time-varying seeds break
the accumulation invariant.

Second occupant on record: Owen-scrambled Sobol — built once, reverted (memory:
`rng-owen-sobol-tried-reverted`); its re-arrival gets the registry knob and a
variance witness against this occupant.
