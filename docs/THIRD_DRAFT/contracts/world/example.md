# Examples: Material-Based Light System in Action

## Example 1: Simple Scene (No Emissives)

This example shows the baseline - no light references needed.

### Input

```typescript
const sceneDescription = {
  objects: [
    {
      id: 'sphere_0',
      geometry: { type: 'sphere', radius: 1.0 },
      material: 'matte_white',
      transform: { position: [0, 0, 0] }
    }
  ],
  materials: new Map([
    ['matte_white', {
      albedo: [0.8, 0.8, 0.8],
      roughness: 1.0,
      metallic: 0.0,
      ior: 1.5,
      emission: [0, 0, 0]  // Not emissive
    }]
  ])
};

const lightDescription = {
  lights: [
    {
      id: 'key_light',
      type: 'point',
      position: [5, 5, 5],
      intensity: [100, 100, 100],
      visible: false
    }
  ]
};
```

### After Compilation

```typescript
// Light registry
registry = {
  lights: [
    { id: 'key_light', radiance: [100, 100, 100], sampling: { type: 'point', ... } }
  ],
  samplableIndices: [0],
  stats: {
    total: 1,
    samplable: 1,
    pathOnly: 0,
    fromExplicitLights: 1,
    fromEmissiveMaterials: 0
  }
}

// Materials with light_ids
materials = [
  { // matte_white
    albedo: [0.8, 0.8, 0.8],
    roughness: 1.0,
    light_id: -1  // Non-emissive
  }
]
```

### Generated GLSL (Key Parts)

```glsl
// In Scene Module
MaterialProperties scene_material_properties(int mat_id, Point p) {
  MaterialProperties props;
  props.albedo = vec3(0.8, 0.8, 0.8);
  props.roughness = 1.0;
  props.light_id = -1;  // Non-emissive
  return props;
}

// In Lighting Module  
uniform LightData u_lights[1] = LightData[](
  LightData(vec3(100, 100, 100), SAMPLING_POINT, vec4(5, 5, 5, 0), vec4(0))
);

// In Transport Module
MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
if (props.light_id >= 0) {  // Always false
  // Never executed for non-emissive
}
```

---

## Example 2: Emissive Sphere (Samplable)

This shows an emissive object that becomes a samplable light.

### Input

```typescript
const sceneDescription = {
  objects: [
    {
      id: 'glowing_sphere',
      geometry: { type: 'sphere', radius: 0.5 },
      material: 'hot_metal',
      transform: { position: [0, 3, 0] }
    },
    {
      id: 'floor',
      geometry: { type: 'plane', normal: [0, 1, 0] },
      material: 'concrete'
    }
  ],
  materials: new Map([
    ['hot_metal', {
      albedo: [0.9, 0.4, 0.1],
      roughness: 0.2,
      metallic: 1.0,
      ior: 2.5,
      emission: [50, 20, 5]  // EMISSIVE!
    }],
    ['concrete', {
      albedo: [0.5, 0.5, 0.5],
      roughness: 0.8,
      metallic: 0.0,
      ior: 1.5,
      emission: [0, 0, 0]
    }]
  ])
};

const lightDescription = {
  lights: []  // No explicit lights
};
```

### After Compilation

```typescript
// WorldCompiler creates light from emissive material
registry = {
  lights: [
    {
      id: 'emissive_hot_metal',
      radiance: [50, 20, 5],
      sampling: { type: 'sphere', position: [0, 3, 0], radius: 0.5 },
      source: 'emissive_material'
    }
  ],
  samplableIndices: [0],
  stats: {
    total: 1,
    samplable: 1,
    pathOnly: 0,
    fromExplicitLights: 0,
    fromEmissiveMaterials: 1
  }
}

// Materials with light assignments
materials = [
  { // hot_metal
    albedo: [0.9, 0.4, 0.1],
    roughness: 0.2,
    light_id: 0  // Points to lights[0]
  },
  { // concrete
    albedo: [0.5, 0.5, 0.5],
    roughness: 0.8,
    light_id: -1  // Non-emissive
  }
]
```

### Generated GLSL (Key Parts)

```glsl
// In Scene Module - No object tracking!
bool scene_intersect(Ray ray, out Hit hit) {
  // ... marching finds sphere
  hit.material_to = 0;  // hot_metal material
  // Note: no hit.object_id field!
}

MaterialProperties scene_material_properties(int mat_id, Point p) {
  if (mat_id == 0) {  // hot_metal
    MaterialProperties props;
    props.emission = vec3(50, 20, 5);
    props.light_id = 0;  // Direct reference to light
    return props;
  }
  // ...
}

// In Lighting Module
uniform LightData u_lights[1] = LightData[](
  LightData(vec3(50, 20, 5), SAMPLING_SPHERE, vec4(0, 3, 0, 0.5), vec4(0))
);

LightSample sample_sphere_0(Point p, vec2 xi) {
  vec3 center = vec3(0, 3, 0);
  float radius = 0.5;
  // ... sphere sampling code
}

// In Transport Module - THE KEY MIS MOMENT
MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
if (props.light_id >= 0) {  // hot_metal has light_id = 0
  LightData light = lighting_get_light(0);
  
  if (lighting_can_sample(0)) {  // true for sphere
    // MIS required - could sample this sphere directly
    float bsdf_pdf = last_bounce_pdf;
    float light_pdf = lighting_pdf(prev_point, ray.direction);
    float mis_weight = power_heuristic(bsdf_pdf, light_pdf);
    radiance += throughput * light.radiance * mis_weight;
  }
}
```

---

## Example 3: Complex Emissive SDF (Non-Samplable)

This shows an emissive that's too complex to sample.

### Input

```typescript
const sceneDescription = {
  objects: [
    {
      id: 'fractal_emitter',
      geometry: {
        type: 'sdf',
        code: `/* Mandelbulb fractal code */`
      },
      material: 'plasma',
      transform: { position: [0, 0, 0] }
    }
  ],
  materials: new Map([
    ['plasma', {
      albedo: [0.1, 0.1, 0.1],
      roughness: 0.0,
      metallic: 0.0,
      ior: 1.0,
      emission: [100, 50, 200]  // Very emissive!
    }]
  ])
};
```

### After Compilation

```typescript
// WorldCompiler creates non-samplable light
registry = {
  lights: [
    {
      id: 'emissive_plasma',
      radiance: [100, 50, 200],
      sampling: null,  // Cannot be sampled!
      source: 'emissive_material'
    }
  ],
  samplableIndices: [],  // Empty - no samplable lights
  stats: {
    total: 1,
    samplable: 0,
    pathOnly: 1
  }
}

// Material with light_id
materials = [
  { // plasma
    emission: [100, 50, 200],
    light_id: 0  // Points to non-samplable light
  }
]
```

### Generated GLSL (Key Parts)

```glsl
// In Lighting Module
uniform LightData u_lights[1] = LightData[](
  LightData(vec3(100, 50, 200), SAMPLING_NONE, vec4(0), vec4(0))
);

// No sampling function generated!
LightSample lighting_sample(Point p, vec2 xi) {
  LightSample ls;
  ls.pdf = 0.0;  // No samplable lights
  return ls;
}

bool lighting_can_sample(int light_id) {
  return u_lights[light_id].sampling_type != SAMPLING_NONE;  // Always false
}

// In Transport Module
MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
if (props.light_id >= 0) {  // plasma has light_id = 0
  LightData light = lighting_get_light(0);
  
  if (lighting_can_sample(0)) {  // FALSE - not samplable
    // This branch NOT taken
  } else {
    // Path-only emissive - full contribution
    radiance += throughput * light.radiance;  // No MIS weight!
  }
}
```

---

## Example 4: Mixed Scene (Complete System)

This shows everything working together.

### Input

```typescript
const sceneDescription = {
  objects: [
    {
      id: 'simple_emitter',
      geometry: { type: 'sphere', radius: 0.2 },
      material: 'light_bulb',
      transform: { position: [-2, 2, 0] }
    },
    {
      id: 'complex_emitter',  
      geometry: { type: 'sdf', code: '/* wavy surface */' },
      material: 'weird_glow',
      transform: { position: [2, 2, 0] }
    }
  ],
  materials: new Map([
    ['light_bulb', { emission: [100, 100, 80] }],
    ['weird_glow', { emission: [50, 100, 50] }]
  ])
};

const lightDescription = {
  lights: [
    {
      id: 'sun',
      type: 'directional',
      direction: [0, -1, 0],
      intensity: [5, 5, 5],
      visible: true  // Will create geometry!
    }
  ]
};
```

### After Compilation

```typescript
registry = {
  lights: [
    { id: 'sun', radiance: [5, 5, 5], sampling: { type: 'directional', ... } },
    { id: 'emissive_light_bulb', radiance: [100, 100, 80], sampling: { type: 'sphere', ... } },
    { id: 'emissive_weird_glow', radiance: [50, 100, 50], sampling: null }
  ],
  samplableIndices: [0, 1],  // sun and light_bulb can be sampled
  stats: {
    total: 3,
    samplable: 2,
    pathOnly: 1
  }
}

// Materials with light assignments
materials = [
  { id: 0, emission: [100, 100, 80], light_id: 1 },  // light_bulb
  { id: 1, emission: [50, 100, 50], light_id: 2 },   // weird_glow
  { id: 2, emission: [5, 5, 5], light_id: 0 }        // sun geometry material
]
```

### Transport Execution Flow

```glsl
// Case 1: Ray hits simple_emitter (samplable)
Hit hit;
scene_intersect(ray, hit);
MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
// props.light_id = 1 (light_bulb)

if (props.light_id >= 0 && lighting_can_sample(1)) {  // true
  // Use MIS - this could have been sampled
  float mis_weight = compute_mis_weight(bsdf_pdf, light_pdf);
  radiance += throughput * lighting_get_light(1).radiance * mis_weight;
}

// Case 2: Ray hits complex_emitter (non-samplable)  
// props.light_id = 2 (weird_glow)
if (props.light_id >= 0 && lighting_can_sample(2)) {  // false
  // No MIS - could only find by path tracing
  radiance += throughput * lighting_get_light(2).radiance;
}

// Case 3: Explicit light sampling
LightSample ls = lighting_sample(p, xi);
// Samples from indices [0, 1] - sun or light_bulb, never weird_glow
```

---

## Example 5: Performance Optimizations

The new system enables several optimizations:

### Single Light Optimization
```glsl
#if NUM_SAMPLABLE == 1
  LightSample lighting_sample(Point p, vec2 xi) {
    return sample_light_0(p, xi);  // Skip selection
  }
#endif
```

### No Emissives Optimization
```glsl
#if MAX_LIGHT_ID < 0
  // Never check light_id in transport
  // Smaller MaterialProperties struct
#endif
```

### Direct Access Pattern
```glsl
// OLD: Complex indirection
int obj_id = hit.object_id;
int light_id = OBJECT_TO_LIGHT[obj_id];
bool can_sample = LIGHT_CAN_SAMPLE[light_id];

// NEW: Direct access
int light_id = props.light_id;
bool can_sample = lighting_can_sample(light_id);
```

## Key Improvements

1. **No object tracking** - Hit structure is smaller
2. **Direct light references** - Materials know their lights
3. **Simpler MIS logic** - No cross-reference lookups
4. **Better performance** - Fewer indirections, smaller data
5. **Cleaner code** - Easy to understand and debug

The system correctly handles all light configurations while being simpler and more efficient!
