// Core struct definitions
// Provides: Ray, Hit, Frame, LightSample, MaterialProperties

#define Point vec3
#define Direction vec3
#define Spectrum vec3
#define Radiance vec3

struct Ray {
    Point origin;
    Direction direction;
    float tmin;
    float tmax;
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

struct LightSample {
    Direction wi;
    Point position;
    Spectrum radiance;
    float distance;
    float pdf;
};

struct MaterialProperties {
    Spectrum albedo;
    Spectrum emission;
    float emission_strength;
    float roughness;
};
