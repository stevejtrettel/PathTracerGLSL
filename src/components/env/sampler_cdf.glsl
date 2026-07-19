// Tabulated environment sampler — chart-generic 2D-CDF inversion (env-as-light T3, plan D11).
// Provides: environment_sample(), environment_pdf(). Depends on: env_chart_uv/env_chart_dir
// (the chart file), environment_radiance (the radiance body — T4 unification),
// u_envCdfCond (W×H R32F), u_envCdfMarg (1×H R32F), u_envSize (vec2).
//
// THE PDF COMES FROM CDF DIFFERENCES — density(i,j) = Δcond·Δmarg read off the same textures
// the sampler inverts, never recomputed from the radiance map. Whatever weight policy built
// the table (sinθ Jacobian, blur, compensation), sample↔pdf byte-match holds BY CONSTRUCTION.
// (The reference's env_pdf recomputed luminance from radiance×intensity while the CPU total
// excluded intensity — the pdf stopped integrating to 1 at intensity ≠ 1. This kills the class.)
//
// Sub-texel placement uses the CDF INVERSION REMAINDER of each axis's own random number —
// not the reference's crossed fract(xi·W) reuse (pitfall 4: never reuse a selection random).
// pdf and radiance both evaluate in TABLE uv-space; env_chart_dir/env_chart_uv are exact
// inverses (rotation sign fix), so directions and table texels agree under rotation.
// CDF fetches are texelFetch on R32F/NEAREST — required (LINEAR on R32F without the float-
// linear extension is incomplete → silent zeros; interpolated CDFs also bias inversion).

float env_cdf_marg(int j) { return texelFetch(u_envCdfMarg, ivec2(0, j), 0).r; }
float env_cdf_cond(int j, int i) { return texelFetch(u_envCdfCond, ivec2(i, j), 0).r; }

// env_texel_dOmega comes from the CHART file (T5, D11): equirect = sinθ row form,
// octahedral = constant 4π/N². The pdf below is chart-generic.

float environment_pdf(vec3 dir) {
    ivec2 sz = ivec2(u_envSize + 0.5);
    vec2 uv = env_chart_uv(dir);
    int i = clamp(int(uv.x * float(sz.x)), 0, sz.x - 1);
    int j = clamp(int(uv.y * float(sz.y)), 0, sz.y - 1);
    float dMarg = env_cdf_marg(j) - (j > 0 ? env_cdf_marg(j - 1) : 0.0);
    float dCond = env_cdf_cond(j, i) - (i > 0 ? env_cdf_cond(j, i - 1) : 0.0);
    return (dCond * dMarg) / env_texel_dOmega(j, sz);
}

// One-minus-ULP guard: keeps the intra-texel fractions strictly < 1 so the composed
// texel coordinate never rounds up into the next row/column.
const float CDF_FRAC_MAX = 0.9999999;

LightSample environment_sample(Point p, vec2 xi) {
    ivec2 sz = ivec2(u_envSize + 0.5);

    // Row: lower_bound over the marginal CDF (first j with cdf >= xi.x)
    int lo = 0, hi = sz.y - 1;
    while (lo < hi) {
        int mid = (lo + hi) >> 1;
        if (xi.x > env_cdf_marg(mid)) lo = mid + 1; else hi = mid;
    }
    int j = lo;
    float mLo = (j > 0) ? env_cdf_marg(j - 1) : 0.0;
    float dMarg = env_cdf_marg(j) - mLo;
    float vFrac = (dMarg > 0.0) ? clamp((xi.x - mLo) / dMarg, 0.0, CDF_FRAC_MAX) : 0.5;

    // Column within the row: lower_bound over the conditional CDF
    lo = 0; hi = sz.x - 1;
    while (lo < hi) {
        int mid = (lo + hi) >> 1;
        if (xi.y > env_cdf_cond(j, mid)) lo = mid + 1; else hi = mid;
    }
    int i = lo;
    float cLo = (i > 0) ? env_cdf_cond(j, i - 1) : 0.0;
    float dCond = env_cdf_cond(j, i) - cLo;
    float uFrac = (dCond > 0.0) ? clamp((xi.y - cLo) / dCond, 0.0, CDF_FRAC_MAX) : 0.5;

    vec2 uv = vec2((float(i) + uFrac) / float(sz.x), (float(j) + vFrac) / float(sz.y));

    LightSample ls;
    ls.wi = env_chart_dir(uv);
    ls.distance = 1.0e20;                                     // §6.1 environment convention
    // DEFINITIONAL consistency (T4): the sampler returns exactly the radiance the miss
    // branch would see for this direction — image envs re-fetch through the chart (an exact
    // round-trip), procedural envs direct-eval the formula. This is the MIS requirement
    // stated as code, and it frees procedural tables from carrying a radiance texture at all.
    ls.radiance = environment_radiance(ls.wi);                // without visibility
    ls.pdf = (dCond * dMarg) / env_texel_dOmega(j, sz);       // per-light density; selection applied by lighting_sample
    ls.flags = 0u;                                            // NOT delta — BSDF paths hit the env on miss
    ls.light_id = -1;                                         // never consulted via light_of
    return ls;
}
