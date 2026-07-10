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
    Frame frame;
    int region_from;    // region on the incoming side (-1 = ambient) — §4.1
    int region_to;      // region on the far side (owner, for single-region solids)
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
};
