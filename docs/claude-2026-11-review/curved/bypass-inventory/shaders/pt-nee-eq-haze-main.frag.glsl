
// ╔══ BLOCK: generated:header  [lines 1–8]
#version 300 es
precision highp float;
precision highp int;

out vec4 fragColor;

#define MAX_NULL_CROSSINGS 32
#define RR_MAX_SURVIVAL 0.95

// ╔══ BLOCK: generated:uniforms  [lines 9–20]
// Uniforms
uniform int u_resetSalt;
uniform float u_haze_g;
uniform vec3 u_cameraPosition;
uniform vec3 u_cameraForward;
uniform vec3 u_cameraRight;
uniform vec3 u_cameraUp;
uniform vec2 u_imageSize;
uniform float u_aspect;
uniform float u_tanFov;
uniform int u_sampleCount;
uniform vec2 u_pixelOffset;

// ╔══ BLOCK: components/color/rgb/types.glsl  [lines 21–29]
#define Spectrum vec3
#define Radiance Spectrum
#define SPECTRUM_N 3

// RGB has no wavelength coordinate or sampling density. Initialized placeholders
// let the film boundary use the same camera-sample contract as spectral transport.
struct Wavelengths { float unused; };
struct WavelengthSample { Wavelengths wl; float pdf; };


// ╔══ BLOCK: glsl/core/structs.glsl  [lines 30–129]
// Core struct definitions
// Provides: Ray, Hit, Frame, LightSample, MaterialProperties

#define Point vec3
#define Direction vec3

// A geodesic seed: a position + unit direction (a point of the unit tangent bundle). No search
// interval — the far bound is the QUERY's concern, not the ray's: nearest-hit shrinks hit.t;
// occlusion takes a maxDist argument. See docs/trace-loop-contract.md.
// Current wavelengths travel with the seed; throughput and radiance belong to the path.
struct Ray {
    Point origin;
    Direction direction;
    Wavelengths wl;
};

struct Frame {
    Point p;
    Direction t;
    Direction b;
    Direction n;
};

struct Hit {
    Wavelengths wl;     // arrival wavelengths, inherited from the intersected ray
    float t;
    Point p;
    Frame frame;        // shading frame; n oriented toward region_from (§4.1)
    Direction ng;       // GEOMETRIC normal of the surface actually hit, oriented like frame.n
                        // (toward region_from). Equal to frame.n wherever the shading normal is
                        // the true surface normal (analytic and marched surfaces, flat meshes);
                        // it differs where shading is interpolated or perturbed (smooth meshes,
                        // later normal/bump maps). Read it for anything that depends on the
                        // surface's real orientation: which side of the surface a spawned ray
                        // starts on (ray_spawn), and an emitter's area → solid-angle conversion,
                        // which must match its sampler (mesh_light_pdf).
    int region_from;    // medium behind the boundary (-1 = ambient) — §4.2 classification
    int region_to;      // medium ahead of the boundary — emission keys on this (§6.2)
    int region_owner;   // whose surface this IS (§4.3) — material_of(region_owner) shades (§4.1)
    vec2 uv;            // surface coordinates: the shape's own chart (<type>_uv) when it declares
                        // one, interpolated vertex uvs on meshes, else the planar placeholder
                        // (x, z)·UV_PLANAR_SCALE. Read by scene_material_properties (checker and
                        // expression materials).
    int element;        // sub-element of the OWNING region that produced this hit (owner-
                        // approved contract edit, fable-instance-attributes): the region says
                        // WHOSE surface, element says WHICH PIECE of it. Instanced batch →
                        // placement index; every other backend → 0 today. Future tenants:
                        // per-triangle index (multi-material meshes), Stage B object refs.
                        // Reader: scene_material_properties' attribute rows. Every arm that
                        // fills a Hit fills this too (the fill-the-whole-Hit protocol).
    float eps;          // positional uncertainty of p, world units (owner-approved contract
                        // edit, impl-plan-epsilon-discipline): the arm that made the hit
                        // states how well it knows p — spawn_eps_fp(p) for analytic roots and
                        // triangle tests (fp-scale, coordinate-relative), MARCH_CLEARANCE for
                        // marched commits.
                        // ray_spawn's escape offset is the ONE reader. The dispatcher seeds
                        // the conservative default so a missed arm degrades, never garbage.
};

// Placeholder planar-uv chart scale — the ONE truth for every Hit.uv writer (the SDF
// marcher and the generated analytic arms) until a real per-primitive chart exists.
#define UV_PLANAR_SCALE 0.1

// Light flags (§6.1). LIGHT_DELTA: point/directional — not BSDF-hittable, excluded from BSDF-side MIS.
const uint LIGHT_DELTA = 1u;

// Light-selection query context (fable-light-bvh §3.2 v1.5 — pbrt's LightSampleContext
// transcribed as DESIGN): everything selection may know about the query point. Pinned
// fields; static technique files NEVER construct it directly — the generated
// constructors (light_query_surface/light_query_medium) are the policy site, and the
// MIS pmf replays the STORED query (PathState.prev_query), so sampler and pmf see
// byte-identical context by construction. n = 0 means "no orientation information"
// (medium events): selection falls back to the normal-free importance. Future context
// (spectral, curved frames) extends THIS struct + the constructors — the seams and
// techniques never churn again.
//
// two_sided is the receiver's SUPPORT claim (fable-rough-dielectric §3.3), the same
// sentence the material descriptor's `support` fact states: false = "my BSDF scatters
// nothing arriving from below n", which is what LICENSES the light tree's
// below-horizon cull; true = sphere support (rough glass), so the cull disarms and the
// importance shapes on |n·d| instead. Orthogonal to n = 0: a medium event has neither
// orientation nor sidedness.
struct LightQuery {
    Point p;
    Direction n;
    bool two_sided;
};

struct LightSample {
    Direction wi;         // toward the light, unit
    float distance;       // to the sampled point (MAX_DIST for the environment and directional lights)
    Spectrum radiance;    // incident radiance, WITHOUT visibility (delta lights fold 1/d² in)
    float pdf;            // total: selection × per-light, in solid-angle measure
    uint flags;
    int light_id;
};

// MaterialProperties is GENERATED per scene (§3.4): the union of fields declared by
// the models present (see generate/schema.ts) — emitted as the next block.


// ╔══ BLOCK: generated:material-properties  [lines 130–135]
// Generated MaterialProperties — the union of fields the models PRESENT read (§3.4)
struct MaterialProperties {
    Wavelengths wl;
    Spectrum albedo;
    Spectrum emission;
};

// ╔══ BLOCK: generated:medium-properties  [lines 136–143]
// Generated MediumProperties — the union of fields the models PRESENT read (§3.4)
struct MediumProperties {
    Wavelengths wl;
    Spectrum sigma_a;   // absorption
    Spectrum sigma_s;   // scattering
    int model;   // volume_scattering registry index (interaction_medium_* dispatch)
    float phase_g;
};

// ╔══ BLOCK: glsl/core/structs_media.glsl  [lines 144–173]
// Media struct family — included by core iff the program has media (commit D of the
// item-9 split: conditional INCLUSION replaced the HAS_MEDIA preprocessor gate).

// MediumProperties is GENERATED per scene (§3.4/§3.5): RTE extinction fields + the
// phase-model schemas (see generate/schema.ts) — emitted as the preceding block.

// The volumetric component's segment decision (fable-volumetric-component.md §2/§3) — the
// return of medium_sample. Mirrors the RTE's three segment terms: weight (attenuation of what
// lies beyond), scattered (inscattering event → transport recurses), radiance (source term —
// governed by the partition rule; the accumulate line is capability-gated and NO v1 strategy
// declares it, but every body MUST still assign the field).
struct MediumSample {
    bool     scattered;  // true: real scattering event at t
    bool     deflected;  // true: GRIN — the ray bent out of the region (fable-variable-ior);
                         // exit_p/exit_dir are the bent continuation. Every arm assigns it.
    float    t;          // event arc length (valid when scattered)
    Spectrum weight;     // throughput factor for WHICHEVER outcome (§2.1)
    Radiance radiance;   // inline source term (§3 partition rule) — the emission arms
                         // fill it (impl-plan-medium-emission); ZERO in non-emissive arms
    Point     exit_p;    // THE EVENT RAY's position: scatter event (valid iff scattered — every
                         // scattering arm fills it; a bent event is not recomputable from
                         // (origin, dir, t)) or the GRIN bent-exit handoff (valid iff deflected)
    Direction exit_dir;  // THE EVENT RAY's direction: incident unit direction at the scatter
                         // event, or the bent-exit unit direction (same validity as exit_p)
    float    eta_scale;  // RR-metric compensation for whatever η² compression the arm folded
                         // into `weight` (impl-plan-grin-interface: the GRIN arm's interior
                         // L/n² factor, mirroring the surface transmission site's bookkeeping).
                         // 1.0 in every non-deflecting arm. Every arm assigns it.
};


// ╔══ BLOCK: glsl/core/interaction.glsl  [lines 174–192]
// interaction.glsl — the unified scattering-event contract (§3.1/§3.2).
// One InteractionSample serves surface BSDFs and (later) medium phase functions.
// Depends on: structs.glsl (Direction, Spectrum typedefs).

// Lobe / event flags. A flag earns its place only if transport branches on it.
const uint LOBE_REFLECTION   = 1u;   // wi on the same side of the surface as wo
const uint LOBE_TRANSMISSION = 2u;   // wi on the far side (drives medium update + offset sign)
const uint LOBE_DELTA        = 4u;   // pdf is a Dirac delta; the pdf field is 0
const uint LOBE_MEDIUM       = 8u;   // phase-function event, no surface (transport skips the cosine)
// dropped LOBE_NULL      -> compile-time is_null_interface(hit) predicate (arrives with media, §3.6)
// deferred LOBE_GLOSSY/DIFFUSE -> add when path regularization/guiding has a reader

struct InteractionSample {
    Direction wi;       // sampled next direction, world space
    Spectrum  weight;   // throughput factor: f·|cosθi|/pdf (surface); phase/pdf (medium)
    float     pdf;      // solid-angle pdf of the non-delta part; 0.0 for delta lobes
    uint      flags;
};


// ╔══ BLOCK: components/sampler/pcg4d/pcg4d.glsl  [lines 193–233]
// RNG — counter-based pcg hash, dimension-indexed (contracts §2.11)
// Provides: rng_init(), random(), random2()
//
// Counter-based (not stateful) so the sample stream is an addressable field,
// keeping the §2.9 stratification/QMC door a drop-in: rng_dim is the dimension
// index; a later QMC swap replaces pcg4d(base, dim) with sobol(sampleIndex, dim).

uint rng_base;   // per (pixel, sample, reset) seed
uint rng_dim;    // dimension / draw index

// Jarzynski–Olano "Hash Functions for GPU Rendering" — pcg4d
uvec4 pcg4d(uvec4 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
    v ^= v >> 16u;
    v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
    return v;
}

// Seed on two independent axes: sampleCount (within a converging render) and
// resetSalt (bumped per accumulation reset — kills replay + frozen-motion noise).
void rng_init(uvec2 pixel, uint sampleCount, uint resetSalt) {
    rng_base = pcg4d(uvec4(pixel, sampleCount, resetSalt)).x;
    rng_dim = 0u;
}

uint rng_u32() {
    return pcg4d(uvec4(rng_base, rng_dim++, 0u, 0u)).x;
}

// Top 24 bits scaled by 2^-24: exactly representable, guaranteed in [0, 1).
// (Dividing the full u32 by 2^32-1 rounds values near the top UP to >= 1.0,
// which NaN-poisons sqrt(1-xi) in cosine sampling and overruns CDF selection.)
float random() {
    return float(rng_u32() >> 8) * (1.0 / 16777216.0);
}

vec2 random2() {
    return vec2(random(), random());
}


// ╔══ BLOCK: components/color/spectrum.glsl  [lines 234–258]
// Component-wise transport operations; no RGB luminance weights.
const Spectrum SPECTRUM_ZERO = Spectrum(0.0);
const Spectrum SPECTRUM_ONE = Spectrum(1.0);

float spectrum_average(Spectrum s) {
    float sum = s[0];
    for (int i = 1; i < SPECTRUM_N; ++i) sum += s[i];
    return sum * (1.0 / float(SPECTRUM_N));
}

float spectrum_max(Spectrum s) {
    float m = s[SPECTRUM_N - 1];
    for (int i = SPECTRUM_N - 2; i >= 0; --i) m = max(s[i], m);
    return m;
}

bool spectrum_is_black(Spectrum s) {
    return all(lessThanEqual(s, SPECTRUM_ZERO));
}

// Uniform selection among the transport channels; u is in [0,1).
int spectrum_sample_channel(float u) {
    return min(int(u * float(SPECTRUM_N)), SPECTRUM_N - 1);
}


// ╔══ BLOCK: glsl/core/math.glsl  [lines 259–361]
// Math utilities
// Provides: PI, TWO_PI, MARCH_CLEARANCE, SHADOW_BACKOFF, fp_uncertainty(), build_basis(),
//           concentric_disk(), schlick_fresnel(),
//           dielectric_fresnel()

#define PI 3.14159265359
#define TWO_PI 6.28318530718
// MAX_DIST — the far clip: nothing beyond it is geometry, and the environment is found there
// (by missed BSDF rays AND by environment NEE — they must agree). An ABSOLUTE length, so it
// is a scene-scale truncation: geometry or an ambient medium extending past 1000 units is cut.
#define MAX_DIST 1000.0
#define EPS_INTERFACE 0.001   // §4.2 classification probe depth — 10× MARCH_EPSILON so a probe
                              // along the normal clears the marcher's stop-short residual

// ── Surface-proximity clearances (impl-plan-epsilon-discipline, Aug 2026) ──────────────
// The old single EPSILON (1e-3 — a marcher constant that J1–J5 inherited) is GONE; each
// job now derives its clearance from the provenance of the hit it protects. Analytic
// hits are fp-accurate and get fp_uncertainty(); marched and mesh hits keep the 1e-3
// magnitude under the names below. Couplings pinned by tests/components/epsilonCoupling.test.ts.

// MARCH_CLEARANCE — the marched tier's self-intersection clearance: 2× the marcher's
// acceptance cap (MARCH_EPSILON_MAX, march.glsl). Read by: marched hit fills (Hit.eps),
// the generated march's restart floor, and the dispatcher's conservative Hit.eps seed.
// NEVER shrink it toward fp scale: a 2·march_epsilon(t) offset sits at a ZERO-margin
// knife edge against the marcher's first acceptance test, and grazing escapes feed the
// 16× stall-commit (the Aug 12 six-agent audit). Lives here, not march.glsl: the
// dispatcher seed is emitted into every program, march code present or not.
#define MARCH_CLEARANCE 0.001

// SHADOW_BACKOFF — the far-end back-off of a shadow ray, keeping the LIGHT'S OWN
// surface from reading as an occluder. The shadow ray is aimed at the light point, so in
// exact arithmetic it meets the light's surface exactly there; the back-off covers the
// rounding error of the light point and of that intersection. Deliberately NOT
// fp-relative: the error is ANGLE-AMPLIFIED (a planar emitter's root error grows as
// ~δ/cosθ_l for a positional error δ, without bound as the arrival grazes, cosθ_l → 0).
// It is a fixed length, not derived: NEE does not see an occluder within 0.002 of the
// light point, which a BSDF ray would. For the environment and directional lights
// (distance MAX_DIST) it trims 0.002 off a 1000-unit far clip.
#define SHADOW_BACKOFF 0.002

// fp_uncertainty — positional error bound of a FLOATING-POINT-ACCURATE point (analytic
// roots, triangle tests, refined marches): coordinate-relative with a near-origin
// absolute floor. Constants transcribed from Wächter & Binder, "A Fast and Robust
// Method for Avoiding Self-Intersection", Ray Tracing Gems ch. 6 (int_scale = 256 ulps
// → 256·2⁻²³ relative; float_scale = 2⁻¹⁶ absolute; their origin() = 1/32 threshold is
// where the two branches cross, folded here into one max). Scalar-along-the-normal
// rather than their per-component integer offset: the escape is spelled through
// ambient_geodesic (the metric seam), and the legal window — hit error ~2e-7…2e-6
// below, optical significance ≳1e-4 above — leaves ≥2 orders of margin on both sides.
// Scale-free by construction, which is what dissolves the fixed-epsilon half of the
// Validator's transform.scale warning.
#define FP_UNCERTAINTY_REL 3.0517578125e-5   // 256 ulps: 256 × 2⁻²³
#define FP_UNCERTAINTY_ABS 1.52587890625e-5  // 2⁻¹⁶ — the near-origin floor
float fp_uncertainty(Point p) {
    return max(FP_UNCERTAINTY_ABS, FP_UNCERTAINTY_REL * max(abs(p.x), max(abs(p.y), abs(p.z))));
}

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


// ╔══ BLOCK: glsl/core/math_media.glsl  [lines 362–365]
// Spectrum helpers for media — included by core iff the program has media (commit D of
// the item-9 split: conditional INCLUSION replaced the HAS_MEDIA preprocessor gate).
Spectrum spectrum_exp(Spectrum s) { return exp(s); }   // Beer–Lambert per channel (§2.5: named, no ad-hoc exp(vec3))


// ╔══ BLOCK: components/sensor/ideal/ideal.glsl  [lines 366–370]
// Identity RGB response: no exposure or angular weighting.
Spectrum sensor_response(vec2 film, Direction ray_dir) {
    return SPECTRUM_ONE;
}


// ╔══ BLOCK: components/color/rgb/rgb.glsl  [lines 371–385]
// RGB camera samples consume no random dimension.
WavelengthSample wavelengths_sample() {
    return WavelengthSample(Wavelengths(0.0), 1.0);
}

// Transport is already expressed in the film's linear-sRGB coordinates.
vec3 color_to_pixel(vec2 film, Direction ray_dir, Radiance L, WavelengthSample camera_sample) {
    return sensor_response(film, ray_dir) * L;
}

// Authored linear RGB already is the transport representation in this model.
Spectrum color_lift_reflectance(vec3 rgb, Wavelengths wl) { return rgb; }
Spectrum color_lift_coefficient(vec3 rgb, Wavelengths wl) { return rgb; }
Spectrum color_lift_emission(vec3 rgb, Wavelengths wl) { return rgb; }


// ╔══ BLOCK: components/ambient/euclidean/euclidean.glsl  [lines 386–419]
// Euclidean Ambient Geometry
// Flat-space geometric operations
// Provides: ambient_geodesic(), ambient_frame(), ambient_dot(), ambient_parallel_transport(),
//           ambient_direction_to()

Point ambient_geodesic(Point origin, Direction dir, float t) {
    return origin + dir * t;
}

// The METRIC-SEAM frame builder: curved-space occupants replace this wholesale, so its
// construction is free to differ from core math's build_basis (the declared-Euclidean
// sampler helper) — the two serve different contracts and need not agree.
Frame ambient_frame(Point p, Direction n) {
    Direction nn = normalize(n);
    Direction t = abs(nn.x) < 0.9 ? Direction(1.0, 0.0, 0.0) : Direction(0.0, 1.0, 0.0);
    t = normalize(t - dot(t, nn) * nn);
    Direction b = cross(nn, t);
    return Frame(p, t, b, nn);
}

float ambient_dot(Direction v1, Direction v2, Point p) {
    return dot(v1, v2);
}

Direction ambient_parallel_transport(Direction v, Point from_p, Point to_p) {
    return v;
}

// The unit direction at `from` of the geodesic to `to` (the normalized log map). Shadow rays
// are aimed with it at their light point.
Direction ambient_direction_to(Point from, Point to) {
    return normalize(to - from);
}


// ╔══ BLOCK: glsl/core/ray.glsl  [lines 420–452]
// Ray construction — see docs/trace-loop-contract.md.
// A Ray carries origin, unit direction and current wavelengths, with no search interval. Self-intersection
// escape is an ORIGIN OFFSET along the geodesic (ray_spawn), so a Ray's origin is already off the
// surface. Search bounds live elsewhere: nearest-hit uses hit.t; occlusion passes a maxDist argument.
// Provides: make_ray(), ray_spawn(). Depends on: Ray/Hit (structs), ambient_geodesic/ambient_dot.

Ray make_ray(Point origin, Direction dir, Wavelengths wl) {
    Ray r;
    r.origin    = origin;
    r.direction = dir;
    r.wl        = wl;
    return r;
}

// Spawn a scattered/shadow ray from a hit: origin escaped to wi's SIDE of the surface along the
// geodesic (robust at grazing, curved-correct). Transmission gets the far side for free.
// "Side" means the side of the TRUE surface, so the offset runs along the geometric normal
// hit.ng, not the shading normal. With an interpolated shading normal (a smooth mesh) a
// direction sampled around the shading normal can point below the true plane; offsetting it
// along the shading normal would put the origin on the outside, and the ray would cross back
// through its own triangle — a spurious hit that, on an emitter, counts its emission under
// MIS but not under NEE (witness mesh-light-smooth). Along ng the ray starts on the side it
// actually travels into. For surfaces whose shading normal is the true normal, ng = frame.n.
// The escape distance is the HIT'S OWN positional uncertainty (hit.eps): fp-scale for analytic
// roots and triangle tests, the marcher's clearance for marched commits. This offset is the ONE
// self-intersection mechanism for analytic and triangle hits (their floors are t > 0), so the
// fill must exceed the hit's true error with margin — the null-crossing loops' progress and
// the media shadow walker both ride on it.
Ray ray_spawn(Hit hit, Direction wi) {
    float side = ambient_dot(wi, hit.ng, hit.p) >= 0.0 ? 1.0 : -1.0;
    return make_ray(ambient_geodesic(hit.p, hit.ng * side, hit.eps), wi, hit.wl);
}


// ╔══ BLOCK: generated:interfaces  [lines 453–489]
// ── Interface header (generated): the seams this program links ──
// core:
WavelengthSample wavelengths_sample();
vec3 color_to_pixel(vec2 film, Direction ray_dir, Radiance L, WavelengthSample camera_sample);
// intersection:
bool scene_intersect(Ray ray, out Hit hit);
int scene_region_at(vec3 p);
int material_of(int region);
// materials:
MaterialProperties scene_material_properties(int id, vec3 p, vec2 uv, int element, Wavelengths wl);
InteractionSample interaction_surface_sample(int mat, Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u);
Spectrum interaction_surface_emission(int mat, Direction wo, Hit hit, MaterialProperties mp);
bool material_is_emissive(int mat);
Spectrum interaction_surface_eval(int mat, Direction wi, Direction wo, Hit hit, MaterialProperties mp);
bool material_has_nondelta_lobes(int mat);
bool material_has_medium(int mat);
MediumProperties scene_medium_properties(int mat, vec3 p, Wavelengths wl);
MediumSample medium_sample(int med, Ray ray, float t_max, vec2 xi);
bool is_null_interface(int mat);
Spectrum medium_transmittance(int med, Ray ray, float len);
InteractionSample interaction_medium_sample(Direction wo, MediumProperties mp, vec2 xi);
Spectrum interaction_medium_eval(Direction wi, Direction wo, MediumProperties mp);
Spectrum medium_survival(int med, Point p, Wavelengths wl);
// lighting:
LightSample lighting_sample(LightQuery q, vec2 xi, Wavelengths wl);
Spectrum shadow_transmittance(Ray shadow_ray, Point light_p, int crossings_left);
float lighting_query_delta(float uc, out Point pos, out Spectrum intensity, Wavelengths wl);
// pixel:
vec2 pixel_sample(vec2 coord, vec2 xi);
// camera:
Ray camera_generateRay(vec2 film, vec2 xiLens, Wavelengths wl);
// environment:
Radiance environment_radiance(vec3 dir, Wavelengths wl);
// transport:
Radiance transport_trace(Ray ray);
LightQuery light_query_surface(int mat, Hit hit);
LightQuery light_query_medium(Point p);

// ╔══ BLOCK: generated:primitive-structs  [lines 490–498]
// Generated primitive structs (rows are the single source — A1)
struct Plane {
    Direction normal;
    float offset;
};
struct Box {
    Point center;
    vec3 halfSize;
};

// ╔══ BLOCK: components/geometry/plane/plane.glsl  [lines 499–530]
// Plane — one primitive, both backends' math (included wholesale when present, §2.12).
// Convention: the surface dot(p, normal) + offset = 0, normal unit (canonicalPlane
// normalizes at plan time — the SDF expression is a true distance bound only then).
// Provides (struct GENERATED from descriptor rows — A1): plane_sdf() (signed distance / containment), plane_intersect(),
// plane_normal().

float plane_sdf(vec3 p, Plane pl) {
    return dot(p, pl.normal) + pl.offset;
}

// Intersection with the plane dot(p, normal) + offset = 0 (matches the SDF convention).
// Floor 0, not an epsilon: a ray_spawn'd origin sits hit.eps off the plane, so its
// re-root is strictly negative (impl-plan-epsilon-discipline — escape is the offset's job).
bool plane_intersect(Ray ray, Plane pl, out float t) {
    float denom = dot(ray.direction, pl.normal);
    if (abs(denom) < 1e-8) return false;   // ray parallel to the plane
    t = -(dot(ray.origin, pl.normal) + pl.offset) / denom;
    return (t > 0.0);
}

// Outward surface normal — a plane's normal IS its parameter (trivial body, uniform signature).
vec3 plane_normal(vec3 p, Plane pl) {
    return pl.normal;
}

// Marching (`plane_sdf_intersect`) and the gradient normal (`plane_sdf_normal`) are
// GENERATED from plane_sdf when a program marches this shape — fable-sdf-contract §4.
// The plane is the UNBOUNDED shape (impl-plan-sdf-as-shape §2.3): it declares no
// bound, so it is always visited and the caller passes the open interval
// [near, running nearest] — the generated loop is unchanged by that, it simply
// never leaves early.


// ╔══ BLOCK: components/geometry/box/box.glsl  [lines 531–592]
// Box (axis-aligned canonical form — rotation comes from placement: the rigid-residual
// arm for constant rotations, the frame tier for instanced placements). Both backends'
// math in one wholesale file (§2.12); placement-fold stage 4 added the analytic pair.
// Provides (struct GENERATED from descriptor rows — A1): box_sdf() (also the analytic
// backend's containment query), box_intersect(), box_normal().

float box_sdf(vec3 p, Box b) {
    vec3 d = abs(p - b.center) - b.halfSize;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

// Nearest intersection strictly ahead of the ray (t > 0) — the slab method. direction is
// unit; a zero component gives ±inf slab times that min/max resolve (the bvh_aabb_hit
// convention). The FAR bound is the caller's job (t < hit.t / t < maxDist).
// Root selection by the INSIDE test (tn < 0 ⇔ origin inside the box), never by a
// t-threshold: an outside origin near a face must NOT fall through to the exit face —
// that skips the entry interface and fakes an exit from a region the ray never entered
// (the sphere_intersect review finding, transcribed). The floor is 0, not an epsilon:
// self-intersection escape is OWNED by ray_spawn's provenance offset (hit.eps —
// impl-plan-epsilon-discipline); a floor here deleted real shallow hits (the measured
// slab-albedo J2 leak — this box IS that witness's geometry).
bool box_intersect(Ray ray, Box b, out float t) {
    vec3 inv = 1.0 / ray.direction;
    vec3 t0 = (b.center - b.halfSize - ray.origin) * inv;
    vec3 t1 = (b.center + b.halfSize - ray.origin) * inv;
    vec3 tsm = min(t0, t1), tbg = max(t0, t1);
    float tn = max(max(tsm.x, tsm.y), tsm.z);
    float tf = min(min(tbg.x, tbg.y), tbg.z);
    if (tf < tn) return false;
    t = (tn < 0.0) ? tf : tn;
    return t > 0.0;
}

// Outward surface normal at p (a point on/near the surface): the dominant axis of the
// unit-cube map — exact on faces, the nearer face at edges/corners.
vec3 box_normal(vec3 p, Box b) {
    vec3 q = (p - b.center) / b.halfSize;
    vec3 a = abs(q);
    if (a.x >= a.y && a.x >= a.z) return vec3(sign(q.x), 0.0, 0.0);
    if (a.y >= a.z) return vec3(0.0, sign(q.y), 0.0);
    return vec3(0.0, 0.0, sign(q.z));
}

// The INTERVAL form (impl-plan-sdf-as-shape T2) — entry/exit of the slab intersection,
// the shape a marched arm consumes. Entry clamped to 0; sibling of box_intersect, which
// stays untouched.
bool box_interval(Ray ray, Box b, out float t0, out float t1) {
    vec3 inv = 1.0 / ray.direction;
    vec3 ta = (b.center - b.halfSize - ray.origin) * inv;
    vec3 tb = (b.center + b.halfSize - ray.origin) * inv;
    vec3 tsm = min(ta, tb), tbg = max(ta, tb);
    float tn = max(max(tsm.x, tsm.y), tsm.z);
    float tf = min(min(tbg.x, tbg.y), tbg.z);
    if (tf < tn || tf <= 0.0) return false;   // behind the ray — see sphere_interval
    t0 = max(tn, 0.0);
    t1 = tf;
    return true;
}

// Marching (`box_sdf_intersect`) and the gradient normal (`box_sdf_normal`) are
// GENERATED from box_sdf when a program marches this shape — fable-sdf-contract §4.


// ╔══ BLOCK: generated:spawn-eps  [lines 593–595]
// Spawn margin of a floating-point-accurate hit — an analytic root or a triangle test:
// its position error is a few ulps of its coordinates, so the margin is fp-relative.
float spawn_eps_fp(Point p) { return fp_uncertainty(p); }

// ╔══ BLOCK: generated:primitive-dispatch  [lines 596–692]
// Generated primitive dispatch (closed forms + bounded marches, one list)
bool primitive_intersect(Ray ray, inout Hit hit) {
    bool found = false;
    float t;
    {
        Plane shape = Plane(vec3(0.0, 1.0, 0.0), 0.0);
        if (plane_intersect(ray, shape, t) && t < hit.t) {
            hit.t = t; found = true;
            hit.p = ambient_geodesic(ray.origin, ray.direction, t);
            hit.eps = spawn_eps_fp(hit.p);
            hit.frame = ambient_frame(hit.p, plane_normal(hit.p, shape));
            hit.ng = hit.frame.n;   // a primitive's normal is its true surface normal
            hit.region_owner = 0;
            hit.element = 0;
            hit.uv = vec2(hit.p.x * UV_PLANAR_SCALE, hit.p.z * UV_PLANAR_SCALE);
        }
    }
    {
        Plane shape = Plane(vec3(0.0, -1.0, 0.0), 2.5);
        if (plane_intersect(ray, shape, t) && t < hit.t) {
            hit.t = t; found = true;
            hit.p = ambient_geodesic(ray.origin, ray.direction, t);
            hit.eps = spawn_eps_fp(hit.p);
            hit.frame = ambient_frame(hit.p, plane_normal(hit.p, shape));
            hit.ng = hit.frame.n;   // a primitive's normal is its true surface normal
            hit.region_owner = 1;
            hit.element = 0;
            hit.uv = vec2(hit.p.x * UV_PLANAR_SCALE, hit.p.z * UV_PLANAR_SCALE);
        }
    }
    {
        Plane shape = Plane(vec3(0.0, 0.0, 1.0), 2.5);
        if (plane_intersect(ray, shape, t) && t < hit.t) {
            hit.t = t; found = true;
            hit.p = ambient_geodesic(ray.origin, ray.direction, t);
            hit.eps = spawn_eps_fp(hit.p);
            hit.frame = ambient_frame(hit.p, plane_normal(hit.p, shape));
            hit.ng = hit.frame.n;   // a primitive's normal is its true surface normal
            hit.region_owner = 2;
            hit.element = 0;
            hit.uv = vec2(hit.p.x * UV_PLANAR_SCALE, hit.p.z * UV_PLANAR_SCALE);
        }
    }
    {
        Plane shape = Plane(vec3(1.0, 0.0, 0.0), 2.5);
        if (plane_intersect(ray, shape, t) && t < hit.t) {
            hit.t = t; found = true;
            hit.p = ambient_geodesic(ray.origin, ray.direction, t);
            hit.eps = spawn_eps_fp(hit.p);
            hit.frame = ambient_frame(hit.p, plane_normal(hit.p, shape));
            hit.ng = hit.frame.n;   // a primitive's normal is its true surface normal
            hit.region_owner = 3;
            hit.element = 0;
            hit.uv = vec2(hit.p.x * UV_PLANAR_SCALE, hit.p.z * UV_PLANAR_SCALE);
        }
    }
    {
        Plane shape = Plane(vec3(-1.0, 0.0, 0.0), 2.5);
        if (plane_intersect(ray, shape, t) && t < hit.t) {
            hit.t = t; found = true;
            hit.p = ambient_geodesic(ray.origin, ray.direction, t);
            hit.eps = spawn_eps_fp(hit.p);
            hit.frame = ambient_frame(hit.p, plane_normal(hit.p, shape));
            hit.ng = hit.frame.n;   // a primitive's normal is its true surface normal
            hit.region_owner = 4;
            hit.element = 0;
            hit.uv = vec2(hit.p.x * UV_PLANAR_SCALE, hit.p.z * UV_PLANAR_SCALE);
        }
    }
    {
        Plane shape = Plane(vec3(0.0, 0.0, -1.0), 6.0);
        if (plane_intersect(ray, shape, t) && t < hit.t) {
            hit.t = t; found = true;
            hit.p = ambient_geodesic(ray.origin, ray.direction, t);
            hit.eps = spawn_eps_fp(hit.p);
            hit.frame = ambient_frame(hit.p, plane_normal(hit.p, shape));
            hit.ng = hit.frame.n;   // a primitive's normal is its true surface normal
            hit.region_owner = 5;
            hit.element = 0;
            hit.uv = vec2(hit.p.x * UV_PLANAR_SCALE, hit.p.z * UV_PLANAR_SCALE);
        }
    }
    {
        Box shape = Box(vec3(-1.2, 1.2, -2.4), vec3(0.4, 0.4, 0.05));
        if (box_intersect(ray, shape, t) && t < hit.t) {
            hit.t = t; found = true;
            hit.p = ambient_geodesic(ray.origin, ray.direction, t);
            hit.eps = spawn_eps_fp(hit.p);
            hit.frame = ambient_frame(hit.p, box_normal(hit.p, shape));
            hit.ng = hit.frame.n;   // a primitive's normal is its true surface normal
            hit.region_owner = 6;
            hit.element = 0;
            hit.uv = vec2(hit.p.x * UV_PLANAR_SCALE, hit.p.z * UV_PLANAR_SCALE);
        }
    }
    return found;
}

// ╔══ BLOCK: generated:material-of  [lines 693–703]
// Generated region -> material table (§2.3), across every geometry class
int material_of(int region) {
    if (region == 0) return 0;
    if (region == 1) return 0;
    if (region == 2) return 0;
    if (region == 3) return 0;
    if (region == 4) return 0;
    if (region == 5) return 0;
    if (region == 6) return 1;
    return 2;
}

// ╔══ BLOCK: generated:scene-region-at  [lines 704–724]
// Generated point classification (§2.7 innermost-wins)
int scene_region_at(vec3 p) {
    int region = -1;
    float best = -1.0e20;   // best = least-negative inside distance so far
    float d;
    d = plane_sdf(p, Plane(vec3(0.0, 1.0, 0.0), 0.0));
    if (d < 0.0 && d > best) { best = d; region = 0; }
    d = plane_sdf(p, Plane(vec3(0.0, -1.0, 0.0), 2.5));
    if (d < 0.0 && d > best) { best = d; region = 1; }
    d = plane_sdf(p, Plane(vec3(0.0, 0.0, 1.0), 2.5));
    if (d < 0.0 && d > best) { best = d; region = 2; }
    d = plane_sdf(p, Plane(vec3(1.0, 0.0, 0.0), 2.5));
    if (d < 0.0 && d > best) { best = d; region = 3; }
    d = plane_sdf(p, Plane(vec3(-1.0, 0.0, 0.0), 2.5));
    if (d < 0.0 && d > best) { best = d; region = 4; }
    d = plane_sdf(p, Plane(vec3(0.0, 0.0, -1.0), 6.0));
    if (d < 0.0 && d > best) { best = d; region = 5; }
    d = box_sdf(p, Box(vec3(-1.2, 1.2, -2.4), vec3(0.4, 0.4, 0.05)));
    if (d < 0.0 && d > best) { best = d; region = 6; }
    return region;
}

// ╔══ BLOCK: generated:scene-intersect  [lines 725–749]
// Generated scene_intersect dispatcher
bool scene_intersect(Ray ray, out Hit hit) {
    hit.wl = ray.wl;
    hit.t = MAX_DIST;   // running nearest = far clip; rest of hit undefined until a backend fills it
    hit.eps = MARCH_CLEARANCE;   // conservative seed (the largest tier) — every arm overwrites; a missed arm degrades, never garbage
    bool found = false;
    if (primitive_intersect(ray, hit)) found = true;
    if (found) {
        // §4.2/§4.3: one outside-probe along the outward normal; owner covers its own side.
        // Which side the ray is on, and where the probe lands, are GEOMETRIC facts: both use
        // the geometric normal ng, never an interpolated or perturbed shading normal.
        int outside = scene_region_at(ambient_geodesic(hit.p, hit.ng, EPS_INTERFACE));
        if (ambient_dot(ray.direction, hit.ng, hit.p) < 0.0) {
            hit.region_from = outside;              // entering the owner
            hit.region_to   = hit.region_owner;
        } else {
            hit.region_from = hit.region_owner;     // exiting the owner
            hit.region_to   = outside;
            hit.frame = ambient_frame(hit.p, -hit.frame.n);   // §4.1: n faces region_from
            hit.ng = -hit.ng;                                  // and so does the geometric normal
        }
    }
    return found;
}


// ╔══ BLOCK: generated:material-lookup  [lines 750–767]
// Generated material properties lookup — assignments follow the models' schemas (§3.4):
// a material sets exactly the fields its model reads, nothing else. `p` (shading point)
// and `uv` (surface chart, fable-imagery P2) are the coordinates an expression row may
// reference; `element` = Hit.element (the owner's sub-element) — read only by ATTRIBUTE rows.
MaterialProperties scene_material_properties(int id, vec3 p, vec2 uv, int element, Wavelengths wl) {
    MaterialProperties props;
    props.wl = wl;
    props.albedo = color_lift_reflectance(vec3(0.8), wl);
    props.emission = color_lift_emission(vec3(0.0), wl);
    if (id == 0) {
        props.albedo = color_lift_reflectance(vec3(0.5, 0.5, 0.5), wl);
    }
    else if (id == 1) {
        props.albedo = color_lift_reflectance(vec3(0.0, 0.0, 0.0), wl);
        props.emission = color_lift_emission(vec3(4.0, 4.0, 4.0), wl);
    }
    return props;
}

// ╔══ BLOCK: components/materials/lambert/lambert.glsl  [lines 768–805]
// Lambert diffuse BRDF — conforms to §3.2 (transcribed from reference-implementations §1).
// Fields read: mp.albedo, mp.emission. Reflection-only, non-delta.
// Provides: lambert_eval(), lambert_sample(), lambert_pdf(), lambert_emission().
// Depends on: MaterialProperties, Hit/Frame, InteractionSample, LOBE_REFLECTION,
//             PI, TWO_PI, SPECTRUM_ZERO.

Spectrum lambert_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    // bare f (§2.2): NO cosine here. Reflection side only (transmission is illegal for Lambert).
    // World-space direction·normal → metric (ambient_dot); Euclidean unpacks to dot.
    if (ambient_dot(wi, hit.frame.n, hit.p) * ambient_dot(wo, hit.frame.n, hit.p) <= 0.0) return SPECTRUM_ZERO;
    return mp.albedo * (1.0 / PI);
}

InteractionSample lambert_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    // Cosine-weighted hemisphere on the side we arrived from. Lambert has one lobe: uc unused.
    Frame f = hit.frame;
    Direction n = ambient_dot(wo, f.n, hit.p) < 0.0 ? -f.n : f.n;
    float cos_theta = sqrt(u.y);
    float sin_theta = sqrt(max(0.0, 1.0 - u.y));
    float phi = TWO_PI * u.x;

    InteractionSample s;
    s.wi     = normalize(f.t * (sin_theta * cos(phi)) + f.b * (sin_theta * sin(phi)) + n * cos_theta);
    s.weight = mp.albedo;                       // (albedo/π)·cos / (cos/π) — exact cancellation (§2.1)
    s.pdf    = cos_theta * (1.0 / PI);
    s.flags  = LOBE_REFLECTION;
    return s;
}

float lambert_pdf(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    float c = ambient_dot(wi, hit.frame.n, hit.p) * sign(ambient_dot(wo, hit.frame.n, hit.p));
    return max(0.0, c) * (1.0 / PI);
}

Spectrum lambert_emission(Direction wo, Hit hit, MaterialProperties mp) {
    return mp.emission;
}


// ╔══ BLOCK: generated:interaction-dispatch  [lines 806–815]
// Generated surface-interaction dispatch (§3.3)
InteractionSample interaction_surface_sample(int mat, Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    return lambert_sample(wo, hit, mp, uc, u);
}
Spectrum interaction_surface_eval(int mat, Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    return lambert_eval(wi, wo, hit, mp);
}
Spectrum interaction_surface_emission(int mat, Direction wo, Hit hit, MaterialProperties mp) {
    return lambert_emission(wo, hit, mp);
}

// ╔══ BLOCK: generated:nondelta-guard  [lines 816–820]
// Generated NEE guard: pure-delta materials skip the shadow ray (eval ≡ 0)
bool material_has_nondelta_lobes(int mat) {
    if (mat == 2) return false;
    return true;
}

// ╔══ BLOCK: generated:emissive-table  [lines 821–824]
// Generated emission gate: fetch/dispatch emission only where it can exist
bool material_is_emissive(int mat) {
    return mat == 1;
}

// ╔══ BLOCK: generated:media-tables  [lines 825–831]
// Generated media capability tables (§3.5/§3.6)
bool is_null_interface(int mat) {
    return mat == 2;
}
bool material_has_medium(int mat) {
    return mat == 2;
}

// ╔══ BLOCK: generated:medium-properties  [lines 832–849]
// Generated medium-properties lookup (§3.5; heterogeneous media read p)
MediumProperties scene_medium_properties(int mat, vec3 p, Wavelengths wl) {
    MediumProperties m;
    m.wl = wl;
    m.sigma_a = SPECTRUM_ZERO;
    m.sigma_s = SPECTRUM_ZERO;
    m.phase_g = 0.0;
    m.model = 0;
    if (mat == 2) {   // 'fog'
        vec3 sigma_a = vec3(0.02, 0.02, 0.02);
        vec3 sigma_s = vec3(0.4, 0.4, 0.4);
        m.sigma_a = color_lift_coefficient(sigma_a, wl);
        m.sigma_s = color_lift_coefficient(sigma_s, wl);
        m.phase_g = u_haze_g;
        m.model = 0;   // 'hg'
    }
    return m;
}

// ╔══ BLOCK: components/transport/volume/analytic/analytic.glsl  [lines 850–901]
// medium_analytic.glsl — the v1 'analytic' volume strategy bodies (V1-C1: homogeneous,
// closed-form). NORMATIVE SOURCE: fable-volumetric-component.md §4 — transcribe, don't
// re-derive. Chromatic sampling is pbrt-v3's uniform CHANNEL SELECTION with the
// balance-heuristic weight over per-channel exponential pdfs (owner decision; bounded
// weights — NOT the σ̄ ratio-weight scheme of reference-implementations §5, superseded).
// Grayscale degeneracy check: scatter weight → σ_s/σ_t (single-scatter albedo), survival
// weight → 1 — the §7.2 "no weight on survival" pin is the special case of these formulas.

MediumSample medium_sample_analytic(MediumProperties m, Ray ray, float t_max, vec2 xi) {
    Spectrum sigma_t = m.sigma_a + m.sigma_s;

    int   c  = spectrum_sample_channel(xi.x);
    float sc = sigma_t[c];
    // Zero extinction has all its probability at infinity: survive this segment,
    // including xi.y == 0. A positive floor would invent collisions in vacuum.
    float t  = sc == 0.0 ? t_max : -log(1.0 - xi.y) / sc;

    MediumSample ms;
    ms.deflected = false;                             // straight-ray arm — never a GRIN exit
    ms.eta_scale = 1.0;                               // no index change on a straight segment
    ms.radiance = SPECTRUM_ZERO;                      // mandatory (§3 partition rule)
    if (t < t_max) {
        // Scatter event at t. pdf = (1/N) Σ_c σ_c e^{−σ_c t} (one-sample MIS over channels).
        Spectrum tr  = spectrum_exp(-sigma_t * t);
        float    pdf = spectrum_average(sigma_t * tr);
        ms.scattered = true;
        ms.t         = t;
        // The EVENT RAY (impl-plan-grin-media): every scattering arm reports its event's
        // position + incident direction — this one trivially (straight flight), the GRIN
        // arm because a bent event is not recomputable from (origin, dir, t).
        ms.exit_p    = ambient_geodesic(ray.origin, ray.direction, t);
        ms.exit_dir  = ray.direction;
        ms.weight    = m.sigma_s * tr / max(pdf, 1e-20);
    } else {
        // Survived to the boundary. pdf = P(t ≥ t_max) = (1/N) Σ_c e^{−σ_c t_max}.
        Spectrum tr  = spectrum_exp(-sigma_t * t_max);
        float    pdf = spectrum_average(tr);
        ms.scattered = false;
        ms.t         = t_max;
        ms.weight    = tr / max(pdf, 1e-20);
    }
    return ms;
}

// Seam 2 (per-segment shadow transmittance): exact Beer–Lambert over FULL σ_t — absorption
// plus out-scatter, the standard single-scattering shadow approximation. Residual ratio
// tracking degenerates to exactly this for homogeneous media (the heterogeneous upgrade is
// a strict superset). Caller clamps len finite (MAX_DIST) — inf × 0 = NaN guard (pbrt note).
Spectrum medium_transmittance_analytic(MediumProperties m, float len) {
    return spectrum_exp(-(m.sigma_a + m.sigma_s) * len);
}


// ╔══ BLOCK: components/volume_scattering/hg/hg.glsl  [lines 902–944]
// phase_hg.glsl — Henyey–Greenstein phase function (§3.5). Fields read: mp.phase_g.
// TRANSCRIBED from fable-reference-implementations §3 — the FORWARD convention:
// c is measured from the propagation direction (-wo), so the denominator is 1 + g² − 2gc
// (forward peak at c = 1 for g > 0). PBRT uses the OPPOSITE form (+2gc with dot(wo, wi));
// its own book footnotes the divergence from the scattering literature — do NOT "fix" this
// file against PBRT: mixing the conventions swaps forward/backward scattering AND desyncs
// eval from sample (the second-pass audit caught exactly this).
// Raw dot() is forced here: the pinned §3.5 signature carries no Point, so the metric seam
// (ambient_dot) waits for the phase interface to gain a position argument with curved spaces.

Spectrum hg_eval(Direction wi, Direction wo, MediumProperties mp) {
    float g = mp.phase_g;
    float c = dot(wi, -wo);                           // cos from the FORWARD (propagation) direction
    float d = 1.0 + g * g - 2.0 * g * c;
    return Spectrum((1.0 - g * g) / (4.0 * PI * d * sqrt(max(d, 1e-8))));
}

InteractionSample hg_sample(Direction wo, MediumProperties mp, vec2 xi) {
    float g = mp.phase_g;
    float cos_theta;
    if (abs(g) < 1e-3) {
        cos_theta = 1.0 - 2.0 * xi.x;                 // isotropic limit (the exact-inverse blows up at g→0)
    } else {
        float sq = (1.0 - g * g) / (1.0 - g + 2.0 * g * xi.x);
        cos_theta = (1.0 + g * g - sq * sq) / (2.0 * g);
    }
    float sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));
    float phi = TWO_PI * xi.y;
    vec3 t, b;
    build_basis(-wo, t, b);                           // frame around the propagation direction

    InteractionSample s;
    s.wi     = normalize(t * (sin_theta * cos(phi)) + b * (sin_theta * sin(phi)) + (-wo) * cos_theta);
    s.weight = SPECTRUM_ONE;                          // phase/pdf = 1 exactly: HG sampling is exact (§2.1)
    s.pdf    = spectrum_average(hg_eval(s.wi, wo, mp)); // scalar; HG is grayscale
    s.flags  = LOBE_MEDIUM;
    return s;
}

float hg_pdf(Direction wi, Direction wo, MediumProperties mp) {
    return spectrum_average(hg_eval(wi, wo, mp));
}


// ╔══ BLOCK: generated:medium-dispatch  [lines 945–951]
// Generated volume-scattering dispatch (interaction_medium_* over mp.model)
InteractionSample interaction_medium_sample(Direction wo, MediumProperties mp, vec2 xi) {
    return hg_sample(wo, mp, xi);
}
Spectrum interaction_medium_eval(Direction wi, Direction wo, MediumProperties mp) {
    return hg_eval(wi, wo, mp);
}

// ╔══ BLOCK: generated:medium-sample  [lines 952–965]
// Generated volumetric-component dispatch (seam 1, fable-volumetric-component §2)
MediumSample medium_sample(int med, Ray ray, float t_max, vec2 xi) {
    MediumSample ms;
    ms.scattered = false;
    ms.deflected = false;   // every arm assigns it (structs_media rule) — this ms serves the inline arms + fallthrough
    ms.eta_scale = 1.0;     // ditto (impl-plan-grin-interface): only the GRIN arm folds an η² factor
    ms.t = t_max;
    ms.weight = SPECTRUM_ONE;
    ms.radiance = SPECTRUM_ZERO;
    if (med == 2) {   // 'fog' — scattering (analytic channel-MIS)
        return medium_sample_analytic(scene_medium_properties(2, ray.origin, ray.wl), ray, t_max, xi);
    }
    return ms;
}

// ╔══ BLOCK: generated:medium-survival  [lines 966–976]
// Generated interior survival (docs/fable-subsurface.md §6): the physical continuation
// probability of a scattering collision — σ_s/σ_t on the WEIGHTED arms, 1 where the
// tracking lottery already settled absorption. No clamp: this is a probability by
// construction, unlike the event weight it replaced.
Spectrum medium_survival(int med, Point p, Wavelengths wl) {
    if (med == 2) {   // 'fog' — weighted absorption
        MediumProperties m = scene_medium_properties(2, p, wl);
        return m.sigma_s / max(m.sigma_s + m.sigma_a, Spectrum(1e-9));
    }
    return SPECTRUM_ONE;   // tracking arms + non-scattering media: nothing owed
}

// ╔══ BLOCK: generated:medium-transmittance  [lines 977–983]
// Generated volumetric-component dispatch (seam 2, fable-volumetric-component §2)
Spectrum medium_transmittance(int med, Ray ray, float len) {
    if (med == 2) {   // 'fog'
        return medium_transmittance_analytic(scene_medium_properties(2, ray.origin, ray.wl), len);
    }
    return SPECTRUM_ONE;
}

// ╔══ BLOCK: components/transport/shadow/media/media.glsl  [lines 984–1046]
// Shadow transmittance — media form (§6.3; emitted INSTEAD of shadow_opaque when the scene
// has media + NEE; the NEE call sites never change). Segment-walk by RE-SPAWN
// (impl-plan-media deviation 1: the reference's t-windowed scene_intersect_from predates the
// trace-loop contract — same segments, pinned signatures only).
// Per segment: closed-form Beer–Lambert over full σ_t via medium_transmittance (generated,
// seam 2). Null interfaces pass; EVERYTHING else — opaque and dielectric alike — blocks
// (§6.3 v1 policy; transparent shadows are §10.2). Depends on: scene_intersect/scene_region_at
// (intersection), material_of, material_has_medium/is_null_interface/medium_transmittance
// (materials), ray_spawn (core), ambient_direction_to (ambient).
//
// CROSSING BUDGET (measurement.maxNullCrossings): the shadow ray is the last segment of a path,
// and the measurement keeps paths with at most MAX_NULL_CROSSINGS null crossings in total.
// `crossings_left` is what the path has not spent (shadow_crossings_left in the walk); a shadow
// ray that would need more returns ZERO, exactly as the walk ends a BSDF path at the same total.
// That makes the loop bound the measurement, not a safety limit: every estimator drops the
// same paths.
//
// The stop bound is the LIGHT POINT, not a scalar distance (trace-loop-contract: a shadow ray
// is defined by its destination). Each segment re-derives the SHADOW_BACKOFF against the
// FIXED light_p — pbrt's SpawnRayTo discipline — so the back-off can never be eroded by the
// ray_spawn offsets that accumulate across null-interface crossings (a decremented distance
// would drift by one spawn offset per crossing until the area light's own surface blocked the
// shadow ray). (length() is Euclidean; a geodesic-distance ambient helper is the curved-space
// follow-up, like the straight-ray march itself.) Each re-spawn also RE-AIMS the ray at light_p:
// the new origin sits h.eps past the boundary, and a ray that kept its direction would run
// parallel to the segment it should test, shifted by that offset (one offset more per crossing),
// and at a slant would meet the light's own surface before the back-off.

Spectrum shadow_transmittance(Ray shadow_ray, Point light_p, int crossings_left) {
    Spectrum T = SPECTRUM_ONE;
    // Starting medium recovered from the §4.4 containment oracle — self-contained
    // (works from surface points and medium event points alike).
    int medium = scene_region_at(shadow_ray.origin);
    Ray seg_ray = shadow_ray;

    // One iteration per segment; `crossed` = null interfaces behind this segment's origin.
    for (int crossed = 0; crossed <= crossings_left; crossed++) {
        // Distance to the light re-derived from the fixed target — drift-free by construction.
        float remaining = length(light_p - seg_ray.origin) - SHADOW_BACKOFF;
        // ARRIVED, never a negative segment (rider, impl-plan-epsilon-discipline): a medium
        // EVENT origin is unfloored and can sit within the back-off of the light; a negative
        // remaining fed medium_transmittance an exp(+σ·|len|) — energy amplified, a firefly.
        if (remaining <= 0.0) return T;
        Hit h;
        bool hit_boundary = scene_intersect(seg_ray, h) && h.t < remaining;
        float seg_len = hit_boundary ? h.t : remaining;

        int med_mat = material_of(medium);
        if (material_has_medium(med_mat)) {
            T *= medium_transmittance(med_mat, seg_ray, seg_len);
        }

        if (!hit_boundary) return T;                              // reached the light
        if (!is_null_interface(material_of(h.region_owner))) {
            return SPECTRUM_ZERO;                                 // opaque or dielectric: blocked (§6.3 v1)
        }
        medium = h.region_to;                                     // pass through the null interface
        seg_ray = ray_spawn(h, seg_ray.direction);                // far side by sign(dir·n)
        seg_ray.direction = ambient_direction_to(seg_ray.origin, light_p);   // re-aimed at the light point
    }
    return SPECTRUM_ZERO;   // one more crossing than the path's budget: outside the measured set
}


// ╔══ BLOCK: generated:light-structs  [lines 1047–1051]
// Generated light structs (rows are the single source — A1)
struct PointLight {
    Point position;
    Spectrum intensity;
};

// ╔══ BLOCK: components/lights/point/point.glsl  [lines 1052–1075]
// Point light — delta light sampler (§6.1 / reference §6.3). Struct-shaped (the house
// pattern): the struct is the light's record; the generated dispatcher constructs it
// from compile-time literals (hoisted const) and calls the uniform surface over it.
// Delta light: 1/d² falloff is folded into radiance; per-light pdf = 1; no pdf function
// (never hittable, never MIS-queried).
// METRIC EXEMPTION (trace-loop contract): raw dot() on world-space physical directions is
// deliberate — light samplers are Euclidean closed forms; curved spaces get new bodies (§5.3).
// Provides (struct GENERATED from descriptor rows — A1): point_light_sample().
// Depends on: LightSample, LIGHT_DELTA, Point, Spectrum.

LightSample point_light_sample(PointLight l, Point p, vec2 xi) {
    vec3 d = l.position - p;
    float d2 = dot(d, d);

    LightSample ls;
    ls.wi       = d * inversesqrt(d2);
    ls.distance = sqrt(d2);
    ls.radiance = l.intensity / d2;    // falloff folded in (delta light, §6.1)
    ls.pdf      = 1.0;                 // per-light pdf; selection pdf applied by the dispatcher
    ls.flags    = LIGHT_DELTA;
    ls.light_id = -1;                  // dispatcher sets the real id
    return ls;
}


// ╔══ BLOCK: generated:light-accessors  [lines 1076–1077]
// Generated light accessors (§6.1) — constants baked inline, driven read u_
PointLight light_get_0(Wavelengths wl) { return PointLight(vec3(0.8, 2.2, -1.0), color_lift_emission(vec3(10.0, 10.0, 10.0), wl)); }

// ╔══ BLOCK: generated:light-sampling  [lines 1078–1084]
// Generated light selection dispatcher (§6.1)
LightSample lighting_sample(LightQuery q, vec2 xi, Wavelengths wl) {
    LightSample ls;
    ls = point_light_sample(light_get_0(wl), q.p, xi);
    ls.light_id = 0;
    return ls;
}

// ╔══ BLOCK: generated:lighting-query-delta  [lines 1085–1090]
// Generated delta-light query (equiangular placement): position + intensity + select pdf.
float lighting_query_delta(float uc, out Point pos, out Spectrum intensity, Wavelengths wl) {
    pos = vec3(0.8, 2.2, -1.0);
    intensity = color_lift_emission(vec3(10.0, 10.0, 10.0), wl);
    return 1.0;
}

// ╔══ BLOCK: components/pixel/box/box.glsl  [lines 1091–1098]
// Box pixel filter — the reconstruction kernel h(u) is the indicator of the pixel square,
// so a sample is placed uniformly over the footprint (plain sub-pixel jitter).
// Provides: pixel_sample(coord, xi) → continuous film point (pixel units).

vec2 pixel_sample(vec2 coord, vec2 xi) {
    return coord + (xi - 0.5);   // uniform over the unit footprint
}


// ╔══ BLOCK: components/camera/pinhole/pinhole.glsl  [lines 1099–1117]
// Pinhole camera
// Requires: u_tanFov (= tan(fov/2)), u_imageSize, u_cameraPosition, u_cameraForward/Right/Up

Ray camera_generateRay(vec2 film, vec2 xiLens, Wavelengths wl) {
    // film = continuous sub-pixel point (pixel/ owns the footprint); xiLens unused (no aperture).
    vec2 ndc = (2.0 * film / u_imageSize) - 1.0;
    ndc.x *= u_aspect;   // aspect precomputed on the CPU (u_aspect), not per-ray

    // Look-at frame precomputed on the CPU (components/camera/basis.ts) and shipped as
    // uniforms — no per-ray normalize/cross (the degenerate up-reference guard lives there).
    vec3 forward = u_cameraForward;
    vec3 right = u_cameraRight;
    vec3 up = u_cameraUp;

    vec3 dir = normalize(forward + ndc.x * u_tanFov * right + ndc.y * u_tanFov * up);

    return make_ray(u_cameraPosition, dir, wl);   // unbounded ahead; the far clip (MAX_DIST) is the query's concern
}


// ╔══ BLOCK: generated:environment  [lines 1118–1121]
// Environment radiance
Radiance environment_radiance(vec3 dir, Wavelengths wl) {
    return SPECTRUM_ZERO;
}

// ╔══ BLOCK: generated:transport/light-query  [lines 1122–1128]
// ── Light-query constructors (generated policy — fable-light-bvh §3.2) ──
LightQuery light_query_surface(int mat, Hit hit) {
    return LightQuery(hit.p, hit.frame.n, false);
}
LightQuery light_query_medium(Point p) {
    return LightQuery(p, vec3(0.0), false);   // no orientation at a medium event
}

// ╔══ BLOCK: generated:transport/state  [lines 1129–1148]
// ── Path state (generated §3.4-style: the union of fields the included parts declare) ──
struct PathState {
    Ray ray;
    Spectrum throughput;
    Radiance radiance;
    bool prev_was_delta;     // kernel's record: camera "bounce" counts as delta (§6.2)
    int current_medium;      // walk, §4.4: THE medium variable — classified, never a stack
    int null_crossings;      // walk: crossings so far, against measurement.maxNullCrossings
};

PathState path_state_init(Ray ray) {
    PathState s;
    s.ray = ray;
    s.throughput = SPECTRUM_ONE;
    s.radiance = SPECTRUM_ZERO;
    s.prev_was_delta = true;
    s.current_medium = scene_region_at(ray.origin);   // camera may start inside a medium
    s.null_crossings = 0;
    return s;
}

// ╔══ BLOCK: generated:transport/combiner  [lines 1149–1158]
// ── Combiner (generated): pt-nee — T2 at weight 1; T1's shared-term weight is the binary rule ──
float combiner_w_emitter(PathState s, Hit hit) {
    return 1.0;   // T1 owns the emitter term outright in this program
}
float combiner_w_env(PathState s) {
    return 1.0;   // environment not samplable in this program — T1 owns the sky term
}
float combiner_w_light(int mat, LightSample ls, Direction wo, Hit hit, MaterialProperties props) {
    return 1.0;   // plain NEE: the light sample carries full weight
}

// ╔══ BLOCK: generated:transport/kernel-record  [lines 1159–1164]
// ── Kernel record (generated): the ONE writer of T1's carried state ──
// The query arrives from the SAME generated constructor the NEE call used at
// this vertex — stored-context replay (fable-light-bvh §3.2 v1.5).
void kernel_record(inout PathState s, float pdf, LightQuery q, bool is_delta) {
    s.prev_was_delta = is_delta;
}

// ╔══ BLOCK: generated:transport/roulette  [lines 1165–1173]
// ── Russian roulette (generated): §7.2 — once per iteration, post-weight, both sites ──
bool roulette(inout PathState s, int bounce) {
    if (bounce < 4) return true;
    float p_survive = min(RR_MAX_SURVIVAL, spectrum_max(s.throughput));   // §2.5: basis-agnostic, no Rec.709 weights
    if (p_survive <= 0.0) return false;   // a dead path: random() can be 0, and 0/0 is NaN
    if (random() > p_survive) return false;
    s.throughput /= p_survive;
    return true;
}

// ╔══ BLOCK: generated:transport/roulette-interior  [lines 1174–1220]
// ── Interior roulette (generated): survive in proportion to how much THIS collision
// dimmed the path — docs/fable-subsurface.md §6 ──
//
// A scattering collision has a LOCAL, exactly-known survival probability: the factor
// the volume arm just applied to the throughput. Multiplying the weight by that factor
// and then surviving with probability EQUAL to it leaves the weight exactly unchanged
// and ends the path at precisely the physical absorption rate. That is not a different
// estimator from the weighted one — it is the same estimator with the survival
// probability it should always have had, which is why this costs one function and no
// change to any volume arm.
//
// TWO DELIBERATE ABSENCES vs roulette():
//   RR_MAX_SURVIVAL — the ceiling exists for a LOSSLESS interaction (clear glass, whose
//     transmission weight is exactly 1 forever, so nothing else could ever end the
//     path). A scattering collision is never lossless, so here the ceiling would BE the
//     terminator: it would cull paths that physically continue and tax every survivor
//     by 1/p for nothing. That compounding factor over hundreds of collisions is the
//     firefly noise this rule exists to remove.
//   eta_scale — it corrects an ACCUMULATED radiance compression across interfaces, and
//     this metric is one event, so there is nothing accumulated to correct.
//
// THE SURVIVAL COMES FROM THE MEDIUM, NOT FROM THE EVENT WEIGHT. An earlier version of
// this rule passed ms.weight, which LOOKS like the dimming factor but is a product:
// the single-scattering albedo (the part this rule is about) times the chromatic
// channel-selection MIS ratio, times — in the GRIN arm — an eta^2 radiance compression.
// Only the first factor is a probability. The consequence was not academic: for any
// medium with a CHROMATIC sigma_t the MIS ratio pushes the product above 1, the clamp
// bound at exactly 1, and the rule did nothing at all — in precisely the dense chromatic
// media (skin, marble) that motivated it. medium_survival() answers sigma_s/sigma_t per
// channel, so THERE IS NO CLAMP HERE, and its absence is the proof the quantity is right.
bool roulette_interior(inout PathState s, int bounce, Spectrum survival) {
    if (bounce < 4) return true;
    // The BRIGHTEST channel, not the mean: never end a path that still carries a bright
    // channel. Averaging would kill paths whose surviving energy sits in one channel,
    // which is exactly the chromatic case that matters (a dense medium whose red travels
    // far and whose blue does not).
    float p_survive = spectrum_max(survival);
    if (p_survive <= 0.0) return false;        // a pure absorber: the path ends here
    // p == 1 (a lossless medium) is deliberately NOT short-circuited. The draw cannot
    // change the outcome and the divide is by one, so an early return would be free
    // correctness-wise — but it would stop consuming a random number, decorrelating the
    // sample stream of every lossless-medium witness (haze, fogcube, F-BOX-M, sss-furnace)
    // for no gain. Stream stability is worth more than one skipped draw.
    if (random() > p_survive) return false;
    s.throughput /= p_survive;
    return true;
}

// ╔══ BLOCK: generated:transport/shadow-crossings  [lines 1221–1224]
// ── Null crossings a shadow ray from this vertex may make (generated) ──
int shadow_crossings_left(PathState s) {
    return MAX_NULL_CROSSINGS - s.null_crossings;
}

// ╔══ BLOCK: components/transport/techniques/kernel/kernel.glsl  [lines 1225–1259]
// T1 — KERNEL SAMPLING (fable-components §7; emitted shape per fable-transport-glsl-target §3).
// One draw serves two estimator terms: the recursion's next segment AND a direct-
// lighting sample scored where it LANDS (the deferred sites below), with the record
// kernel_record carried forward. Weights are the combiner's; this file is the math.
// Provides: kernel_score_miss(), kernel_score_emitter_hit(), kernel_sample_continuation().
// Depends on: PathState core (ray/throughput/radiance ONLY — the static-file rule),
//             combiner_w_env/combiner_w_emitter, kernel_record (generated),
//             interaction_surface_sample/_emission, material_is_emissive,
//             environment_radiance, scene_material_properties, material_of.

void kernel_score_miss(inout PathState s) {
    // Deferred scoring, boundary case: the sample escaped to the environment.
    s.radiance += s.throughput * combiner_w_env(s) * environment_radiance(s.ray.direction, s.ray.wl);
}

void kernel_score_emitter_hit(inout PathState s, Hit hit, int mat, Direction wo, MaterialProperties props) {
    // Deferred scoring: emission keys on region_to (§6.2 — you receive emission from
    // the region ahead, NOT the owner; they differ at exits).
    int mat_emit = material_of(hit.region_to);
    if (!material_is_emissive(mat_emit)) return;
    // No ternary: ANGLE rejects '?:' on struct operands (ESSL restriction).
    MaterialProperties eprops = props;
    if (mat_emit != mat) eprops = scene_material_properties(mat_emit, hit.p, hit.uv, hit.element, hit.wl);
    s.radiance += s.throughput * combiner_w_emitter(s, hit) * interaction_surface_emission(mat_emit, wo, hit, eprops);
}

bool kernel_sample_continuation(inout PathState s, Hit hit, int mat, Direction wo, MaterialProperties props, out InteractionSample bs) {
    // Sample-returns-weight collapses scatter+shade+pdf into one line (§2.1).
    bs = interaction_surface_sample(mat, wo, hit, props, random(), random2());
    if (spectrum_is_black(bs.weight)) return false;
    s.throughput *= bs.weight;
    kernel_record(s, bs.pdf, light_query_surface(mat, hit), (bs.flags & LOBE_DELTA) != 0u);
    return true;
}


// ╔══ BLOCK: components/transport/techniques/kernel/kernel_phase.glsl  [lines 1260–1275]
// T1's medium sampling site (included when scattering media exist).
// Provides: kernel_sample_phase().
// Depends on: PathState core, kernel_record (generated), scene_medium_properties,
//             make_ray, interaction_medium_sample (generated dispatch over the
//             registered phase models).

void kernel_sample_phase(inout PathState s, int med_mat, Point p_evt, Direction wo_med) {
    // Phase sample (§3.5): both current occupants (hg, rayleigh) sample their density
    // exactly, so weight is SPECTRUM_ONE; an inexact phase sampler would carry its
    // ratio in ps.weight and this line already honors it.
    InteractionSample ps = interaction_medium_sample(wo_med, scene_medium_properties(med_mat, p_evt, s.ray.wl), random2());
    s.throughput *= ps.weight;
    kernel_record(s, ps.pdf, light_query_medium(p_evt), false);
    s.ray = make_ray(p_evt, ps.wi, s.ray.wl);   // continue from the event — no surface offset
}


// ╔══ BLOCK: components/transport/techniques/light/light.glsl  [lines 1276–1304]
// T2 — LIGHT SAMPLING / NEE, surface site (included when NEE is on).
// Both edge endpoints known immediately: sample, shadow-test, score — all local.
// Provides: light_sample_direct().
// Depends on: PathState core, combiner_w_light (generated), lighting_sample,
//             shadow_transmittance, shadow_crossings_left (generated), material_has_nondelta_lobes,
//             interaction_surface_eval, ray_spawn, ambient_direction_to, ambient_dot.

void light_sample_direct(inout PathState s, Hit hit, int mat, Direction wo, MaterialProperties props) {
    // Pure-delta materials skip NEE: their eval is zero, the march would be wasted.
    if (!material_has_nondelta_lobes(mat)) return;
    LightSample ls = lighting_sample(light_query_surface(mat, hit), random2(), hit.wl);
    if (ls.pdf <= 0.0) return;
    // The shadow ray tests the segment from the surface to the sampled LIGHT POINT. Its origin is
    // moved hit.eps off the surface (ray_spawn), so its direction is re-aimed from there at the
    // light point: kept parallel to ls.wi it would pass beside the point, hit.eps away, and at a
    // slant it would meet the light's own surface before the back-off. Only visibility uses the
    // aimed direction; f, the cosine and the pdfs below keep ls.wi from hit.p. vis is the
    // per-channel transmittance (§6.3); the walker takes the light point, which fixes its far
    // bound, and the null crossings this path may still make (measurement.maxNullCrossings).
    Point light_p = ambient_geodesic(hit.p, ls.wi, ls.distance);
    Ray shadow_ray = ray_spawn(hit, ls.wi);
    shadow_ray.direction = ambient_direction_to(shadow_ray.origin, light_p);
    Spectrum vis = shadow_transmittance(shadow_ray, light_p, shadow_crossings_left(s));
    if (spectrum_is_black(vis)) return;
    Spectrum f = interaction_surface_eval(mat, ls.wi, wo, hit, props);   // bare f (§2.2)
    float cos_i = abs(ambient_dot(ls.wi, hit.frame.n, hit.p));           // transport applies the cosine (metric)
    s.radiance += s.throughput * ls.radiance * f * cos_i * vis * combiner_w_light(mat, ls, wo, hit, props) / ls.pdf;
}


// ╔══ BLOCK: components/transport/techniques/equiangular/equiangular.glsl  [lines 1305–1362]
// T2 variant — EQUIANGULAR medium NEE, per-segment site (Kulla–Fajardo 2012;
// impl-plan-equiangular). Places the direct-lighting vertex along the segment by the
// angle subtended at the light: pdf(t) ∝ 1/d²(t)-to-light, cancelling the integrand's
// peak that transmittance placement is blind to. Runs ONCE per medium segment with
// segment-start throughput, independent of whether the transmittance sample scatters —
// that independence is the technique's point. Replaces light_medium.glsl's at-vertex
// site under estimator.mediumLightSampling 'equiangular'.
// V1 pins (Validator-enforced): delta lights only; nee only (weight 1 — no combiner
// call until placement-MIS is designed); homogeneous T(0,t) (analytic, matching the
// volumeSampling='analytic' axis). EUCLIDEAN math (t_c, h are extrinsic distances —
// like the analytic medium bodies; curved-space equiangular is a research item).
// Provides: equiangular_sample_direct().
// Depends on: PathState core, lighting_query_delta (generated), shadow_transmittance,
//             shadow_crossings_left (generated),
//             scene_medium_properties, interaction_medium_eval (generated dispatch),
//             spectrum_exp, ambient_geodesic, make_ray.

void equiangular_sample_direct(inout PathState s, int med_mat, float t_max) {
    Point o = s.ray.origin;
    Direction d = s.ray.direction;
    Point pos; Spectrum intensity;
    float select_pdf = lighting_query_delta(random(), pos, intensity, s.ray.wl);

    // The light's frame over the segment: closest approach t_c, perpendicular h.
    vec3 D = pos - o;
    float t_c = dot(D, d);
    float h2 = max(dot(D, D) - t_c * t_c, 1e-8);   // clamp: light on the ray line
    float h = sqrt(h2);

    // Uniform in subtended angle: t = t_c + h·tan(θ); atan2 form is stable at |t−t_c| ≫ h.
    float theta_a = atan(0.0 - t_c, h);
    float theta_b = atan(t_max - t_c, h);
    float theta = mix(theta_a, theta_b, random());
    float t = t_c + h * tan(theta);
    float pdf_t = h / ((theta_b - theta_a) * (h2 + (t - t_c) * (t - t_c)));

    Point p_evt = ambient_geodesic(o, d, t);
    MediumProperties m_evt = scene_medium_properties(med_mat, p_evt, s.ray.wl);

    // Segment transmittance to the sampled vertex — analytic, homogeneous (§4; the v1
    // homogeneous pin — the analytic arm's closed form, restated at this second site).
    Spectrum T_seg = spectrum_exp(-(m_evt.sigma_a + m_evt.sigma_s) * t);

    vec3 to_light = pos - p_evt;
    float d2 = max(dot(to_light, to_light), 1e-8);
    float dist = sqrt(d2);
    Direction wi = to_light / dist;
    // pos = the light POINT (drift-free target); the path's remaining null-crossing budget.
    Spectrum vis = shadow_transmittance(make_ray(p_evt, wi, s.ray.wl), pos, shadow_crossings_left(s));
    if (spectrum_is_black(vis)) return;

    // Delta convention (§6.1): 1/d² folds into the incident radiance here. Phase EVAL,
    // NO cosine (§2.2). σ_s is explicit — this estimate rides no medium_sample weight.
    Direction wo_med = -d;
    s.radiance += s.throughput * T_seg * m_evt.sigma_s * interaction_medium_eval(wi, wo_med, m_evt)
        * (intensity / d2) * vis / (pdf_t * select_pdf);
}


// ╔══ BLOCK: generated:transport/walk  [lines 1363–1422]
// ── The walk (generated): pt over media — the estimator's table of contents ──
// Budget: paths with at most 24 scattering events. The final iteration (bounce == 24)
// only scores emission; NEE and the continuation would add an event beyond the budget.
Radiance transport_trace(Ray ray) {
    PathState s = path_state_init(ray);
    for (int bounce = 0; bounce <= 24; bounce++) {
        Hit hit;
        bool boundary = scene_intersect(s.ray, hit);

        // The volumetric component's call site (§2): one segment, ending at the
        // boundary or far clip; entering/exiting is the interface machinery below.
        int med_mat = material_of(s.current_medium);
        if (material_has_medium(med_mat)) {
            // Per-SEGMENT direct light (equiangular placement, segment-start throughput) —
            // independent of the transmittance sample below; replaces the at-vertex site.
            // It places a scattering event on this segment, so it is part of the budget.
            if (bounce < 24) equiangular_sample_direct(s, med_mat, boundary ? hit.t : MAX_DIST);
            MediumSample ms = medium_sample(med_mat, s.ray, boundary ? hit.t : MAX_DIST, random2());
            s.throughput *= ms.weight;
            if (ms.scattered) {
                // ---- MEDIUM EVENT ---- The event ray comes FROM THE ARM (impl-plan-grin-media:
                // a bent event is not recomputable from (origin, dir, t), so every scattering
                // arm reports position + incident direction on exit_p/exit_dir).
                if (bounce == 24) break;   // a scattering event: over budget
                Point p_evt = ms.exit_p;
                Direction wo_med = -ms.exit_dir;
                kernel_sample_phase(s, med_mat, p_evt, wo_med);
                if (!roulette_interior(s, bounce, medium_survival(med_mat, p_evt, s.ray.wl))) break;
                continue;   // medium events COUNT toward the bounce budget (§7.2)
            }
        }
        if (!boundary) { kernel_score_miss(s); break; }

        // §4.4 self-heal: a missed boundary event mistracks one segment and repairs here.
        if (hit.region_from != s.current_medium) s.current_medium = hit.region_from;
        int mat = material_of(hit.region_owner);   // §4.1: the boundary OWNER's BSDF shades
        // §3.6 null interface: not an optical event — pass through, no bounce consumed.
        // A crossing past measurement.maxNullCrossings leaves the measured set: the path ends.
        if (is_null_interface(mat)) {
            s.current_medium = hit.region_to;
            s.ray = ray_spawn(hit, s.ray.direction);
            s.null_crossings++;
            if (s.null_crossings > MAX_NULL_CROSSINGS) break;
            bounce--;
            continue;
        }
        MaterialProperties props = scene_material_properties(mat, hit.p, hit.uv, hit.element, hit.wl);
        Direction wo = -s.ray.direction;

        kernel_score_emitter_hit(s, hit, mat, wo, props);   // settle last bounce's deferred estimate
        if (bounce == 24) break;   // budget reached: emission is the last term counted
        light_sample_direct(s, hit, mat, wo, props);        // NEE: sample + score locally
        InteractionSample bs;
        if (!kernel_sample_continuation(s, hit, mat, wo, props, bs)) break;
        if ((bs.flags & LOBE_TRANSMISSION) != 0u) s.current_medium = hit.region_to;   // §4.4 tracking
        if (!roulette(s, bounce)) break;
        s.ray = ray_spawn(hit, bs.wi);   // escape wi's side along the geodesic
    }
    return s.radiance;
}

// ╔══ BLOCK: generated:accumulation-inputs  [lines 1423–1423]
uniform sampler2D u_previous;

// ╔══ BLOCK: components/accumulator/average/average.glsl  [lines 1424–1434]
// The running mean — the `average` mode's update rule. After n samples have been folded in,
// the next sample x enters with weight 1/(n+1); the first (n = 0) is written as is, so the
// just-cleared `previous` is never used.
// Provides: average_update().

vec3 average_update(vec3 previous, vec3 x, int n) {
    if (n == 0) return x;
    float new_weight = 1.0 / (float(n) + 1.0);
    return mix(previous, x, new_weight);
}


// ╔══ BLOCK: generated:accumulation-main  [lines 1435–1454]
void main() {
    vec2 pixel = gl_FragCoord.xy + u_pixelOffset;
    // Seed with the GLOBAL pixel (tile offset included) — seeding with the local
    // gl_FragCoord replays the identical RNG stream in every tile of a tiled render.
    // sampleCount decorrelates samples within a render; resetSalt (bumped per
    // accumulation reset) decorrelates across resets (§2.11).
    rng_init(uvec2(pixel), uint(u_sampleCount), uint(u_resetSalt));

    vec2 film = pixel_sample(pixel, random2());   // sub-pixel placement (pixel/ footprint)
    vec2 xiLens = random2();                       // lens-disk sample — cameras without aperture ignore it
    WavelengthSample camera_sample = wavelengths_sample();
    Ray ray = camera_generateRay(film, xiLens, camera_sample.wl);
    Radiance L = transport_trace(ray);
    vec3 color = color_to_pixel(film, ray.direction, L, camera_sample);

    ivec2 coord = ivec2(gl_FragCoord.xy);
    vec3 radiance_previous = texelFetch(u_previous, coord, 0).rgb;
    vec3 radiance_new = average_update(radiance_previous, color, u_sampleCount);
    fragColor = vec4(radiance_new, 1.0);
}