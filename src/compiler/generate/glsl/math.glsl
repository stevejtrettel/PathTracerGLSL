// Math utilities
// Provides: PI, TWO_PI, EPSILON, build_basis(), local_to_world(),
//           SPECTRUM_ZERO/ONE, spectrum_average(), spectrum_max(), spectrum_is_black()

#define PI 3.14159265359
#define TWO_PI 6.28318530718
#define EPSILON 0.001
#define MAX_DIST 1000.0   // far search bound for unbounded rays (camera / bounce)
#define EPS_INTERFACE 0.001   // §4.2 classification probe depth — 10× MARCH_EPSILON so a probe
                              // along the normal clears the marcher's stop-short residual

// Spectral discipline (§2.5): radiometric constants + named reductions (no raw vec3
// literals or ad-hoc luminance() for throughput decisions in library/template GLSL).
// Reductions are basis-agnostic (no RGB weights), so hero-wavelength spectral is a later
// strategy-axis swap, not a rewrite. luminance()/Rec.709 was removed for exactly that reason:
// it baked an RGB assumption into Russian roulette (see the review + item-6 plan).
const Spectrum SPECTRUM_ZERO = Spectrum(0.0);
const Spectrum SPECTRUM_ONE  = Spectrum(1.0);
float spectrum_average(Spectrum s) { return (s.x + s.y + s.z) * (1.0 / 3.0); }
float spectrum_max(Spectrum s) { return max(s.x, max(s.y, s.z)); }   // RR survival (PBRT MaxComponentValue)
bool  spectrum_is_black(Spectrum s) { return s.x <= 0.0 && s.y <= 0.0 && s.z <= 0.0; }
#ifdef HAS_MEDIA
Spectrum spectrum_exp(Spectrum s) { return exp(s); }   // Beer–Lambert per channel (§2.5: named, no ad-hoc exp(vec3))
#endif

#ifdef ENABLE_MIS
// Power heuristic, β = 2 (§6.4) — ONE definition; both MIS sides use it (reference §8).
float power_heuristic(float pf, float pg) {
    float f2 = pf * pf;
    return f2 / max(1e-20, f2 + pg * pg);
}
#endif

void build_basis(vec3 n, out vec3 t, out vec3 b) {
    vec3 up = abs(n.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    t = normalize(cross(up, n));
    b = cross(n, t);
}

// Local shading space convention: Z-up (normal direction). cos_theta = local_dir.z
vec3 local_to_world(vec3 local_dir, vec3 n, vec3 t, vec3 b) {
    return local_dir.x * t + local_dir.y * b + local_dir.z * n;
}
