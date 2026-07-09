# Deferred: Owen-scrambled Sobol sampler

**Status: implemented, verified correct, reverted (July 2026).** The active sampler
is the pcg4d white-noise hash in `src/compiler/generate/glsl/rng.glsl`. This doc
parks the Owen-Sobol implementation and the conditions under which it's worth
re-adopting. It was reverted not because it was wrong — it's correct and unbiased —
but because its RMSE win on the current test scene (Cornell) was marginal (~1.05×)
and didn't justify ~2.3× the code and ~2–4× the per-draw ALU.

The counter-based §2.11 design was chosen precisely so this is a **drop-in swap of
one file's internals** with no signature or architecture change. So waiting costs
nothing; re-adopting is cheap.

---

## When to adopt this (the trigger conditions)

Owen-Sobol's win is large exactly where the integrand is **low-dimensional and
smooth**, and its win is small on high-dimensional discontinuous integrands. Adopt it
when a scene or feature makes the low-dimensional part dominate the noise:

- **Area lights** (replacing point lights). Direct-lighting NEE becomes a 2D solid-angle
  sample — low-dim and smooth. This is probably the single biggest trigger: Cornell's
  marginal result is largely *because* it uses a point light (near-zero direct-lighting
  variance). Swap in an area light and the direct component's noise, which Sobol
  stratifies well, becomes a real fraction of the total.
- **Glossy / microfacet / dielectric materials.** BSDF importance sampling is low-dim
  and benefits directly (the reshaped `<model>_sample` draws `(uc, u)` — feed those from
  stratified dimensions).
- **Camera effects: depth of field (2D lens), motion blur (1D time), thin-lens.** All
  low-dim; Sobol shines. Camera anti-aliasing (2D pixel jitter) already benefits even in
  Cornell, but it's a small fraction of pixels (edges).
- **A denoiser, or interactive/low-sample preview.** This is the *perceptual* trigger and
  needs **Phase 2 (blue-noise screen distribution)** below — not bare Owen-Sobol. Blue
  noise doesn't lower RMSE much; it redistributes the *same* error into a screen pattern
  that's far less visible to the eye and far friendlier to a denoiser.

### When NOT to bother
Pure diffuse multi-bounce global illumination with point/delta lights (i.e. Cornell as it
is today). The variance there is dominated by high-dimensional indirect diffuse transport,
which **padded** Sobol (independent per-decision 2D stratification) does not jointly
stratify. Measured win: ~1.03× at 16 spp, ~1.05× at 64 spp. Not worth the complexity.

For genuinely bigger *RMSE* wins on deep GI you'd need **full multi-dimensional Sobol**
(direction numbers for many dimensions + joint stratification across bounces), which is a
larger effort than the padded 2-dimension version below.

---

## Verified evidence (so this can be trusted, not re-litigated)

Checked in a JS harness before it ever touched GLSL (harnesses were in the session
scratchpad; the properties are reproducible from the code below):

- **Correctness:** the 2D Sobol (dims 0,1) is an exact (0,m,2)-net through m=14 (every
  elementary interval of area 2⁻ᵐ contains exactly one of the first 2ᵐ points), and Owen
  scrambling *preserves* the net (Owen's theorem) — so the direction-number recurrences
  and the Laine-Karras constants are correct independent of any external source. The
  `sobol1` recurrence `v ^= v>>1` reproduces Burley's `directions[]` table
  (`0x80000000, 0xc0000000, 0xa0000000, 0xf0000000, 0x88000000, …`) exactly.
- **Convergence (smooth integrand ∫ x·y):** RMSE beats white noise **7× at 16 spp, 34× at
  64, 104× at 256** — the gap grows ≈ N⁻³ᐟ² vs N⁻¹ᐟ², the expected Owen-Sobol rate.
- **GPU (Cornell, headless Chrome):** compiles, renders, **NaN-free**, and **unbiased** —
  converges to the same image as pcg4d (4096-spp means 1.2167 vs 1.2171). Cornell RMSE
  win only ~1.05× (the reason it was reverted).

---

## The drop-in code

Replace the body of `src/compiler/generate/glsl/rng.glsl` with this. Signatures
(`rng_init`, `random`, `random2`) are identical to pcg4d, so **no other file changes**;
only the golden snapshot updates (`npx vitest run -u` after confirming the diff is
confined to this block). Transcribed verbatim from Burley's supplemental (`suppl/`).

```glsl
// RNG — Owen-scrambled Sobol, counter-based, dimension-indexed (contracts §2.11)
// Provides: rng_init(), random(), random2()
//
// Each draw is Burley's "sobol_owen": shuffle the sample index, then Owen-scramble
// each Sobol dimension's value — with a per-(pixel, draw-group) seed so decisions and
// pixels decorrelate. Only Sobol dims 0,1 are needed (a (0,2)-sequence). This is
// "padded Sobol" (pbrt-v4 ZSobolSampler philosophy).
//
// Transcribed from Burley 2020, "Practical Hash-based Owen Scrambling" (JCGT 9:4),
// suppl/sobol.h + genpoints.cpp. Constants + the (0,m,2)-net property + the
// RMSE-vs-white-noise win were verified in a JS harness before landing.

uint rng_sampleIndex;   // Sobol index = per-pixel sample number
uint rng_pixelSeed;     // per-pixel scramble base (varies per accumulation reset)
uint rng_group;         // draw-group counter (each random()/random2() consumes one)

// boost hash_combine (Burley sobol.h) — derive per-group / per-dimension seeds.
uint hash_combine(uint seed, uint v) { return seed ^ (v + (seed << 6u) + (seed >> 2u)); }

// murmur3 finalizer (Burley genpoints.cpp) — strong per-pixel base seed.
uint hash_u32(uint x) {
    x ^= x >> 16u; x *= 0x85ebca6bu; x ^= x >> 13u; x *= 0xc2b2ae35u; x ^= x >> 16u;
    return x;
}

// 32-bit bit reversal (GLSL ES 3.00 has no bitfieldReverse builtin).
uint reverse_bits(uint x) {
    x = ((x & 0xaaaaaaaau) >> 1) | ((x & 0x55555555u) << 1);
    x = ((x & 0xccccccccu) >> 2) | ((x & 0x33333333u) << 2);
    x = ((x & 0xf0f0f0f0u) >> 4) | ((x & 0x0f0f0f0fu) << 4);
    x = ((x & 0xff00ff00u) >> 8) | ((x & 0x00ff00ffu) << 8);
    return (x >> 16) | (x << 16);
}

// Sobol dimension 0: van der Corput base 2 (direction vectors v_k = 2^(31-k)).
uint sobol0(uint i) { return reverse_bits(i); }

// Sobol dimension 1: primitive polynomial x+1, all m_k=1 (directions via v ^= v>>1;
// yields Burley's table 0x80000000, 0xc0000000, 0xa0000000, 0xf0000000, 0x88000000, ...).
uint sobol1(uint i) {
    uint r = 0u;
    for (uint v = 0x80000000u; i != 0u; i >>= 1u, v ^= v >> 1u) {
        if ((i & 1u) != 0u) r ^= v;
    }
    return r;
}

// Laine–Karras permutation (avalanches low→high bits).
uint laine_karras(uint x, uint seed) {
    x += seed;
    x ^= x * 0x6c50b47cu;
    x ^= x * 0xb82f1e52u;
    x ^= x * 0xc7afe638u;
    x ^= x * 0x8d22f6e6u;
    return x;
}

// Owen scramble (nested_uniform_scramble_base2): reverse so the avalanche runs
// high→low (Owen's requirement), hash, reverse back. Preserves the (0,2)-net.
uint owen_scramble(uint x, uint seed) {
    return reverse_bits(laine_karras(reverse_bits(x), seed));
}

// Seed on two independent axes (§2.11): sampleCount and resetSalt. Pixel enters
// the per-pixel scramble base.
void rng_init(uvec2 pixel, uint sampleCount, uint resetSalt) {
    rng_sampleIndex = sampleCount;
    rng_pixelSeed = hash_u32(hash_combine(hash_combine(pixel.x, pixel.y), resetSalt));
    rng_group = 0u;
}

// Top 24 bits scaled by 2^-24: exactly representable, guaranteed in [0, 1).
float to_unit(uint u) { return float(u >> 8) * (1.0 / 16777216.0); }

// One 2D draw: shuffle the index, take the Owen-scrambled 2D Sobol point.
vec2 random2() {
    uint seed  = hash_combine(rng_pixelSeed, rng_group++);
    uint index = owen_scramble(rng_sampleIndex, seed);
    return vec2(to_unit(owen_scramble(sobol0(index), hash_combine(seed, 0u))),
                to_unit(owen_scramble(sobol1(index), hash_combine(seed, 1u))));
}

// One 1D draw: shuffle the index, take the Owen-scrambled van der Corput value.
float random() {
    uint seed  = hash_combine(rng_pixelSeed, rng_group++);
    uint index = owen_scramble(rng_sampleIndex, seed);
    return to_unit(owen_scramble(sobol0(index), hash_combine(seed, 0u)));
}
```

### Integration notes
- **No signature or architecture change.** `rng_init`/`random`/`random2` are identical to
  pcg4d; the dimension counter (`rng_group`) is a file-local global — nothing is threaded
  through transport or materials.
- **Call-order discipline (for QMC validity):** transport should draw the same
  `random()`/`random2()` sequence per bounce so each decision maps to a stable draw-group.
  Padding conditional draws (advance the counter even when e.g. NEE is skipped) keeps
  dimensions aligned; padded Sobol degrades gracefully (worse stratification, never bias)
  if order drifts.
- **Cost:** ~2–4× the per-draw ALU vs pcg4d, dominated by `sobol1`'s up-to-32-iteration
  loop. Unmeasured as a fraction of frame time (usually small for a path tracer).

---

## Phase 2 — blue-noise screen distribution (the perceptual win, not built)

Bare Owen-Sobol above scrambles each pixel with an **independent** seed → good per-pixel
convergence, but **white-noise** error distribution across the screen. The perceptual /
denoiser win comes from making the error a **blue noise** in screen space. Two established
ways, both compatible with the code above:

1. **Heitz & Belcour 2019** — a small precomputed blue-noise texture supplies the per-pixel
   scramble seed (their impl is "a small texture and two xor operations"). Costs one
   `extern:` texture via the §2.10 texture-contribution path.
2. **pbrt-v4 ZSobolSampler (Morton ordering)** — order pixels along a Morton/Z curve into
   the Sobol index so neighbouring pixels use neighbouring sequence segments. **Zero new
   resources** — pure arithmetic on the pixel coordinate. Start here.

Blue noise does **not** meaningfully lower RMSE; it redistributes the same error to be less
visible and to denoise better. It's the reason to adopt this whole stack for interactive
preview or when a denoiser is added.

---

## References
- `suppl/` (repo root) — Burley's C++ supplemental (owenhash.h, sobol.h, genpoints.cpp).
- Burley 2020, "Practical Hash-based Owen Scrambling," JCGT 9(4): https://jcgt.org/published/0009/04/01/
- Heitz & Belcour 2019, "A Low-Discrepancy Sampler that Distributes Monte Carlo Errors as a
  Blue Noise in Screen Space": https://eheitzresearch.wordpress.com/762-2/
- pbrt-v4 §8.7 Sobol' Samplers: https://pbr-book.org/4ed/Sampling_and_Reconstruction/Sobol_Samplers
- Contracts §2.11 (sample stream) — the counter-based design that makes this a drop-in.
- Related memory: `rng-owen-sobol-tried-reverted`.
