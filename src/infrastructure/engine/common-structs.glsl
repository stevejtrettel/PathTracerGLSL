
//in the future need to define these for each geometry
#define Point      vec3
#define Direction  vec3



// In the future need to define these differently in RGB vs spectral renderers
#define Spectrum vec3 // Spectral radiance/reflectance
#define Radiance vec3 // Outgoing light
#define RGB      vec3 // Just return albedo for now   // Display color




// Ray structure for intersection queries
struct Ray {
Point origin;      // Starting position
    Direction direction; // Ray direction (should be normalized)
    float tmin, tmax;  // Near and far clipping distances
};

// Geometric frame for building coordinate systems
struct Frame {
    Point base;
    Direction t, b, n;  // tangent, bitangent, normal (orthonormal basis)
};






struct Hit {
    Point p;
    Direction v; //incident
    Direction n; //surface normal
    float t;
    int material_from;   // Material we're leaving (0 = air)
    int material_to;     // Material we're entering
    vec2 uv;
    Frame frame;
};

struct MaterialProperties {
    vec3 albedo;
    float roughness;     // Add these even if not using yet
    float metallic;
    float ior;
    vec3 emission;
    float emission_strength;
    int light_id;        // Direct reference to light (-1 if non-emissive)
};

struct LightSample {
    Point position;
    Direction wi;
    Radiance radiance;
    float distance;
    float pdf;          //For MIS (even if 1.0 for now)
};

struct LightData {
    vec3 radiance;      // Color * intensity
    int sampling_type;  // Type of sampling (SAMPLING_NONE, SAMPLING_POINT, etc.)
    vec4 param0;        // Position / center
    vec4 param1;        // Edge1 or other params
    vec4 param2;        // Edge2 or other params
};



