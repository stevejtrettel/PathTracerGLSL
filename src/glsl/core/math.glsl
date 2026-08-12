// Math utilities
// Provides: PI, TWO_PI, EPSILON, build_basis(), concentric_disk(), schlick_fresnel(),
//           dielectric_fresnel(), SPECTRUM_ZERO/ONE, spectrum_average(), spectrum_max(),
//           spectrum_is_black(), spectrum_exp() (math_media.glsl when media exist)

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
// Declared-EUCLIDEAN sampler helper (light samplers, phase ONBs — sites carrying the
// METRIC EXEMPTION). Deliberately distinct from ambient_frame(), the METRIC SEAM that
// builds shading frames and gets swapped per space: any construction/pivot works here
// because a sampler only needs SOME orthonormal completion, while ambient_frame's output
// is contract surface (Frame) that curved-space occupants replace wholesale.
void build_basis(vec3 n, out vec3 t, out vec3 b) {
    vec3 up = abs(n.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    t = normalize(cross(up, n));
    b = cross(n, t);
}

// Concentric (Shirley) map [0,1)² → unit disk — equal-area, low distortion (pbrt's
// SampleUniformDiskConcentric). Shared by the thin-lens aperture and the disk light.
vec2 concentric_disk(vec2 u) {
    vec2 o = 2.0 * u - 1.0;                 // to [-1,1]²
    if (o.x == 0.0 && o.y == 0.0) return vec2(0.0);
    float r, theta;
    if (abs(o.x) > abs(o.y)) { r = o.x; theta = (PI / 4.0) * (o.y / o.x); }
    else                     { r = o.y; theta = PI / 2.0 - (PI / 4.0) * (o.x / o.y); }
    return r * vec2(cos(theta), sin(theta));
}

// Schlick's Fresnel from normal-incidence reflectance — the house conductor vocabulary
// (f0 row shared by ggx + mirror). cos_theta is the caller's |cos| against its own
// half-vector/normal convention; must be in [0,1].
Spectrum schlick_fresnel(Spectrum f0, float cos_theta) {
    return f0 + (SPECTRUM_ONE - f0) * pow(1.0 - cos_theta, 5.0);
}

// EXACT (unpolarized) Fresnel reflectance at a dielectric interface — eta = n_i / n_t,
// cos_i measured against the interface normal on the INCIDENT side. Returns 1 under
// total internal reflection, which is why TIR is never a special case at the call site.
// Lives here rather than in dielectric.glsl (fable-rough-dielectric §4): it is the
// house's second Fresnel form, shared by every model that crosses an interface — smooth
// or rough — and a rough-glass-only program must link it without pulling in the smooth
// occupant. Named beside schlick_fresnel deliberately: the choice between them is a
// modelling decision (conductor approximation vs exact dielectric), not an accident.
float dielectric_fresnel(float cos_i, float eta) {
    float sin2_t = eta * eta * (1.0 - cos_i * cos_i);
    if (sin2_t >= 1.0) return 1.0;                    // total internal reflection
    float cos_t = sqrt(1.0 - sin2_t);
    float r_par  = (cos_i - eta * cos_t) / (cos_i + eta * cos_t);
    float r_perp = (eta * cos_i - cos_t) / (eta * cos_i + cos_t);
    return 0.5 * (r_par * r_par + r_perp * r_perp);
}
