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

#ifdef HAS_MEDIA
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
#endif
