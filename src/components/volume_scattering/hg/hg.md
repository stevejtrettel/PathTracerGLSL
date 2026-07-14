# Henyey–Greenstein — what it computes and why

The one-parameter phase function: how a scattering medium redistributes direction,
with `g = mp.phase_g ∈ (−1,1)` the mean cosine — g > 0 forward-scattering (haze,
tissue), g < 0 back-scattering, g = 0 isotropic.

- `hg_eval` returns `(1−g²) / (4π·d^{3/2})` with `d = 1 + g² − 2gc` and
  `c = dot(wi, -wo)` — **the FORWARD convention**: c is measured from the propagation
  direction, so the forward peak sits at c = 1. pbrt's `+2gc` form pairs with the
  opposite dot; "fixing" this file against pbrt swaps forward/backward scattering AND
  desyncs eval from sample (the second-pass audit caught exactly that). The haze
  card's g-drag is the standing witness: positive g must brighten the glow toward
  the light.
- `hg_sample` inverts the CDF exactly (`cos_theta` from the closed form; the
  `|g| < 1e-3` branch is the isotropic limit where the exact inverse divides by g),
  builds the direction around `-wo`, and returns `weight = SPECTRUM_ONE` — HG
  sampling is exact, phase/pdf ≡ 1 (§2.1 with nothing left). `flags = LOBE_MEDIUM`
  (transport skips the surface cosine).
- `hg_pdf = spectrum_average(hg_eval(...))` — scalar, since HG is grayscale; it exists
  as a separate function because MIS queries the density of directions it didn't
  sample (the medium-site power heuristic balances `ls.pdf` against it).
- No cosine anywhere in this family: phase functions are already normalized densities
  over the sphere (∫ p dω = 1); the cosine is a *surface* Jacobian (§2.2).

Fields: `phase_g` declares into `MediumProperties` via the §3.4 schema (same
machinery as materials, second family). Witnesses: haze (g-flip), X-FOG three-way
(eval/sample/pdf consistency), F-BOX-M (0.4/channel through chromatic scattering).
