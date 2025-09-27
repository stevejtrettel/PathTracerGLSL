
// Fallback aliases (these should be defined by geometry)
#ifndef Point
#define Point vec3
#endif

#ifndef Direction
#define Direction vec3
#endif



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
