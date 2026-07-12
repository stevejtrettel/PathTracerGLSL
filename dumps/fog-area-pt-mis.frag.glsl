#version 300 es
precision highp float;
precision highp int;

out vec4 fragColor;

#define MAX_SHADOW_SEGMENTS 8
#define TAN_FOV u_tanFov
// Uniforms
uniform vec2 u_resolution;
uniform float u_time;
uniform int u_resetSalt;
uniform vec3 u_clay_albedo;
uniform vec3 u_cameraPosition;
uniform vec3 u_cameraTarget;
uniform vec2 u_imageSize;
uniform float u_tanFov;
uniform int u_sampleCount;
uniform vec2 u_pixelOffset;
uniform sampler2D u_previous;
// Core struct definitions
// Provides: Ray, Hit, Frame, LightSample, MaterialProperties

#define Point vec3
#define Direction vec3
#define Spectrum vec3
#define Radiance vec3

// A geodesic seed: a position + unit direction (a point of the unit tangent bundle). No search
// interval — the far bound is the QUERY's concern, not the ray's: nearest-hit shrinks hit.t;
// occlusion takes a maxDist argument. See docs/trace-loop-contract.md.
struct Ray {
    Point origin;
    Direction direction;
};

struct Frame {
    Point p;
    Direction t;
    Direction b;
    Direction n;
};

struct Hit {
    float t;
    Point p;
    Frame frame;        // shading frame; n oriented toward region_from (§4.1)
    int region_from;    // medium behind the boundary (-1 = ambient) — §4.2 classification
    int region_to;      // medium ahead of the boundary — emission keys on this (§6.2)
    int region_owner;   // whose surface this IS (§4.3) — material_of(region_owner) shades (§4.1)
    vec2 uv;
};

// Light flags (§6.1). LIGHT_DELTA: point/directional — not BSDF-hittable, excluded from BSDF-side MIS.
const uint LIGHT_DELTA = 1u;

struct LightSample {
    Direction wi;         // toward the light, unit
    float distance;       // to the sampled point (1e20 for directional/environment)
    Spectrum radiance;    // incident radiance, WITHOUT visibility (delta lights fold 1/d² in)
    float pdf;            // total: selection × per-light, in solid-angle measure
    uint flags;
    int light_id;
};

struct MaterialProperties {
    Spectrum albedo;
    Spectrum emission;
    float emission_strength;
    float roughness;
    Spectrum transmittance;   // dielectric interface tint (hand-added; schema-generated struct is the reorg pass)
};

// Media struct family — included by core iff the program has media (commit D of the
// item-9 split: conditional INCLUSION replaced the HAS_MEDIA preprocessor gate).

// Medium of a region's interior (§3.5) — read via scene_medium_properties(mat, p); p is
// unused-but-present under V1-C1 (homogeneous). Schema-generated struct is the reorg pass.
struct MediumProperties {
    Spectrum sigma_a;   // absorption
    Spectrum sigma_s;   // scattering
    float    phase_g;   // Henyey–Greenstein anisotropy
};

// The volumetric component's segment decision (fable-volumetric-component.md §2/§3) — the
// return of medium_sample. Mirrors the RTE's three segment terms: weight (attenuation of what
// lies beyond), scattered (inscattering event → transport recurses), radiance (source term —
// governed by the partition rule; the accumulate line is capability-gated and NO v1 strategy
// declares it, but every body MUST still assign the field).
struct MediumSample {
    bool     scattered;  // true: real scattering event at t
    float    t;          // event arc length (valid when scattered)
    Spectrum weight;     // throughput factor for WHICHEVER outcome (§2.1)
    Radiance radiance;   // inline source term (SPECTRUM_ZERO for v1 strategies)
};

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
void build_basis(vec3 n, out vec3 t, out vec3 b) {
    vec3 up = abs(n.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    t = normalize(cross(up, n));
    b = cross(n, t);
}

// Local shading space convention: Z-up (normal direction). cos_theta = local_dir.z
vec3 local_to_world(vec3 local_dir, vec3 n, vec3 t, vec3 b) {
    return local_dir.x * t + local_dir.y * b + local_dir.z * n;
}

// Spectrum helpers for media — included by core iff the program has media (commit D of
// the item-9 split: conditional INCLUSION replaced the HAS_MEDIA preprocessor gate).
Spectrum spectrum_exp(Spectrum s) { return exp(s); }   // Beer–Lambert per channel (§2.5: named, no ad-hoc exp(vec3))

// MIS math — included by core iff the estimator is 'mis' (commit D of the item-9 split:
// conditional INCLUSION replaced the ENABLE_MIS preprocessor gate).
// Power heuristic, β = 2 (§6.4) — ONE definition; both MIS sides use it (reference §8).
float power_heuristic(float pf, float pg) {
    float f2 = pf * pf;
    return f2 / max(1e-20, f2 + pg * pg);
}

// Euclidean Ambient Geometry
// Flat-space geometric operations
// Provides: ambient_geodesic(), ambient_frame(), ambient_dot(), ambient_parallel_transport()

Point ambient_geodesic(Point origin, Direction dir, float t) {
    return origin + dir * t;
}

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

// Ray construction — see docs/trace-loop-contract.md.
// A Ray is a pure geodesic seed: origin + unit direction, no search interval. Self-intersection
// escape is an ORIGIN OFFSET along the geodesic (ray_spawn), so a Ray's origin is already off the
// surface. Search bounds live elsewhere: nearest-hit uses hit.t; occlusion passes a maxDist argument.
// Provides: make_ray(), ray_spawn(). Depends on: Ray/Hit (structs), ambient_geodesic/ambient_dot.

Ray make_ray(Point origin, Direction dir) {
    Ray r;
    r.origin    = origin;
    r.direction = dir;
    return r;
}

// Spawn a scattered/shadow ray from a hit: origin escaped to wi's SIDE of the surface along the
// geodesic (robust at grazing, curved-correct). Transmission gets the far side for free.
Ray ray_spawn(Hit hit, Direction wi) {
    float side = ambient_dot(wi, hit.frame.n, hit.p) >= 0.0 ? 1.0 : -1.0;
    return make_ray(ambient_geodesic(hit.p, hit.frame.n * side, EPSILON), wi);
}

// ── Interface header (generated): the seams this program links ──
// intersection:
bool scene_intersect(Ray ray, out Hit hit);
bool scene_intersect_any(Ray ray, float maxDist);
int scene_region_at(vec3 p);
int material_of(int region);
// materials:
MaterialProperties scene_material_properties(int id, vec3 p);
InteractionSample interaction_surface_sample(int mat, Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u);
Spectrum interaction_surface_eval(int mat, Direction wi, Direction wo, Hit hit, MaterialProperties mp);
float interaction_surface_pdf(int mat, Direction wi, Direction wo, Hit hit, MaterialProperties mp);
Spectrum interaction_surface_emission(int mat, Direction wo, Hit hit, MaterialProperties mp);
bool material_has_nondelta_lobes(int mat);
bool material_is_emissive(int mat);
bool material_has_medium(int mat);
bool is_null_interface(int mat);
MediumProperties scene_medium_properties(int mat, vec3 p);
MediumSample medium_sample(int med, Ray ray, float t_max, vec2 xi);
Spectrum medium_transmittance(int med, Ray ray, float len);
Spectrum hg_eval(Direction wi, Direction wo, MediumProperties mp);
InteractionSample hg_sample(Direction wo, MediumProperties mp, vec2 xi);
float hg_pdf(Direction wi, Direction wo, MediumProperties mp);
// lighting:
LightSample lighting_sample(Point p, vec2 xi);
Spectrum shadow_transmittance(Ray shadow_ray, float maxDist);
int light_of(int region);
float lighting_pdf(Point p, Direction wi, int light_id, Hit light_hit);
// camera:
Ray camera_generateRay(vec2 pixel, vec2 xi);
// environment:
vec3 environment_radiance(vec3 dir);
// transport:
Radiance transport_trace(Ray ray);
// SDF Primitive Library
// Provides: sdf_sphere(), sdf_plane(), sdf_box()
// These are library functions — scene-specific SDF dispatch is generated by the compiler

float sdf_sphere(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

float sdf_plane(vec3 p, vec3 normal, float offset) {
    return dot(p, normal) + offset;
}

float sdf_box(vec3 p, vec3 center, vec3 half_size) {
    vec3 d = abs(p - center) - half_size;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

// Generated SDF dispatch
float sdf_object_0(vec3 p) {
    return sdf_plane(p, vec3(0.0, 1.0, 0.0), 0.0);
}

float sdf_object_1(vec3 p) {
    return sdf_plane(p, vec3(0.0, -1.0, 0.0), 2.0);
}

float sdf_object_2(vec3 p) {
    return sdf_plane(p, vec3(0.0, 0.0, 1.0), 2.0);
}

float sdf_object_3(vec3 p) {
    return sdf_plane(p, vec3(1.0, 0.0, 0.0), 1.5);
}

float sdf_object_4(vec3 p) {
    return sdf_plane(p, vec3(-1.0, 0.0, 0.0), 1.5);
}

float sdf_object_5(vec3 p) {
    return sdf_plane(p, vec3(0.0, 0.0, -1.0), 5.0);
}

float sdf_object_6(vec3 p) {
    p = p - vec3(-0.5, 0.6, -0.5);
    return sdf_box(p, vec3(0.0, 0.0, 0.0), vec3(0.3, 0.6, 0.3));
}

float sdf_object_7(vec3 p) {
    p = p - vec3(0.5, 0.4, 0.3);
    return sdf_sphere(p, vec3(0.0, 0.0, 0.0), 0.4);
}

float scene_march_bound(vec3 p, out int region) {
    float d = 1e20;
    float d_obj;
    region = -1;
    d_obj = abs(sdf_object_0(p));
    if (d_obj < d) { d = d_obj; region = 0; }
    d_obj = abs(sdf_object_1(p));
    if (d_obj < d) { d = d_obj; region = 1; }
    d_obj = abs(sdf_object_2(p));
    if (d_obj < d) { d = d_obj; region = 2; }
    d_obj = abs(sdf_object_3(p));
    if (d_obj < d) { d = d_obj; region = 3; }
    d_obj = abs(sdf_object_4(p));
    if (d_obj < d) { d = d_obj; region = 4; }
    d_obj = abs(sdf_object_5(p));
    if (d_obj < d) { d = d_obj; region = 5; }
    d_obj = abs(sdf_object_6(p));
    if (d_obj < d) { d = d_obj; region = 6; }
    d_obj = abs(sdf_object_7(p));
    if (d_obj < d) { d = d_obj; region = 7; }
    return d;
}

float scene_object_sdf(vec3 p, int region) {
    if (region == 0) return sdf_object_0(p);
    if (region == 1) return sdf_object_1(p);
    if (region == 2) return sdf_object_2(p);
    if (region == 3) return sdf_object_3(p);
    if (region == 4) return sdf_object_4(p);
    if (region == 5) return sdf_object_5(p);
    if (region == 6) return sdf_object_6(p);
    if (region == 7) return sdf_object_7(p);
    return 1e20;
}
// Raymarching Scene Infrastructure — the SDF geometry backend behind scene_intersect.
// Provides: scene_normal(), sdf_intersect(inout Hit), sdf_intersect_any(float maxDist)
// Depends on: scene_march_bound() (generated, unsigned), scene_object_sdf() (generated, per-owner
//             signed field), ambient_geodesic(), ambient_frame()
// The generated scene_intersect/scene_intersect_any dispatcher (intersection.ts) calls these and
// performs the once-per-hit region classification (§4.2) — the marcher only reports geometry + owner.

#ifndef MAX_MARCH_STEPS
#define MAX_MARCH_STEPS 512
#endif
#define MARCH_EPSILON 0.0001
#define NORMAL_EPSILON 0.001

// Acceptance threshold grows with travel distance (pixel-footprint scaling: a fixed 1e-4 at
// t = 40 resolves geometry far below one pixel and just burns steps) but stays CAPPED at half
// of EPS_INTERFACE, so the §4.2 classification probes always clear the accepted residual.
#define MARCH_EPSILON_MAX 0.0005
float march_epsilon(float t) { return min(MARCH_EPSILON_MAX, MARCH_EPSILON * (1.0 + t)); }

// Gradient of the OWNER's own signed field — never the global min, which a containing region's
// deeply-negative sdf hijacks on nested surfaces (the R-SUBMERGED rounded-cube bug).
vec3 scene_normal(vec3 p, int region) {
    vec2 e = vec2(NORMAL_EPSILON, 0.0);

    vec3 n = vec3(
        scene_object_sdf(p + e.xyy, region) - scene_object_sdf(p - e.xyy, region),
        scene_object_sdf(p + e.yxy, region) - scene_object_sdf(p - e.yxy, region),
        scene_object_sdf(p + e.yyx, region) - scene_object_sdf(p - e.yyx, region)
    );

    return normalize(n);
}

// March bounded by the running nearest (hit.t); on a closer surface fill the hit's GEOMETRY
// (p/frame/owner/uv — region_from/to are classified by the dispatcher, §4.2) and return true,
// else leave hit untouched. Marches the UNSIGNED bound min|sdf_i| so interior rays (dielectric
// transmission) and nested geometry work: inside a big region, |signed min| is NOT a safe step
// toward an inner surface — the per-object unsigned min is.
bool sdf_intersect(Ray ray, inout Hit hit) {
    float t = EPSILON;   // near bound (self-intersection handled by the ray_spawn origin offset)
    int region = -1;
    float bound = 1e20;

    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
        vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
        bound = scene_march_bound(p, region);   // region = nearest surface's owner (arg-min)

        // Accept only if CLOSER than the running nearest: the march is blind to analytic
        // surfaces, so without `t < hit.t` a step can sail through an analytic object and
        // commit an SDF surface BEHIND it, clobbering the closer hit (review finding).
        if (bound < march_epsilon(t) && t < hit.t) {
            hit.t = t;
            hit.p = p;
            hit.frame = ambient_frame(p, scene_normal(p, region));   // owner's outward normal; dispatcher orients (§4.1)
            hit.region_owner = region;
            hit.uv = vec2(p.x * 0.1, p.z * 0.1);
            return true;
        }

        if (t > hit.t) {
            return false;   // searched past the running nearest: genuine miss
        }

        t += bound;
    }

    // Budget exhausted. A STALL (bound still small) means the ray is pinned against geometry at
    // grazing incidence — commit the graze as a hit: reporting a miss here paints the
    // BACKGROUND through the silhouette (the black-edge artifact; the ray had no budget left to
    // find the surface behind either). Sub-pixel bias, correct color. A non-stalled exhaustion
    // (long flight through a big scene) remains a miss.
    // Window sizing: face-grazing rays advance by ~their height h per step, so rays with
    // h ≲ face_length / MAX_MARCH_STEPS stall — the window must cover that band. The residual
    // off-surface distance only threatens §4.2 classification on EXIT hits (interior side must
    // stay within EPS_INTERFACE of the surface for the outside probe to clear); entry-side
    // grazes tolerate any δ. 16ε ≈ 8e-3 covers the band at 512 steps for unit-scale faces.
    if (bound < 16.0 * march_epsilon(t) && t < hit.t) {
        vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
        hit.t = t;
        hit.p = p;
        hit.frame = ambient_frame(p, scene_normal(p, region));
        hit.region_owner = region;
        hit.uv = vec2(p.x * 0.1, p.z * 0.1);
        return true;
    }
    return false;
}

bool sdf_intersect_any(Ray ray, float maxDist) {
    int region = -1;

    float t = EPSILON;

    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
        vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
        float bound = scene_march_bound(p, region);   // unsigned: valid from inside media/solids too

        if (bound < march_epsilon(t)) {
            return true;
        }

        if (t > maxDist) {
            return false;   // cleared the light distance: unoccluded
        }

        t += bound;
    }

    // Budget exhausted while still inside the search interval: pinned against geometry at
    // grazing. Conservatively OCCLUDED — the old `return false` here LEAKED light through
    // contact edges (the inverse of the primary-ray black-edge artifact). Over-darkening a
    // grazed shadow ray is the physically-safe failure direction.
    return true;
}

// Closed-form ray–primitive intersection — the analytic geometry backend.
// Straight-ray algebra because the tracer is Euclidean FOR NOW; closed-form geodesic–surface
// intersection in curved spaces is a later job, not precluded (the abstraction doesn't assume
// straight rays). Provides: ray_sphere(), ray_plane(). Depends on: Ray (structs).
// (The dots below are Euclidean ray-geometry algebra — raw dot, not ambient_dot; see the
//  trace-loop contract's metric rule. Moot while the tracer is flat.)

// Nearest intersection ahead of the ray with a sphere (t > EPSILON). direction is unit → a = 1.
// The FAR bound is the caller's job (t < hit.t for nearest-hit, t < maxDist for occlusion).
bool ray_sphere(Ray ray, vec3 center, float radius, out float t) {
    vec3 oc = ray.origin - center;
    float b = dot(oc, ray.direction);
    float c = dot(oc, oc) - radius * radius;
    float disc = b * b - c;
    if (disc < 0.0) return false;
    float s = sqrt(disc);
    // Root selection by the INSIDE test (c < 0), never by a t-threshold: an outside origin
    // within EPSILON of the surface must NOT fall through to the far root — that skips the
    // entry interface and fakes an exit from a region the ray never entered (review finding).
    // Outside origins whose near root is ≤ EPSILON now miss (hairline, energy-bounded).
    t = (c < 0.0) ? (-b + s) : (-b - s);
    return (t > EPSILON);
}

// Intersection with the plane dot(p, normal) + offset = 0 (matches the SDF plane convention).
bool ray_plane(Ray ray, vec3 normal, float offset, out float t) {
    float denom = dot(ray.direction, normal);
    if (abs(denom) < 1e-8) return false;   // ray parallel to the plane
    t = -(dot(ray.origin, normal) + offset) / denom;
    return (t > EPSILON);
}

// Intersection with the parallelogram corner + u·edge1 + v·edge2, u,v ∈ [0,1] (a "quad").
// Zero-thickness: it never claims containment in scene_region_at, so it is naturally
// ONE-SIDED under the region_to emission convention (impl-plan-area-lights pinned deviation).
// `normal` is the precompiled unit cross(edge1, edge2) — the emitting side.
bool ray_quad(Ray ray, vec3 corner, vec3 edge1, vec3 edge2, vec3 normal, out float t) {
    float denom = dot(ray.direction, normal);
    if (abs(denom) < 1e-8) return false;                   // parallel to the quad's plane
    t = dot(corner - ray.origin, normal) / denom;
    if (t <= EPSILON) return false;
    vec3 local = ray.origin + ray.direction * t - corner;  // Euclidean backend (see header note)
    // Inside test via the plane's 2x2 Gram system (edges need not be orthogonal).
    float e11 = dot(edge1, edge1), e22 = dot(edge2, edge2), e12 = dot(edge1, edge2);
    float d1 = dot(local, edge1), d2 = dot(local, edge2);
    float det = e11 * e22 - e12 * e12;                     // > 0 (Validator rejects degenerate)
    float u = (d1 * e22 - d2 * e12) / det;
    float v = (d2 * e11 - d1 * e12) / det;
    return (u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= 1.0);
}

// Generated analytic dispatch
bool analytic_intersect(Ray ray, inout Hit hit) {
    bool found = false;
    float t;
    if (ray_quad(ray, vec3(-0.5, 1.98, -0.5), vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0), vec3(0.0, -1.0, 0.0), t) && t < hit.t) {
        hit.t = t; found = true;
        hit.p = ambient_geodesic(ray.origin, ray.direction, t);
        hit.frame = ambient_frame(hit.p, vec3(0.0, -1.0, 0.0));
        hit.region_owner = 8;
        hit.uv = vec2(hit.p.x * 0.1, hit.p.z * 0.1);
    }
    return found;
}

bool analytic_intersect_any(Ray ray, float maxDist) {
    float t;
    if (ray_quad(ray, vec3(-0.5, 1.98, -0.5), vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0), vec3(0.0, -1.0, 0.0), t) && t < maxDist) return true;
    return false;
}
// Generated region -> material table (§2.3), across both backends
int material_of(int region) {
    if (region == 0) return 4;
    if (region == 1) return 4;
    if (region == 2) return 4;
    if (region == 3) return 3;
    if (region == 4) return 1;
    if (region == 5) return 4;
    if (region == 6) return 4;
    if (region == 7) return 0;
    if (region == 8) return 5;
    return 2;
}
// Generated point classification (§2.7 innermost-wins)
int scene_region_at(vec3 p) {
    int region = -1;
    float best = -1.0e20;   // best = least-negative inside distance so far
    float d;
    d = sdf_object_0(p);
    if (d < 0.0 && d > best) { best = d; region = 0; }
    d = sdf_object_1(p);
    if (d < 0.0 && d > best) { best = d; region = 1; }
    d = sdf_object_2(p);
    if (d < 0.0 && d > best) { best = d; region = 2; }
    d = sdf_object_3(p);
    if (d < 0.0 && d > best) { best = d; region = 3; }
    d = sdf_object_4(p);
    if (d < 0.0 && d > best) { best = d; region = 4; }
    d = sdf_object_5(p);
    if (d < 0.0 && d > best) { best = d; region = 5; }
    d = sdf_object_6(p);
    if (d < 0.0 && d > best) { best = d; region = 6; }
    d = sdf_object_7(p);
    if (d < 0.0 && d > best) { best = d; region = 7; }
    d = 1.0e20;
    if (d < 0.0 && d > best) { best = d; region = 8; }
    return region;
}
// Generated scene_intersect dispatcher
bool scene_region_thin(int region) {
    return region == 8;
}

bool scene_intersect(Ray ray, out Hit hit) {
    hit.t = MAX_DIST;   // running nearest = far clip; rest of hit undefined until a backend fills it
    bool found = false;
    if (analytic_intersect(ray, hit)) found = true;
    if (sdf_intersect(ray, hit)) found = true;
    if (found) {
        // §4.2/§4.3: one outside-probe along the outward normal; owner covers its own side.
        int outside = scene_region_at(ambient_geodesic(hit.p, hit.frame.n, EPS_INTERFACE));
        if (ambient_dot(ray.direction, hit.frame.n, hit.p) < 0.0) {
            hit.region_from = outside;              // entering the owner
            hit.region_to   = hit.region_owner;
        } else {
            // Back-face hit on a zero-thickness owner: probe the entering (-n) side.
            hit.region_from = scene_region_thin(hit.region_owner)
                ? scene_region_at(ambient_geodesic(hit.p, hit.frame.n, -EPS_INTERFACE))
                : hit.region_owner;             // solid owners cover their own side
            hit.region_to   = outside;
            hit.frame = ambient_frame(hit.p, -hit.frame.n);   // §4.1: n faces region_from
        }
    }
    return found;
}

bool scene_intersect_any(Ray ray, float maxDist) {
    if (analytic_intersect_any(ray, maxDist)) return true;
    if (sdf_intersect_any(ray, maxDist)) return true;
    return false;
}
// Generated material properties lookup
MaterialProperties scene_material_properties(int id, vec3 p) {
    MaterialProperties props;
    props.albedo = Spectrum(0.8);
    props.emission = SPECTRUM_ZERO;
    props.emission_strength = 0.0;
    props.roughness = 1.0;
    props.transmittance = SPECTRUM_ONE;
    if (id == 0) {
        props.albedo = u_clay_albedo;
        props.roughness = 1.0;
    }
    else if (id == 1) {
        props.albedo = vec3(0.12, 0.45, 0.15);
        props.roughness = 1.0;
    }
    else if (id == 2) {
        props.albedo = vec3(0.8, 0.8, 0.8);
        props.roughness = 1.0;
    }
    else if (id == 3) {
        props.albedo = vec3(0.65, 0.05, 0.05);
        props.roughness = 1.0;
    }
    else if (id == 4) {
        props.albedo = vec3(0.73, 0.73, 0.73);
        props.roughness = 1.0;
    }
    else if (id == 5) {
        props.albedo = vec3(0.0, 0.0, 0.0);
        props.emission = vec3(15.0, 15.0, 15.0);
        props.emission_strength = 1.0;
        props.roughness = 1.0;
    }
    return props;
}
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
    return mp.emission * mp.emission_strength;  // fixed struct still splits these (§3.4 defers the merge)
}

// Generated surface-interaction dispatch (§3.3)
InteractionSample interaction_surface_sample(int mat, Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    return lambert_sample(wo, hit, mp, uc, u);
}
Spectrum interaction_surface_eval(int mat, Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    return lambert_eval(wi, wo, hit, mp);
}
float interaction_surface_pdf(int mat, Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    return lambert_pdf(wi, wo, hit, mp);
}
Spectrum interaction_surface_emission(int mat, Direction wo, Hit hit, MaterialProperties mp) {
    return lambert_emission(wo, hit, mp);
}
// Generated NEE guard: pure-delta materials skip the shadow ray (eval ≡ 0)
bool material_has_nondelta_lobes(int mat) {
    if (mat == 2) return false;
    return true;
}
// Generated emission gate: fetch/dispatch emission only where it can exist
bool material_is_emissive(int mat) {
    return mat == 5;
}
// Generated media capability tables (§3.5/§3.6)
bool is_null_interface(int mat) {
    return mat == 2;
}
bool material_has_medium(int mat) {
    return mat == 2;
}
// Generated medium-properties lookup (§3.5; p unused-but-present under V1-C1)
MediumProperties scene_medium_properties(int mat, vec3 p) {
    MediumProperties m;
    m.sigma_a = SPECTRUM_ZERO;
    m.sigma_s = SPECTRUM_ZERO;
    m.phase_g = 0.0;
    if (mat == 2) {   // 'haze'
        m.sigma_a = vec3(0.05, 0.05, 0.05);
        m.sigma_s = vec3(0.4, 0.4, 0.4);
        m.phase_g = 0.6;
    }
    return m;
}
// medium_analytic.glsl — the v1 'analytic' volume strategy bodies (V1-C1: homogeneous,
// closed-form). NORMATIVE SOURCE: fable-volumetric-component.md §4 — transcribe, don't
// re-derive. Chromatic sampling is pbrt-v3's uniform CHANNEL SELECTION with the
// balance-heuristic weight over per-channel exponential pdfs (owner decision; bounded
// weights — NOT the σ̄ ratio-weight scheme of reference-implementations §5, superseded).
// Grayscale degeneracy check: scatter weight → σ_s/σ_t (single-scatter albedo), survival
// weight → 1 — the §7.2 "no weight on survival" pin is the special case of these formulas.

MediumSample medium_sample_analytic(MediumProperties m, float t_max, vec2 xi) {
    Spectrum sigma_t = m.sigma_a + m.sigma_s;

    int   c  = min(int(xi.x * 3.0), 2);               // uniform channel selection
    float sc = max(sigma_t[c], 1e-9);                 // zero channel → huge t → survive branch
    float t  = -log(1.0 - xi.y) / sc;

    MediumSample ms;
    ms.radiance = SPECTRUM_ZERO;                      // mandatory (§3 partition rule)
    if (t < t_max) {
        // Scatter event at t. pdf = (1/3) Σ_c σ_c e^{−σ_c t} (one-sample MIS over channels).
        Spectrum tr  = spectrum_exp(-sigma_t * t);
        float    pdf = spectrum_average(sigma_t * tr);
        ms.scattered = true;
        ms.t         = t;
        ms.weight    = m.sigma_s * tr / max(pdf, 1e-20);
    } else {
        // Survived to the boundary. pdf = P(t ≥ t_max) = (1/3) Σ_c e^{−σ_c t_max}.
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

// Generated volumetric-component dispatch (seam 1, fable-volumetric-component §2)
MediumSample medium_sample(int med, Ray ray, float t_max, vec2 xi) {
    MediumSample ms;
    ms.scattered = false;
    ms.t = t_max;
    ms.weight = SPECTRUM_ONE;
    ms.radiance = SPECTRUM_ZERO;
    if (med == 2) {   // 'haze' — scattering (analytic channel-MIS)
        return medium_sample_analytic(scene_medium_properties(2, ray.origin), t_max, xi);
    }
    return ms;
}
// Generated volumetric-component dispatch (seam 2, fable-volumetric-component §2)
Spectrum medium_transmittance(int med, Ray ray, float len) {
    if (med == 2) {   // 'haze'
        return medium_transmittance_analytic(scene_medium_properties(2, ray.origin), len);
    }
    return SPECTRUM_ONE;
}
// Shadow transmittance — media form (§6.3; emitted INSTEAD of shadow_opaque when the scene
// has media + NEE; the NEE call sites never change). Segment-walk by RE-SPAWN
// (impl-plan-media deviation 1: the reference's t-windowed scene_intersect_from predates the
// trace-loop contract — same segments, pinned signatures only).
// Per segment: closed-form Beer–Lambert over full σ_t via medium_transmittance (generated,
// seam 2). Null interfaces pass; EVERYTHING else — opaque and dielectric alike — blocks
// (§6.3 v1 policy; transparent shadows are §10.2). Segment budget exhaustion is conservative
// (ZERO). Depends on: scene_intersect/scene_region_at (intersection), material_of,
// material_has_medium/is_null_interface/medium_transmittance (materials), ray_spawn (core),
// MAX_SHADOW_SEGMENTS (define, pin: 8).

Spectrum shadow_transmittance(Ray shadow_ray, float maxDist) {
    Spectrum T = SPECTRUM_ONE;
    // Starting medium recovered from the §4.4 containment oracle — self-contained, no
    // signature change (works from surface points and medium event points alike).
    int medium = scene_region_at(shadow_ray.origin);
    Ray seg_ray = shadow_ray;
    float remaining = maxDist;

    for (int seg = 0; seg < MAX_SHADOW_SEGMENTS; seg++) {
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
        remaining -= h.t;                                         // EPS gaps ~1e-3/crossing: negligible
        seg_ray = ray_spawn(h, seg_ray.direction);                // far side by sign(dir·n)
    }
    return SPECTRUM_ZERO;                                         // budget exhausted: conservative
}

// Quad area light — uniform surface sampling, area→solid-angle pdf (§6.1 / reference §6.1).
// Provides: quad_light_sample(). Depends on: LightSample (structs), Point/Spectrum typedefs.
// ONE-SIDED: emits from the cross(edge1, edge2) side (impl-plan-area-lights pinned deviation);
// the hit-side region_to convention agrees. n_l and area are precompiled constants.
// Pitfall 1: radiance carries NO 1/d² — the falloff IS the d²/(A·cosθ) measure (double-falloff bug).
// Pitfall 2: back-face samples return pdf = 0 (the old GLSL's pdf=1,radiance=0 poisons MIS).
// METRIC EXEMPTION (trace-loop contract): raw dot() on world-space physical directions is
// deliberate — light samplers are Euclidean closed forms; curved spaces get new bodies (§5.3).

LightSample quad_light_sample(Point corner, vec3 edge1, vec3 edge2, Direction n_l, float area, Spectrum Le, Point p, vec2 xi) {
    Point q = corner + xi.x * edge1 + xi.y * edge2;
    vec3 d = q - p;
    float d2 = dot(d, d);

    LightSample ls;
    ls.wi       = d * inversesqrt(d2);
    ls.distance = sqrt(d2);
    ls.radiance = Le;                       // NO distance falloff (§6.1)
    ls.flags    = 0u;                       // non-delta: hittable, MIS-eligible
    ls.light_id = -1;                       // dispatcher sets the real id

    float cos_l = dot(n_l, -ls.wi);         // emitter-side cosine
    if (cos_l <= 0.0) { ls.pdf = 0.0; return ls; }   // behind the emitter: invalid sample

    // THE measure conversion: pdf_area = 1/A, converted to solid angle at p (§6.1).
    ls.pdf = d2 / (area * cos_l);
    return ls;
}

// Generated light selection dispatcher (§6.1)
LightSample lighting_sample(Point p, vec2 xi) {
    LightSample ls;
    ls = quad_light_sample(vec3(-0.5, 1.98, -0.5), vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0), vec3(0.0, -1.0, 0.0), 1.0, vec3(15.0, 15.0, 15.0), p, xi);
    ls.light_id = 0;
    return ls;
}
// Generated region -> samplable-light table (§6.2; -1 = path-only or non-emitter)
int light_of(int region) {
    if (region == 8) return 0;
    return -1;
}
// Generated MIS pdf query (§6.1) — must mirror lighting_sample exactly
float lighting_pdf(Point p, Direction wi, int light_id, Hit light_hit) {
    if (light_id == 0) {
        float cos_l = dot(vec3(0.0, -1.0, 0.0), -wi);
        if (cos_l <= 0.0) return 0.0;
        vec3 d = light_hit.p - p;
        return 1.0 * dot(d, d) / (1.0 * cos_l);
    }
    return 0.0;
}
// Pinhole camera
// Requires: TAN_FOV (define), u_imageSize, u_cameraPosition, u_cameraTarget

Ray camera_generateRay(vec2 pixel, vec2 xi) {
    vec2 jittered_pixel = pixel + (xi - 0.5);
    vec2 ndc = (2.0 * jittered_pixel / u_imageSize) - 1.0;
    float aspect = u_imageSize.x / u_imageSize.y;
    ndc.x *= aspect;

    vec3 forward = normalize(u_cameraTarget - u_cameraPosition);
    // Degenerate up-reference guard: forward ∥ ±Y makes cross(forward, +Y) zero-length —
    // normalize(0) is NaN and poisons every ray of the frame. Fall back to +Z as reference.
    vec3 up_ref = abs(forward.y) > 0.999999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(forward, up_ref));
    vec3 up = cross(right, forward);

    vec3 dir = normalize(forward + ndc.x * TAN_FOV * right + ndc.y * TAN_FOV * up);

    return make_ray(u_cameraPosition, dir);   // tmin = EPSILON, tmax = MAX_DIST
}

// Environment radiance
vec3 environment_radiance(vec3 dir) {
    return SPECTRUM_ZERO;
}
// Path trace loop — generated for this scene and strategy (item-9 transport generator).
Radiance transport_trace(Ray ray) {
    Spectrum throughput = SPECTRUM_ONE;
    Radiance radiance   = SPECTRUM_ZERO;
    Ray current_ray = ray;

    // §4.4: THE medium variable — a single int ground-truthed by classification (self-heal
    // at each hit), never a stack. Initialized by classifying the camera origin, so a camera
    // inside a bounded medium tracks its primary segment correctly.
    int current_medium = scene_region_at(ray.origin);
    int null_crossings = 0;   // §3.6: nulls are bookkeeping with their own safety counter

    // §6.2 bookkeeping: the camera "bounce" counts as delta so bounce-0 emission is full-weight.
    bool prev_was_delta = true;
    // Reference §8: the previous vertex and its sampled solid-angle pdf — the BSDF side of the
    // emitter-hit power heuristic. Written at surface AND medium scattering events.
    float prev_bsdf_pdf = 0.0;
    Point prev_p = ray.origin;

    for (int bounce = 0; bounce < 16; bounce++) {
        Hit hit;
        bool boundary = scene_intersect(current_ray, hit);

        // The volumetric component's call site (fable-volumetric-component §2): one segment,
        // ending at the boundary or the far clip. medium_sample never sees a boundary;
        // entering/exiting is the interface machinery's job below.
        int med_mat = material_of(current_medium);
        if (material_has_medium(med_mat)) {
            MediumSample ms = medium_sample(med_mat, current_ray, boundary ? hit.t : MAX_DIST, random2());
            throughput *= ms.weight;
            if (ms.scattered) {
                // ---- MEDIUM EVENT (§7.2 step 2) ----
                Point p_evt = ambient_geodesic(current_ray.origin, current_ray.direction, ms.t);
                Direction wo_med = -current_ray.direction;
                // NEE from the medium point: phase EVAL, NO cosine (§2.2 — the cosine is a
                // surface Jacobian). Spectral shadow query (shadow_media) walks the segments.
                {
                    MediumProperties m_evt = scene_medium_properties(med_mat, p_evt);
                    LightSample ls = lighting_sample(p_evt, random2());
                    if (ls.pdf > 0.0) {
                        // Same 2·EPSILON back-off as the surface site: an AREA light's sampled point
                        // is ON the emitter's surface — a 1·EPSILON far bound is a float coin flip.
                        Spectrum vis = shadow_transmittance(make_ray(p_evt, ls.wi), ls.distance - 2.0 * EPSILON);
                        if (!spectrum_is_black(vis)) {
                            // Reference §8's closing line: the medium-side NEE weight balances
                            // against the phase density (hg_pdf) — no cosine anywhere (§2.2).
                            float w_m = 1.0;
                            if ((ls.flags & LIGHT_DELTA) == 0u) {
                                w_m = power_heuristic(ls.pdf, hg_pdf(ls.wi, wo_med, m_evt));
                            }
                            radiance += throughput * ls.radiance * hg_eval(ls.wi, wo_med, m_evt) * vis * w_m / ls.pdf;
                        }
                    }
                }
                // Phase sample (§3.5): weight is SPECTRUM_ONE exactly — HG sampling is exact.
                InteractionSample ps = hg_sample(wo_med, scene_medium_properties(med_mat, p_evt), random2());
                throughput *= ps.weight;
                prev_was_delta = false;
                prev_bsdf_pdf = ps.pdf;
                prev_p = p_evt;
                current_ray = make_ray(p_evt, ps.wi);   // continue from the event — no surface offset

                // Russian roulette — §7.2 pin: once per iteration, post-weight (medium events included).
                float rr_metric_med = spectrum_max(throughput);   // §2.5: basis-agnostic, no Rec.709 weights
                if (bounce >= 3) {
                    float p_survive_med = min(0.95, rr_metric_med);
                    if (random() > p_survive_med) break;
                    throughput /= p_survive_med;
                }
                continue;   // loop-header bounce++: medium events COUNT toward the budget (§7.2)
            }
        }
        if (!boundary) {
            radiance += throughput * environment_radiance(current_ray.direction);
            break;
        }

        // §4.4 self-heal (free — the operand was already classified): a missed boundary event
        // mistracks exactly one segment and repairs here, instead of corrupting the path.
        if (hit.region_from != current_medium) current_medium = hit.region_from;

        int mat = material_of(hit.region_owner);        // §4.1: the boundary OWNER's BSDF shades (≠ region_to at exits)
        // §3.6 null interface: the boundary is not an optical event — pass through in the same
        // direction; no emission, no NEE, no bounce consumed (nulls have their own safety counter).
        if (is_null_interface(mat)) {
            current_medium = hit.region_to;
            current_ray = ray_spawn(hit, current_ray.direction);   // far side by sign(dir·n)
            null_crossings++;
            if (null_crossings > 32) break;
            bounce--;
            continue;
        }
        MaterialProperties props = scene_material_properties(mat, hit.p);
        Direction wo = -current_ray.direction;

        // Emission keys on region_to (§6.2 side convention: you receive emission from the region
        // ahead) — NOT on the owner. They differ at exits: leaving an emissive region contributes
        // nothing from behind.
        int mat_emit = material_of(hit.region_to);
        if (material_is_emissive(mat_emit)) {
            // No ternary here: ANGLE rejects '?:' on struct operands (ESSL restriction).
            MaterialProperties eprops = props;
            if (mat_emit != mat) eprops = scene_material_properties(mat_emit, hit.p);
            // §6.2 double-count bookkeeping: a SAMPLABLE emitter (light_of ≥ 0) found by a
            // non-delta bounce was already counted by NEE at the previous vertex. Path-only
            // emitters, post-delta hits, and the camera "bounce" stay full-weight.
            float w_emit = 1.0;
            int lid_emit = light_of(hit.region_to);
            if (lid_emit >= 0 && !prev_was_delta) {
                w_emit = power_heuristic(prev_bsdf_pdf, lighting_pdf(prev_p, current_ray.direction, lid_emit, hit));
            }
            radiance += throughput * w_emit * interaction_surface_emission(mat_emit, wo, hit, eprops);
        }

        // Next Event Estimation (explicit xi — §2.9; delta lights ignore it). Pure-delta
        // materials skip it entirely: their eval is zero, the shadow march would be wasted.
        if (material_has_nondelta_lobes(mat)) {
            LightSample ls = lighting_sample(hit.p, random2());
            if (ls.pdf > 0.0) {
                // §6.3: per-channel transmittance. Back-off is 2·EPSILON: ray_spawn moved the origin
                // up to EPSILON along the normal, so an AREA light's own surface can sit at exactly
                // distance−EPSILON from the spawned origin (the dark-tops bug).
                Ray shadow_ray = ray_spawn(hit, ls.wi);
                Spectrum vis = shadow_transmittance(shadow_ray, ls.distance - 2.0 * EPSILON);
                if (!spectrum_is_black(vis)) {
                    Spectrum f = interaction_surface_eval(mat, ls.wi, wo, hit, props);  // bare f (§2.2)
                    float cos_i = abs(ambient_dot(ls.wi, hit.frame.n, hit.p));          // transport applies the cosine (metric)
                    // Reference §8 line 2: balance the light sample against the BSDF's density.
                    // Delta lights get weight 1 — BSDF sampling can never hit them (§6.4).
                    float w_l = 1.0;
                    if ((ls.flags & LIGHT_DELTA) == 0u) {
                        w_l = power_heuristic(ls.pdf, interaction_surface_pdf(mat, ls.wi, wo, hit, props));
                    }
                    radiance += throughput * ls.radiance * f * cos_i * vis * w_l / ls.pdf;
                }
            }
        }

        // BSDF sampling: sample-returns-weight collapses scatter+shade+pdf into one line (§2.1).
        InteractionSample bs = interaction_surface_sample(mat, wo, hit, props, random(), random2());
        if (spectrum_is_black(bs.weight)) break;
        throughput *= bs.weight;
        prev_was_delta = (bs.flags & LOBE_DELTA) != 0u;
        prev_bsdf_pdf = bs.pdf;
        prev_p = hit.p;

        // §4.4: transmission moves the path into the far region's medium.
        if ((bs.flags & LOBE_TRANSMISSION) != 0u) current_medium = hit.region_to;

        // Russian roulette — §7.2 pin: once per iteration, post-weight.
        float rr_metric = spectrum_max(throughput);   // §2.5: basis-agnostic, no Rec.709 weights
        if (bounce >= 3) {
            float p_survive = min(0.95, rr_metric);
            if (random() > p_survive) break;
            throughput /= p_survive;
        }
        // Continuation ray: ray_spawn escapes the origin to wi's side of the surface along the
        // geodesic (self-intersection; transmission gets the far side). See docs/trace-loop-contract.md.
        current_ray = ray_spawn(hit, bs.wi);
    }

    return radiance;
}
// Main function with progressive accumulation
// Requires: u_pixelOffset, u_sampleCount, u_resetSalt, u_previous

void main() {
    vec2 pixel = gl_FragCoord.xy + u_pixelOffset;
    // Seed with the GLOBAL pixel (tile offset included) — seeding with the local
    // gl_FragCoord replays the identical RNG stream in every tile of a tiled render.
    // sampleCount decorrelates samples within a render; resetSalt (bumped per
    // accumulation reset) decorrelates across resets (§2.11).
    rng_init(uvec2(pixel), uint(u_sampleCount), uint(u_resetSalt));

    vec2 xi = random2();
    Ray ray = camera_generateRay(pixel, xi);
    vec3 color = transport_trace(ray);

    if (u_sampleCount == 0) {
        fragColor = vec4(color, 1.0);
    } else {
        ivec2 coord = ivec2(gl_FragCoord.xy);
        vec3 previous = texelFetch(u_previous, coord, 0).rgb;
        float n = float(u_sampleCount);
        float new_weight = 1.0 / (n + 1.0);
        fragColor = vec4(mix(previous, color, new_weight), 1.0);
    }
}
