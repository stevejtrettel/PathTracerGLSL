
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

// Hit information from ray-surface intersection
struct Hit {
Point p;           // World space intersection position
    Direction n;       // Surface normal at intersection
    float t;           // Distance along ray to intersection
    int material_to;   // the material we hit
};


// Geometric frame for building coordinate systems
struct Frame {
    Point base;
    Direction t, b, n;  // tangent, bitangent, normal (orthonormal basis)
};





// Material properties structure - owned by Scene
struct MaterialProperties {
    vec3 albedo;    // Base color
};



struct LightSample {
    Point position;     // Position of light source
    Direction wi;           // Direction from surface to light (normalized)
    Radiance radiance;     // Incident radiance (color * intensity / distance²)
    float distance;    // Distance to light source
};
