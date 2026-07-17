# Lambert — what it computes and why

The ideal diffuse surface: incident light scatters with no directional memory, so the
BRDF is the constant `albedo/π` (the π makes a white surface exactly energy-preserving:
∫ (ρ/π)·cosθ dω = ρ).

- `lambert_eval` returns `mp.albedo * (1.0 / PI)` — **bare f, no cosine** (§2.2: the
  cosine is transport's Jacobian, applied at the NEE site as `cos_i`). The side check
  `ambient_dot(wi,n)·ambient_dot(wo,n) ≤ 0 → zero` enforces reflection-only.
- `lambert_sample` draws the cosine-weighted hemisphere around the arrival-side normal
  (`cos_theta = sqrt(u.y)` — the sqrt IS the cosine weighting) and returns
  `weight = mp.albedo` exactly: (albedo/π)·cosθ / (cosθ/π) — the §2.1 cancellation
  with nothing left over. `pdf = cos_theta/π`; single lobe, `uc` unused.
- `lambert_emission` returns `mp.emission` — Lambert doubles as the emissive surface
  model (`capabilities.emissive: true`). (The historical `emission_strength` rider was
  a fixed-struct-era fossil, merged away July 2026: strength was 1 exactly when
  emission was assigned nonzero, so the product was identically `emission`.)

Why this occupant matters beyond itself: it is the **shape-setter** — the first model
through every contract (the `(uc,u)` split, sample-returns-weight, the schema
machinery), and the model the furnace closure tests: an enclosure of albedo ρ with
emission Le converges to Le/(1−ρ) everywhere (F-BOX: 0.2/0.5 = **0.4 exactly**, the
suite's sharpest number).
