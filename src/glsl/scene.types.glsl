// scene.types — shared scene-facing structs

struct Hit {
    bool  hit; // true if an intersection was found in [tMin, tMax]
    float t;   // affine ray parameter along Ray
    int   mat; // material id for scene_material()
};

struct Material {
    vec3  baseColor;
    float roughness;   // [0,1]
    float metalness;   // [0,1]
    vec3  emission;    // radiance (can be zero)
};
