# Minimal Test Modules for Engine Testing

## Purpose

These modules are the absolute simplest valid implementations for testing the Engine compilation pipeline. They should compile without errors, work together, and produce visible colored output to verify the pipeline is working.

## Complete Module Set

### 1. Geometry Module (Euclidean)

```typescript
export const MinimalEuclideanGeometry: ModuleDescriptor = {
  id: { 
    kind: 'geometry', 
    name: 'euclidean_minimal', 
    version: '1.0.0' 
  },
  fragment: {
    functions: `
      // Define base types that all other modules need
      struct Ray {
        vec3 origin;
        vec3 direction;
      };
      
      struct Hit {
        float t;
        vec3 point;
        vec3 normal;
        vec2 uv;
      };
      
      struct Frame {
        vec3 tangent;
        vec3 bitangent;
        vec3 normal;
      };
      
      // Required Geometry functions
      vec3 geodesic(vec3 origin, vec3 direction, float t) {
        // Straight line in Euclidean space
        return origin + direction * t;
      }
      
      float dot(vec3 a, vec3 b) {
        return dot(a, b);  // Use built-in
      }
      
      vec3 parallel_transport(vec3 from, vec3 to, vec3 v) {
        // In Euclidean space, vectors don't change
        return v;
      }
      
      Frame frame(vec3 point, vec3 direction) {
        // Build orthonormal frame
        vec3 up = abs(direction.y) < 0.999 ? vec3(0,1,0) : vec3(1,0,0);
        vec3 tangent = normalize(cross(up, direction));
        vec3 bitangent = cross(direction, tangent);
        return Frame(tangent, bitangent, direction);
      }
    `,
    provides: ['geodesic', 'dot', 'parallel_transport', 'frame'],
    requires: []
  },
  parameters: []
};
```

### 2. Material Module (Solid Color)

```typescript
export const MinimalSolidColorMaterial: ModuleDescriptor = {
  id: { 
    kind: 'material', 
    name: 'solid_color_minimal', 
    version: '1.0.0' 
  },
  fragment: {
    functions: `
      // Simple solid color material
      vec3 evaluate(vec3 wi, vec3 wo, Hit hit) {
        // Just return the color
        return color;
      }
      
      vec3 sample(vec3 wi, Hit hit, vec2 xi, out float pdf) {
        // Uniform hemisphere sampling
        float theta = acos(1.0 - xi.x);
        float phi = 2.0 * PI * xi.y;
        
        vec3 local = vec3(
          sin(theta) * cos(phi),
          sin(theta) * sin(phi),
          cos(theta)
        );
        
        // Transform to world space
        vec3 up = abs(hit.normal.y) < 0.999 ? vec3(0,1,0) : vec3(1,0,0);
        vec3 tangent = normalize(cross(up, hit.normal));
        vec3 bitangent = cross(hit.normal, tangent);
        
        vec3 wo_out = tangent * local.x + bitangent * local.y + hit.normal * local.z;
        pdf = 1.0 / (2.0 * PI);
        
        return wo_out;
      }
      
      float pdf(vec3 wi, vec3 wo, Hit hit) {
        return 1.0 / (2.0 * PI);
      }
    `,
    provides: ['evaluate', 'sample', 'pdf'],
    requires: []
  },
  parameters: [
    {
      name: 'color',
      type: 'vec3',
      default: [1.0, 0.5, 0.5]  // Salmon pink
    }
  ]
};
```

### 3. Scene Module (Single Sphere)

```typescript
export const MinimalSphereScene: ModuleDescriptor = {
  id: { 
    kind: 'scene', 
    name: 'sphere_minimal', 
    version: '1.0.0' 
  },
  fragment: {
    functions: `
      // Single sphere at origin
      bool intersect(Ray ray, out Hit hit) {
        // Sphere at origin with radius 1
        vec3 oc = ray.origin;
        float a = dot(ray.direction, ray.direction);
        float b = 2.0 * dot(oc, ray.direction);
        float c = dot(oc, oc) - 1.0;
        
        float discriminant = b * b - 4.0 * a * c;
        if (discriminant < 0.0) {
          return false;
        }
        
        float t = (-b - sqrt(discriminant)) / (2.0 * a);
        if (t < 0.001) {
          t = (-b + sqrt(discriminant)) / (2.0 * a);
          if (t < 0.001) {
            return false;
          }
        }
        
        hit.t = t;
        hit.point = ray.origin + ray.direction * t;
        hit.normal = normalize(hit.point);  // For unit sphere
        hit.uv = vec2(0.5, 0.5);  // Dummy UVs
        
        return true;
      }
      
      bool intersect_any(Ray ray, float maxDist) {
        Hit dummy;
        if (intersect(ray, dummy)) {
          return dummy.t < maxDist;
        }
        return false;
      }
      
      bool classify_point(vec3 point) {
        // Inside if distance < 1
        return length(point) < 1.0;
      }
    `,
    provides: ['intersect', 'intersect_any', 'classify_point'],
    requires: []
  },
  parameters: []
};
```

### 4. Lights Module (Constant Sky)

```typescript
export const MinimalConstantLight: ModuleDescriptor = {
  id: { 
    kind: 'lights', 
    name: 'constant_minimal', 
    version: '1.0.0' 
  },
  fragment: {
    functions: `
      // Constant light from all directions
      vec3 sample_light(vec3 point, vec2 xi, out vec3 direction, out float pdf) {
        // Uniform sphere sampling
        float theta = acos(1.0 - 2.0 * xi.x);
        float phi = 2.0 * PI * xi.y;
        
        direction = vec3(
          sin(theta) * cos(phi),
          sin(theta) * sin(phi),
          cos(theta)
        );
        
        pdf = 1.0 / (4.0 * PI);
        return sky_color;
      }
      
      vec3 eval_light(vec3 point, vec3 direction) {
        return sky_color;
      }
      
      float pdf_light(vec3 point, vec3 direction) {
        return 1.0 / (4.0 * PI);
      }
    `,
    provides: ['sample_light', 'eval_light', 'pdf_light'],
    requires: []
  },
  parameters: [
    {
      name: 'sky_color',
      type: 'vec3',
      default: [0.7, 0.8, 1.0]  // Light blue
    }
  ]
};
```

### 5. Camera Module (Simple Pinhole)

```typescript
export const MinimalPinholeCamera: ModuleDescriptor = {
  id: { 
    kind: 'camera', 
    name: 'pinhole_minimal', 
    version: '1.0.0' 
  },
  fragment: {
    functions: `
      // Simple pinhole camera looking down -Z
      Ray generate_ray(vec2 pixel, vec2 xi) {
        // Convert pixel to NDC
        vec2 ndc = (pixel + xi) / u_resolution * 2.0 - 1.0;
        
        // Aspect ratio correction
        float aspect = u_resolution.x / u_resolution.y;
        ndc.x *= aspect;
        
        // Generate ray
        Ray ray;
        ray.origin = vec3(0.0, 0.0, 3.0);  // Camera at positive Z
        ray.direction = normalize(vec3(ndc * 0.5, -1.0));  // Look at origin
        
        return ray;
      }
    `,
    provides: ['generate_ray'],
    requires: []
  },
  parameters: []
};
```

### 6. Estimator Module (Direct Color)

```typescript
export const MinimalDirectEstimator: ModuleDescriptor = {
  id: { 
    kind: 'estimator', 
    name: 'direct_minimal', 
    version: '1.0.0' 
  },
  fragment: {
    functions: `
      // Simplest possible estimator - just return hit color
      vec3 estimate(Ray ray) {
        Hit hit;
        
        // Check intersection
        if (intersect(ray, hit)) {
          // Just evaluate material with fixed lighting
          vec3 wi = -ray.direction;
          vec3 wo = normalize(vec3(1, 1, 1));  // Fake light direction
          return evaluate(wi, wo, hit);
        }
        
        // Sky background
        return eval_light(ray.origin, ray.direction);
      }
    `,
    provides: ['estimate'],
    requires: ['intersect', 'evaluate', 'eval_light']
  },
  parameters: []
};
```

### 7. Film Module (Simple Average)

```typescript
export const MinimalAverageFilm: ModuleDescriptor = {
  id: { 
    kind: 'film', 
    name: 'average_minimal', 
    version: '1.0.0' 
  },
  fragment: {
    functions: `
      // Simple averaging accumulation
      vec3 accumulate(vec3 radiance, vec2 pixel) {
        // Read previous value
        ivec2 coord = ivec2(pixel);
        vec3 previous = texelFetch(u_film_radiance_previous, coord, 0).rgb;
        
        // Average with new sample
        float n = float(u_frame_index + 1);
        vec3 accumulated = (previous * (n - 1.0) + radiance) / n;
        
        return accumulated;
      }
    `,
    provides: ['accumulate'],
    requires: []
  },
  parameters: [],
  resources: {
    textures: [
      {
        name: 'radiance',
        type: 'texture2D',
        format: 'rgba32f',
        persistent: true
      }
    ]
  }
};
```

### 8. Developer Module (Simple Clamp)

```typescript
export const MinimalClampDeveloper: ModuleDescriptor = {
  id: { 
    kind: 'developer', 
    name: 'clamp_minimal', 
    version: '1.0.0' 
  },
  fragment: {
    functions: `
      // Simplest developer - just clamp to [0,1]
      vec3 develop(vec3 accumulated) {
        return clamp(accumulated * exposure, 0.0, 1.0);
      }
    `,
    provides: ['develop'],
    requires: []
  },
  parameters: [
    {
      name: 'exposure',
      type: 'float',
      default: 1.0,
      min: 0.1,
      max: 10.0
    }
  ]
};
```

## Test Recipe

```typescript
export const MinimalTestRecipe: Recipe = {
  id: 'minimal_test',
  name: 'Minimal Test Recipe',
  
  world: {
    geometry: { kind: 'geometry', name: 'euclidean_minimal' },
    material: { kind: 'material', name: 'solid_color_minimal' },
    scene: { kind: 'scene', name: 'sphere_minimal' },
    lights: { kind: 'lights', name: 'constant_minimal' }
  },
  
  photography: {
    camera: { kind: 'camera', name: 'pinhole_minimal' },
    estimator: { kind: 'estimator', name: 'direct_minimal' },
    film: { kind: 'film', name: 'average_minimal' },
    developer: { kind: 'developer', name: 'clamp_minimal' }
  },
  
  parameters: {
    'material.color': [1.0, 0.5, 0.3],  // Orange sphere
    'lights.sky_color': [0.5, 0.7, 1.0],  // Blue sky
    'developer.exposure': 1.5
  }
};
```

## Registration Helper

```typescript
export function registerMinimalModules(registry: ModuleRegistry): void {
  // Register all minimal modules
  registry.register(MinimalEuclideanGeometry);
  registry.register(MinimalSolidColorMaterial);
  registry.register(MinimalSphereScene);
  registry.register(MinimalConstantLight);
  registry.register(MinimalPinholeCamera);
  registry.register(MinimalDirectEstimator);
  registry.register(MinimalAverageFilm);
  registry.register(MinimalClampDeveloper);
  
  console.log('Minimal test modules registered');
}
```

## Expected Output

When working correctly, this recipe should produce:
1. **Visible sphere**: Orange/salmon colored sphere in center
2. **Blue background**: Light blue sky color
3. **Progressive refinement**: Gets smoother each frame (averaging)
4. **No errors**: Clean compilation, no WebGL errors

## Testing Variations

### Test Missing Dependencies
```typescript
// Remove a required function to test error handling
const BrokenEstimator = {
  ...MinimalDirectEstimator,
  fragment: {
    ...MinimalDirectEstimator.fragment,
    requires: ['nonexistent_function']  // Should error
  }
};
```

### Test Prefixing
```typescript
// Use same function names to test prefixing prevents collisions
const MaterialWithIntersect = {
  ...MinimalSolidColorMaterial,
  fragment: {
    functions: `
      bool intersect() { return false; }  // Name collision!
      // ... rest of material
    `,
    provides: ['evaluate', 'sample', 'pdf', 'intersect']
  }
};
```

### Test Parameter Updates
```typescript
// Change parameters to verify uniform system
engine.updateUniforms({
  changes: [
    { path: 'material.color', oldValue: [1,0.5,0.3], newValue: [0,1,0], timestamp: Date.now() }
  ],
  source: 'user',
  triggersReset: true
});
// Sphere should turn green
```

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Black screen | Check if camera is positioned correctly |
| No accumulation | Verify film textures are set up |
| Flat shading | Normal calculation might be wrong |
| Compile errors | Check function signatures match exactly |

These minimal modules provide the absolute basics needed to test every part of the Engine compilation pipeline while being simple enough to debug easily.
