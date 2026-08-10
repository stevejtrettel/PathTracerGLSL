// Core struct definitions
// Provides: Ray, Hit, Frame, LightSample, MaterialProperties

#define Point vec3
#define Direction vec3
#define Spectrum vec3
#define Radiance vec3

// A geodesic seed: a position + unit direction (a point of the unit tangent bundle). No search
// interval — the far bound is the QUERY's concern, not the ray's: nearest-hit shrinks hit.t;
// occlusion takes a maxDist argument. See docs/trace-loop-contract.md.
//
// The seed is where Category-B camera dimensions land when they arrive (camera/README.md):
// shutter time (motion blur) and wavelength (spectral sensor) are seeded once at the sensor
// and read by the whole path — they belong here as carried fields, NOT as generateRay args.
// A time coordinate here also serves relativistic geodesics (Point may become vec4). Both
// are prepared-for, not built.
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
    vec2 uv;            // surface parameterization — PLACEHOLDER planar xz chart today (all
                        // writers use UV_PLANAR_SCALE); no reader yet — the first consumer
                        // will be a procedural material, which owns making this chart real.
    int element;        // sub-element of the OWNING region that produced this hit (owner-
                        // approved contract edit, fable-instance-attributes): the region says
                        // WHOSE surface, element says WHICH PIECE of it. Instanced batch →
                        // placement index; every other backend → 0 today. Future tenants:
                        // per-triangle index (multi-material meshes), Stage B object refs.
                        // Reader: scene_material_properties' attribute rows. Every arm that
                        // fills a Hit fills this too (the fill-the-whole-Hit protocol).
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
// (medium events; future rough-transmissive receivers): selection falls back to the
// normal-free importance. Future context (spectral, curved frames) extends THIS
// struct + the constructors — the seams and techniques never churn again.
struct LightQuery {
    Point p;
    Direction n;
};

struct LightSample {
    Direction wi;         // toward the light, unit
    float distance;       // to the sampled point (1e20 for directional/environment)
    Spectrum radiance;    // incident radiance, WITHOUT visibility (delta lights fold 1/d² in)
    float pdf;            // total: selection × per-light, in solid-angle measure
    uint flags;
    int light_id;
};

// MaterialProperties is GENERATED per scene (§3.4): the union of fields declared by
// the models present (see generate/schema.ts) — emitted as the next block.
