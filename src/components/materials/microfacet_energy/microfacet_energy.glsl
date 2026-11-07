// Microfacet energy compensation (microfacet_energy.md): the gains that restore the energy a
// single-scattering microfacet model loses between facets (Turquin 2019, as Blender Cycles
// ships it). Each gain depends on ωₒ only, so a model multiplies its eval and its sample
// weight by the same number and leaves its pdf alone; eval·|cos θᵢ| = weight·pdf still holds.
// Linked under measurement.microfacet 'energy-compensated'; under 'single-scattering' the
// compiler emits gains that return 1 instead.
//
// u_microfacetEnergy (built-in asset ggx-smith-energy-v1, build.ts has the layout): an RGBA
// float table n wide and n·slices high. Texel (i, k·n + j) holds node (μ_i, α_j, z_k) with
// √μ_i = i/(n−1), √α_j = j/(n−1), z_k = k/(slices−1); z = √((r−1)/(r+1)), r = max(η, 1/η).
// R: the energy albedo A where η < 1; G: A where η > 1; B: E_avg(α), the F = 1 conductor's
// hemispherical average. The last slice (z = 1, F ≡ 1) is the F = 1 conductor's albedo E.
// The TS twin is build.ts (lookupSlice, conductorGain, dielectricGain) — change one, change both.
// Provides: microfacet_conductor_gain(), microfacet_dielectric_gain().
// Depends on: Spectrum, SPECTRUM_ONE.

vec4 microfacet_energy_texel(int i, int row) {
    return texelFetch(u_microfacetEnergy, ivec2(i, row), 0);
}

// Bilinear in (√μₒ, √α) on slice k. μₒ in (0, 1]; α in [1e-3, 1] (the roughness rows are
// constrained to [0, 1]).
vec4 microfacet_energy_slice(int k, float mu_o, float a) {
    int n = textureSize(u_microfacetEnergy, 0).x;
    float fy = sqrt(mu_o) * float(n - 1);
    float fx = sqrt(a) * float(n - 1);
    int i0 = min(int(fy), n - 2);
    int j0 = min(int(fx), n - 2);
    float ty = fy - float(i0);
    float tx = fx - float(j0);
    int row = k * n + j0;
    vec4 lo = mix(microfacet_energy_texel(i0, row), microfacet_energy_texel(i0 + 1, row), ty);
    vec4 hi = mix(microfacet_energy_texel(i0, row + 1), microfacet_energy_texel(i0 + 1, row + 1), ty);
    return mix(lo, hi, tx);
}

// Conductor gain (Turquin Eqs. 10, 12): 1 + F_ms (1 − E)/E, where F_ms = F_avg E_avg /
// (1 − F_avg (1 − E_avg)) sums the further bounces, each reflecting F_avg (the Fresnel term's
// hemispherical average, per lane) and escaping with E_avg. For F ≡ 1 the gain is 1/E, which
// makes the albedo exactly 1 up to the table's error.
Spectrum microfacet_conductor_gain(float mu_o, float a, Spectrum f_avg) {
    ivec2 size = textureSize(u_microfacetEnergy, 0);
    vec4 t = microfacet_energy_slice(size.y / size.x - 1, mu_o, a);
    float e = t.r;
    float e_avg = t.b;
    Spectrum f_ms = f_avg * e_avg / (SPECTRUM_ONE - f_avg * (1.0 - e_avg));
    return SPECTRUM_ONE + f_ms * ((1.0 - e) / e);
}

// Dielectric gain (Turquin Eq. 18): 1/A(μₒ, α, η), applied to both lobes, so the interface
// loses nothing and reflection and transmission keep their single-scattering split.
// η = n_i/n_t on ωₒ's side, η ≠ 1 (an index-matched interface is a delta pass-through).
float microfacet_dielectric_gain(float mu_o, float a, float eta) {
    ivec2 size = textureSize(u_microfacetEnergy, 0);
    int slices = size.y / size.x;
    float r = max(eta, 1.0 / eta);
    float fz = sqrt((r - 1.0) / (r + 1.0)) * float(slices - 1);
    int k0 = min(int(fz), slices - 2);
    vec4 t = mix(microfacet_energy_slice(k0, mu_o, a), microfacet_energy_slice(k0 + 1, mu_o, a), fz - float(k0));
    return 1.0 / (eta < 1.0 ? t.r : t.g);
}
