// Tabulated environment sampling: CDF cell masses followed by uniform solid-angle
// sampling inside the selected chart cell. PDFs use the stored CDF differences.
// Uncompensated proposals mix in a uniform sphere; compensated MIS proposals can
// intentionally have zero mass and rely on the competing BSDF proposal.
// Depends on chart mapping/cell sampling, environment_radiance, ENV_COMPENSATED,
// u_envCdfCond/u_envCdfMarg (R32F NEAREST), and u_envSize.

float env_cdf_marg(int j) { return texelFetch(u_envCdfMarg, ivec2(0, j), 0).r; }
float env_cdf_cond(int j, int i) { return texelFetch(u_envCdfCond, ivec2(i, j), 0).r; }

// The chart owns each cell's exact solid angle and its within-cell sampling.

float env_table_pdf(vec3 dir) {
    ivec2 sz = ivec2(u_envSize + 0.5);
    vec2 uv = env_chart_uv(dir);
    int i = clamp(int(uv.x * float(sz.x)), 0, sz.x - 1);
    int j = clamp(int(uv.y * float(sz.y)), 0, sz.y - 1);
    float dMarg = env_cdf_marg(j) - (j > 0 ? env_cdf_marg(j - 1) : 0.0);
    float dCond = env_cdf_cond(j, i) - (i > 0 ? env_cdf_cond(j, i - 1) : 0.0);
    return (dCond * dMarg) / env_texel_dOmega(j, sz);
}

// Keep inversion remainders below the upper cell boundary.
const float CDF_FRAC_MAX = 0.9999999;

vec3 env_sample_table(vec2 xi) {
    ivec2 sz = ivec2(u_envSize + 0.5);

    // Row: lower_bound over the marginal CDF (first j with cdf > xi.x)
    int lo = 0, hi = sz.y - 1;
    while (lo < hi) {
        int mid = (lo + hi) >> 1;
        if (xi.x >= env_cdf_marg(mid)) lo = mid + 1; else hi = mid;
    }
    int j = lo;
    float mLo = (j > 0) ? env_cdf_marg(j - 1) : 0.0;
    float dMarg = env_cdf_marg(j) - mLo;
    float vFrac = (dMarg > 0.0) ? clamp((xi.x - mLo) / dMarg, 0.0, CDF_FRAC_MAX) : 0.5;

    // Column within the row: lower_bound over the conditional CDF
    lo = 0; hi = sz.x - 1;
    while (lo < hi) {
        int mid = (lo + hi) >> 1;
        if (xi.y >= env_cdf_cond(j, mid)) lo = mid + 1; else hi = mid;
    }
    int i = lo;
    float cLo = (i > 0) ? env_cdf_cond(j, i - 1) : 0.0;
    float dCond = env_cdf_cond(j, i) - cLo;
    float uFrac = (dCond > 0.0) ? clamp((xi.y - cLo) / dCond, 0.0, CDF_FRAC_MAX) : 0.5;

    return env_chart_sample(ivec2(i, j), vec2(uFrac, vFrac), sz);
}

// A bake can miss procedural detail, and float32 CDFs can erase dim HDR cells.
// The independent sphere component gives those directions nonzero density.
float env_uniform_fraction() {
    if (ENV_COMPENSATED) return 0.0;
    return env_cdf_marg(int(u_envSize.y) - 1) > 0.0 ? 0.0625 : 1.0;
}

float environment_pdf(vec3 dir) {
    float a = env_uniform_fraction();
    return (1.0 - a) * env_table_pdf(dir) + a / (4.0 * PI);
}

LightSample environment_sample(Point p, vec2 xi, Wavelengths wl) {
    float a = env_uniform_fraction();
    LightSample ls;
    if (xi.x < a) {
        float y = 1.0 - 2.0 * (xi.x / a);
        float r = sqrt(max(0.0, 1.0 - y * y));
        float phi = TWO_PI * xi.y;
        ls.wi = vec3(r * cos(phi), y, r * sin(phi));
    } else {
        ls.wi = env_sample_table(vec2((xi.x - a) / (1.0 - a), xi.y));
    }
    // Sky visibility ends at the same far clip used by BSDF misses.
    ls.distance = MAX_DIST;
    ls.radiance = environment_radiance(ls.wi, wl);
    ls.pdf = environment_pdf(ls.wi); // full mixture, before sky-versus-light selection
    ls.flags = 0u;                                            // NOT delta — BSDF paths hit the env on miss
    ls.light_id = -1;                                         // never consulted via light_of
    return ls;
}
