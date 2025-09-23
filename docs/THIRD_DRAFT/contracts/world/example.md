Looking at what we have, I think we need one more critical document: a **complete example** that shows the entire flow from input to rendering. This would tie everything together and reveal any gaps.

# Example: One Sphere, One Light

## Input Descriptions

```typescript
// User writes:
const sceneDescription = {
  objects: [
    {
      id: 'sphere_0',
      geometry: { type: 'sphere', radius: 1.0 },
      material: 'red_plastic',
      transform: { position: [0, 0, 0] }
    }
  ],
  materials: new Map([
    ['red_plastic', {
      albedo: [0.8, 0.2, 0.2],
      roughness: 0.3,
      metallic: 0.0,
      ior: 1.5,
      emission: [0, 0, 0]  // Not emissive
    }]
  ])
};

const lightDescription = {
  lights: [
    {
      id: 'sun',
      type: 'directional',
      direction: [0, -1, -1],
      intensity: [5, 5, 5],
      visible: false  // No geometry
    }
  ],
  environment: {
    type: 'constant',
    value: [0.1, 0.1, 0.2],  // Dim blue sky
    intensity: 1.0
  }
};
```

## Augmentation (Internal to WorldCompiler)

```typescript
// WorldCompiler.augment() produces:

sceneInput = {
  objects: [
    {
      id: 'sphere_0',
      sdf: 'return length(p) - 1.0;',
      materialId: 1,  // Assigned ID
      transform: mat4([...])
    }
    // No light objects (sun is invisible)
  ],
  materials: [
    { id: 0, /* AIR */ },
    { id: 1, albedo: [0.8,0.2,0.2], roughness: 0.3, ... }
  ]
};

lightingInput = {
  lights: [
    {
      id: 'sun',
      type: 'directional',
      direction: [0, -1, -1],
      intensity: [5, 5, 5]
    }
    // No emissive objects
  ],
  environment: { type: 'constant', value: [0.1,0.1,0.2] }
};
```

## Generated Scene Module

```glsl
// From SceneCompiler
#define NUM_MATERIALS 2
#define NUM_OBJECTS 1

// Material properties
uniform vec4 u_material_albedo_metallic[2];
uniform vec4 u_material_ior_flags[2];
uniform vec3 u_material_emission[2];

// Object SDF
float object_sphere_0_sdf(Point p) {
  return length(p) - 1.0;
}

// Single object - no dispatch needed
bool scene_intersect(Ray ray, out Hit hit) {
  float t = 0.0;
  
  for (int i = 0; i < 100; i++) {
    Point p = geometry_geodesic(ray.origin, ray.direction, t);
    float d = object_sphere_0_sdf(p);
    
    if (d < 0.001) {
      hit.t = t;
      hit.p = p;
      hit.n = normalize(p);  // Sphere normal
      hit.frame = geometry_frame(p, hit.n);
      hit.material_from = MATERIAL_AIR;
      hit.material_to = 1;  // red_plastic
      return true;
    }
    
    t += d * 0.9;
    if (t > ray.max_t) break;
  }
  return false;
}

MaterialProperties scene_material_properties(int id, Point p) {
  MaterialProperties props;
  vec4 am = u_material_albedo_metallic[id];
  props.albedo = am.rgb;
  props.metallic = am.a;
  props.roughness = 0.3;  // Could be constant
  props.ior = u_material_ior_flags[id].x;
  props.emission = u_material_emission[id];
  return props;
}
```

## Generated Lighting Module

```glsl
// From LightingCompiler
#define NUM_LIGHTS 1
#define HAS_ENVIRONMENT 1

uniform vec3 u_light_intensities[1];

LightSample lighting_sample(Point p, vec2 xi) {
  // Only one light - always sample it
  LightSample ls;
  ls.wi = normalize(vec3(0, -1, -1));
  ls.distance = MAX_DIST;
  ls.radiance = u_light_intensities[0];
  ls.pdf = 1.0;
  ls.light_id = 0;
  return ls;
}

float lighting_pdf(Point p, Direction wi) {
  // Directional light is delta - 0 for arbitrary directions
  return 0.0;
}

Spectrum lighting_environment(Direction dir) {
  return vec3(0.1, 0.1, 0.2);  // Constant environment
}
```

## Frame Execution

```glsl
// In Transport module
Spectrum transport_trace(Ray ray) {
  Hit hit;
  if (!scene_intersect(ray, hit)) {
    return lighting_environment(ray.direction);
  }
  
  // Direct lighting
  LightSample ls = lighting_sample(hit.p, next_2d());
  Ray shadow = Ray(hit.p, ls.wi, EPSILON, ls.distance);
  
  Spectrum L = vec3(0);
  if (!scene_intersect_any(shadow, ls.distance)) {
    // Get material properties
    MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
    
    // Evaluate BRDF (in Interaction module)
    Spectrum f = interaction_surface_shade(-ray.direction, ls.wi, hit);
    
    L = ls.radiance * f * max(0, dot(ls.wi, hit.n));
  }
  
  // Add emission (none in this case)
  L += props.emission;
  
  return L;
}
```

## What This Example Reveals

1. **Simple scenes optimize well** - Single object removes dispatch entirely
2. **Delta lights are simple** - No complex PDF evaluation needed
3. **Material properties flow cleanly** - Scene → Transport → Interaction
4. **Cross-referencing is transparent** - User never sees augmentation

This completes our documentation. We have:
- Architecture overview
- Module contracts
- Data types
- Compiler specifications
- Integration rules
- Concrete example

Ready to start implementation!
