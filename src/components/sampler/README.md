# sampler/ — the sub-pixel sample stream

**Taxonomy:** estimator (which points of [0,1)^∞ get evaluated — variance/stratification
only, never the answer). **Kind:** pick-one.

## What an occupant supplies

One GLSL file providing exactly the pinned call surface (contracts §2.11):

```glsl
void  rng_init(uvec2 pixel, uint sampleCount, uint resetSalt);
float random();      // in [0, 1)
vec2  random2();
```

The occupant owns the WHOLE stream: seed layout, generator, and the [0,1) output
mapping (the top-24-bits scaling lives here because dividing by 2³²−1 rounds to 1.0
and NaN-poisons `sqrt(1−ξ)` — see pcg4d's header). Swapping occupants must touch no
call site: components draw ONLY through this surface, with explicit `(uc, u)` argument
splits at technique/kernel seams so a QMC occupant can assign dimensions.

## How the compiler consumes it

`core.ts` includes the selected occupant's file (sole occupant today — the strategy
knob arrives with the second). Counter-based discipline: the stream is an addressable
field of (pixel, sampleCount, resetSalt) — no per-frame state, so accumulation resets
are exact replays with a new salt.

## Status

Occupant: `pcg4d/` (Jarzynski–Olano). Known second: **Owen-scrambled Sobol** — built
once and reverted (see memory `rng-owen-sobol-tried-reverted` for why and what to keep
next time); its re-arrival gets the registry knob and a variance-vs-pcg4d witness.
