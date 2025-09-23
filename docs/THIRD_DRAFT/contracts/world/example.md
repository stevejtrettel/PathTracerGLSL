
# Examples: Cross-Reference System in Action

## Example 1: Simple Scene (No Emissives)

This example shows the baseline - no cross-referencing needed.

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

### After Augmentation

```typescript
crossRef = {
  objectToLight: Map {},  // Empty - no emissives
  lightToObject: Map {},  // Empty - no visible lights
  samplableLights: Set { 'key_light' },
  stats: {
    totalLights: 1,
    samplableLights: 1,
    pathOnlyEmissives: 0
  }
}
```

### Generated GLSL (Key Parts)

```glsl
// In Scene Module
bool scene_intersect(Ray ray, out Hit hit) {
  // ... marching
  hit.object_id = 0;  // Only one object
  hit.material_to = 1;  // matte_white
  // ...
}

// In Lighting Module  
const int OBJECT_TO_LIGHT[1] = int[](-1);  // No emissives
const bool LIGHT_CAN_SAMPLE[1] = bool[](true);  // Point light samplable

// In Transport Module
if (hit.emission > 0) {  // Never true
  // This branch never taken
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

### After Augmentation

```typescript
// WorldCompiler detects emissive sphere
crossRef = {
  objectToLight: Map {
    'glowing_sphere' -> 'emissive_glowing_sphere'
  },
  lightToObject: Map {
    'emissive_glowing_sphere' -> 'glowing_sphere'  
  },
  samplableLights: Set { 'emissive_glowing_sphere' },
  stats: {
    totalLights: 1,
    samplableLights: 1,
    pathOnlyEmissives: 0
  }
}

// Sphere added to lights
lightingInput.lights = [
  {
    id: 'emissive_glowing_sphere',
    canSample: true,
    intensity: [50, 20, 5],
    sourceObjectId: 'glowing_sphere',
    sampling: {
      type: 'sphere',
      position: [0, 3, 0],
      radius: 0.5
    }
  }
]
```

### Generated GLSL (Key Parts)

```glsl
// In Scene Module
bool scene_intersect(Ray ray, out Hit hit) {
  // ... marching finds sphere
  hit.object_id = 0;  // glowing_sphere
  hit.material_to = 1;  // hot_metal
  // ...
}

// In Lighting Module
const int OBJECT_TO_LIGHT[2] = int[](0, -1);  // Object 0 maps to light 0
const bool LIGHT_CAN_SAMPLE[1] = bool[](true);  // Can sample sphere

LightSample sample_sphere_0(Point p, vec2 xi) {
  // Proper sphere sampling
  vec3 center = vec3(0, 3, 0);
  float radius = 0.5;
  // ... sampling code
}

// In Transport Module - THE KEY MIS MOMENT
if (length(props.emission) > 0) {
  // We hit the emissive sphere!
  int light_id = lighting_get_light_for_object(0);  // Returns 0
  
  if (light_id >= 0 && lighting_can_sample_light(0)) {  // true
    // MIS required - could sample this sphere directly
    float bsdf_pdf = last_bounce_pdf;
    float light_pdf = lighting_pdf(prev_point, ray.direction);
    float mis_weight = power_heuristic(bsdf_pdf, light_pdf);
    radiance += throughput * props.emission * mis_weight;
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
        code: `
          // Mandelbulb fractal
          vec3 z = p;
          float dr = 1.0;
          float r = 0.0;
          for (int i = 0; i < 4; i++) {
            r = length(z);
            if (r > 2.0) break;
            
            float theta = acos(z.z/r);
            float phi = atan(z.y, z.x);
            dr = pow(r, 7.0) * 8.0 * dr + 1.0;
            
            float zr = pow(r, 8.0);
            theta *= 8.0;
            phi *= 8.0;
            
            z = zr * vec3(sin(theta)*cos(phi), 
                         sin(phi)*sin(theta), 
                         cos(theta));
            z += p;
          }
          return 0.25 * log(r) * r / dr;
        `
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

### After Augmentation

```typescript
// WorldCompiler analyzes complexity
// Finds: fractal, multiple operations -> TOO COMPLEX

crossRef = {
  objectToLight: Map {
    'fractal_emitter' -> 'emissive_fractal_emitter'
  },
  lightToObject: Map {},  // Empty - can't sample it
  samplableLights: Set {},  // Empty - nothing samplable
  stats: {
    totalLights: 1,
    samplableLights: 0,
    pathOnlyEmissives: 1
  }
}

// Non-samplable light created
lightingInput.lights = [
  {
    id: 'emissive_fractal_emitter',
    canSample: false,  // KEY: Cannot sample
    intensity: [100, 50, 200],
    sourceObjectId: 'fractal_emitter'
  }
]
```

### Generated GLSL (Key Parts)

```glsl
// In Lighting Module
const int OBJECT_TO_LIGHT[1] = int[](0);  // Maps to light 0
const bool LIGHT_CAN_SAMPLE[1] = bool[](false);  // CANNOT sample

// No sampling function generated for fractal!

LightSample lighting_sample(Point p, vec2 xi) {
  // No samplable lights
  LightSample ls;
  ls.pdf = 0.0;  // Invalid sample
  return ls;
}

// In Transport Module
if (length(props.emission) > 0) {
  // We hit the fractal emitter!
  int light_id = lighting_get_light_for_object(0);  // Returns 0
  
  if (light_id >= 0 && lighting_can_sample_light(0)) {  // FALSE!
    // This branch NOT taken
  } else {
    // Path-only emissive - full contribution
    radiance += throughput * props.emission;  // No MIS weight!
  }
}
```

---

## Example 4: Mixed Scene (Complete MIS)

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
      geometry: {
        type: 'sdf',
        code: 'return length(p) - 1.0 + 0.1 * sin(20.0 * p.x) * sin(20.0 * p.y);'
      },
      material: 'weird_glow',
      transform: { position: [2, 2, 0] }
    }
  ],
  materials: new Map([
    ['light_bulb', {
      emission: [100, 100, 80]  // Samplable emissive
    }],
    ['weird_glow', {
      emission: [50, 100, 50]  // Non-samplable emissive
    }]
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

### After Augmentation

```typescript
crossRef = {
  objectToLight: Map {
    'simple_emitter' -> 'emissive_simple_emitter',
    'complex_emitter' -> 'emissive_complex_emitter'
  },
  lightToObject: Map {
    'emissive_simple_emitter' -> 'simple_emitter',
    'sun' -> 'light_sun'  // Visible light gets object
  },
  samplableLights: Set { 
    'sun', 
    'emissive_simple_emitter'
    // Note: complex_emitter NOT here
  },
  stats: {
    totalLights: 3,
    samplableLights: 2,
    pathOnlyEmissives: 1
  }
}
```

### Transport Execution Flow

```glsl
// Case 1: Ray hits simple_emitter (samplable)
hit.object_id = 0;  // simple_emitter
int light_id = OBJECT_TO_LIGHT[0];  // Returns 1
if (LIGHT_CAN_SAMPLE[1]) {  // true
  // Use MIS - this could have been sampled
  float mis_weight = compute_mis_weight(bsdf_pdf, light_pdf);
  radiance += throughput * emission * mis_weight;
}

// Case 2: Ray hits complex_emitter (non-samplable)  
hit.object_id = 1;  // complex_emitter
int light_id = OBJECT_TO_LIGHT[1];  // Returns 2
if (LIGHT_CAN_SAMPLE[2]) {  // false
  // No MIS - could only find by path tracing
  radiance += throughput * emission;  // Full weight
}

// Case 3: Explicit light sampling
LightSample ls = lighting_sample(p, xi);
// Might sample sun or simple_emitter, never complex_emitter
```

---

## Example 5: Configuration-Driven Behavior

Same scene, different configurations:

### Config: Sample Everything

```typescript
const config = {
  emissiveStrategy: {
    mode: 'all',
    bboxSampleAttempts: 64
  }
};

// Result: complex_emitter gets bbox sampler
// More sampling attempts, potentially better convergence
// But slower per sample
```

### Config: Simple Only

```typescript
const config = {
  emissiveStrategy: {
    mode: 'simple'
  }
};

// Result: Only sphere sampled, complex SDF is path-only
// Faster but may miss some lighting
```

### Config: Analyzed

```typescript
const config = {
  emissiveStrategy: {
    mode: 'analyzed',
    complexityThreshold: 10
  }
};

// Result: Automatic decision based on complexity score
// Good balance of performance and quality
```

## Key Takeaways

1. **Simple emissives** → Exact sampling + MIS
2. **Complex emissives** → Path-only, no MIS needed
3. **Visible lights** → Become objects automatically
4. **Cross-reference** → Enables correct MIS decisions
5. **Configuration** → User controls the tradeoffs

The system handles all combinations correctly and efficiently!


This comprehensive example document shows:
1. The progression from simple to complex
2. How the cross-reference system works in practice
3. The MIS decision points
4. Different configuration options
5. The actual GLSL code that gets generated

It should make the entire system crystal clear for implementation.
