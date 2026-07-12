#version 300 es
precision highp float;
precision highp int;

out vec4 fragColor;

#define TAN_FOV 0.4227932187381618
// Uniforms
uniform vec2 u_resolution;
uniform float u_time;
uniform int u_resetSalt;
uniform vec3 u_cameraPosition;
uniform vec3 u_cameraTarget;
uniform vec2 u_imageSize;
uniform vec3 u_environment_color;
uniform float u_environment_intensity;
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
// lighting:
LightSample lighting_sample(Point p, vec2 xi);
Spectrum shadow_transmittance(Ray shadow_ray, float maxDist);
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
    return sdf_plane(p, vec3(0.0, 1.0, 0.0), 1.0);
}

float sdf_object_1(vec3 p) {
    p = p - vec3(0.0, 0.0, 0.0);
    return sdf_sphere(p, vec3(0.0, 0.0, 0.0), 1.0);
}

float scene_march_bound(vec3 p, out int region) {
    float d = 1e20;
    float d_obj;
    region = -1;
    d_obj = abs(sdf_object_0(p));
    if (d_obj < d) { d = d_obj; region = 0; }
    d_obj = abs(sdf_object_1(p));
    if (d_obj < d) { d = d_obj; region = 1; }
    return d;
}

float scene_object_sdf(vec3 p, int region) {
    if (region == 0) return sdf_object_0(p);
    if (region == 1) return sdf_object_1(p);
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

// Generated region -> material table (§2.3), across both backends
int material_of(int region) {
    if (region == 0) return 0;
    if (region == 1) return 1;
    return -1;
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
    return region;
}
// Generated scene_intersect dispatcher
bool scene_intersect(Ray ray, out Hit hit) {
    hit.t = MAX_DIST;   // running nearest = far clip; rest of hit undefined until a backend fills it
    bool found = false;
    if (sdf_intersect(ray, hit)) found = true;
    if (found) {
        // §4.2/§4.3: one outside-probe along the outward normal; owner covers its own side.
        int outside = scene_region_at(ambient_geodesic(hit.p, hit.frame.n, EPS_INTERFACE));
        if (ambient_dot(ray.direction, hit.frame.n, hit.p) < 0.0) {
            hit.region_from = outside;              // entering the owner
            hit.region_to   = hit.region_owner;
        } else {
            hit.region_from = hit.region_owner;     // exiting the owner
            hit.region_to   = outside;
            hit.frame = ambient_frame(hit.p, -hit.frame.n);   // §4.1: n faces region_from
        }
    }
    return found;
}

bool scene_intersect_any(Ray ray, float maxDist) {
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
        props.albedo = vec3(0.6, 0.6, 0.6);
        props.roughness = 1.0;
    }
    else if (id == 1) {
        props.albedo = vec3(0.9, 0.2, 0.2);
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
    return true;
}
// Generated emission gate: fetch/dispatch emission only where it can exist
bool material_is_emissive(int mat) {
    return false;
}
// Shadow transmittance — opaque specialization (§6.3, revised per docs/trace-loop-contract.md).
// Provides: shadow_transmittance(). Depends on: scene_intersect_any() (intersection),
//           Ray/Spectrum (structs), SPECTRUM_ZERO/ONE (math).
//
// The contract returns a Spectrum: the per-channel fraction of light surviving the shadow ray.
// This is the OPAQUE specialization the compiler emits when the scene has no media —
// transmittance is exactly 0 (blocked) or 1 (clear), the boolean occlusion test behind the
// spectral contract. When media exist the compiler emits the segment-walking form instead
// (reference-implementations §4); the NEE call site never changes. The caller passes the shadow
// Ray (origin escaped off the surface) and the far bound (the light distance) as maxDist.

Spectrum shadow_transmittance(Ray shadow_ray, float maxDist) {
    return scene_intersect_any(shadow_ray, maxDist) ? SPECTRUM_ZERO : SPECTRUM_ONE;
}

// Point light — delta light sampler (§6.1 / reference §6.3).
// Provides: point_light_sample(). Depends on: LightSample, LIGHT_DELTA, Point, Spectrum.
// The per-kind library (mirrors lambert.glsl); the generated dispatcher calls it with the
// light's baked constants. Delta light: 1/d² falloff is folded into radiance, per-light pdf = 1.

LightSample point_light_sample(Point position, Spectrum intensity, Point p) {
    vec3 d = position - p;
    float d2 = dot(d, d);

    LightSample ls;
    ls.wi       = d * inversesqrt(d2);
    ls.distance = sqrt(d2);
    ls.radiance = intensity / d2;      // falloff folded in (delta light, §6.1)
    ls.pdf      = 1.0;                  // per-light pdf; selection pdf applied by the dispatcher
    ls.flags    = LIGHT_DELTA;
    ls.light_id = -1;                  // dispatcher sets the real id
    return ls;
}

// Generated light selection dispatcher (§6.1)
LightSample lighting_sample(Point p, vec2 xi) {
    LightSample ls;
    ls = point_light_sample(vec3(3.0, 4.0, 2.0), vec3(30.0, 30.0, 30.0), p);
    ls.light_id = 0;
    return ls;
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
    return u_environment_color * u_environment_intensity;
}
// Path trace loop — generated for this scene and strategy (item-9 transport generator).
Radiance transport_trace(Ray ray) {
    Spectrum throughput = SPECTRUM_ONE;
    Radiance radiance   = SPECTRUM_ZERO;
    Ray current_ray = ray;

    // §6.2 bookkeeping: the camera "bounce" counts as delta so bounce-0 emission is full-weight.
    bool prev_was_delta = true;

    for (int bounce = 0; bounce < 8; bounce++) {
        Hit hit;
        if (!scene_intersect(current_ray, hit)) {
            radiance += throughput * environment_radiance(current_ray.direction);
            break;
        }

        int mat = material_of(hit.region_owner);        // §4.1: the boundary OWNER's BSDF shades (≠ region_to at exits)
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
            radiance += throughput * interaction_surface_emission(mat_emit, wo, hit, eprops);
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
                    radiance += throughput * ls.radiance * f * cos_i * vis / ls.pdf;
                }
            }
        }

        // BSDF sampling: sample-returns-weight collapses scatter+shade+pdf into one line (§2.1).
        InteractionSample bs = interaction_surface_sample(mat, wo, hit, props, random(), random2());
        if (spectrum_is_black(bs.weight)) break;
        throughput *= bs.weight;
        prev_was_delta = (bs.flags & LOBE_DELTA) != 0u;

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
