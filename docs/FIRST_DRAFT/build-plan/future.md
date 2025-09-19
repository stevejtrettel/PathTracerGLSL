# FUTURE


## Acceleration Structures

### Overview

As scene complexity grows beyond simple test cases, acceleration structures become critical for performance. The Scene module will internally leverage different acceleration strategies while maintaining its clean `sc_intersect()` interface. This allows for sophisticated spatial culling without breaking the module abstraction.

### Hybrid Acceleration Architecture

Given that scenes will contain both SDFs and meshes, we need a unified acceleration strategy that handles both efficiently:

```
Top-Level BVH (all objects)
    ├── Mesh Objects → Triangle BVH
    ├── SDF Objects → Sparse Voxel Octree
    └── Compound Objects → Hierarchical Bounds
```

### Implementation Strategy

#### 1. Build-Time Structure Generation

The Scene module compiler will analyze objects and generate specialized traversal code:

```typescript
// Scene descriptor with acceleration hints
{
  acceleration: {
    strategy: "hybrid",
    bvhMaxDepth: 32,
    sdfVoxelResolution: 128,
    dynamicRebuild: false
  },
  objects: [
    {
      type: "mesh",
      path: "models/teapot.obj",
      accelerationHint: "static",
      triangleCount: 5000  // Triggers BVH build
    },
    {
      type: "sdf",
      function: "mandelbulb",
      accelerationHint: "hierarchical",
      boundingBox: [[-2,-2,-2], [2,2,2]]
    }
  ]
}
```

#### 2. GPU Memory Layout

Since WebGL2 lacks buffer pointers, we'll pack acceleration structures into textures:

```glsl
// BVH Node Layout (2 texels per node)
// Texel 0: min.xyz, left_child
// Texel 1: max.xyz, right_child (negative = leaf)
uniform sampler2D u_scene_bvh_nodes;
uniform sampler2D u_scene_bvh_leaves;  // Triangle indices

// SDF Acceleration Grid
uniform sampler3D u_scene_sdf_distance_grid;  // Distance bounds
uniform sampler3D u_scene_sdf_validity_mask;   // Valid regions

// Stack for traversal (register array)
int stack[32];  // Tunable based on depth
int stack_ptr = 0;
```

#### 3. Unified Traversal Function

The Scene module generates a traversal function that handles all object types:

```glsl
bool sc_intersect(Ray ray, out Hit hit) {
    float nearest_t = 1e10;
    bool any_hit = false;
    
    // Initialize traversal stack with root
    stack[0] = 0;
    stack_ptr = 1;
    
    while(stack_ptr > 0) {
        int node_idx = stack[--stack_ptr];
        
        // Fetch node from texture
        vec4 node0 = texelFetch(u_scene_bvh_nodes, ivec2(node_idx*2, 0), 0);
        vec4 node1 = texelFetch(u_scene_bvh_nodes, ivec2(node_idx*2+1, 0), 0);
        
        // Early out if beyond current nearest
        if(!ray_box_intersect(ray, node0.xyz, node1.xyz, nearest_t))
            continue;
            
        int left = int(node0.w);
        int right = int(node1.w);
        
        if(left < 0) {  // Leaf node
            int object_id = -left - 1;
            
            // Dispatch based on object type
            if(object_types[object_id] == TYPE_MESH) {
                if(intersect_mesh_bvh(object_id, ray, hit, nearest_t)) {
                    nearest_t = hit.t;
                    any_hit = true;
                }
            } else if(object_types[object_id] == TYPE_SDF) {
                if(march_sdf_accelerated(object_id, ray, hit, nearest_t)) {
                    nearest_t = hit.t;
                    any_hit = true;
                }
            }
        } else {  // Internal node
            // Order children by ray direction
            if(ray.d[split_axis[node_idx]] > 0.0) {
                stack[stack_ptr++] = right;
                stack[stack_ptr++] = left;
            } else {
                stack[stack_ptr++] = left;
                stack[stack_ptr++] = right;
            }
        }
    }
    
    return any_hit;
}
```

#### 4. SDF-Specific Acceleration

For SDFs, we'll use a sparse voxel octree with distance bounds:

```glsl
bool march_sdf_accelerated(int obj_id, Ray ray, out Hit hit, float max_t) {
    float t = 0.0;
    
    // Skip empty space using voxel grid
    vec3 p = g_geodesic(ray.o, ray.d, t);
    float grid_dist = texture(u_scene_sdf_distance_grid, p * 0.5 + 0.5).r;
    t += max(grid_dist - EPSILON, MIN_STEP);
    
    // Enhanced sphere tracing
    for(int i = 0; i < MAX_STEPS; i++) {
        p = g_geodesic(ray.o, ray.d, t);
        
        // Evaluate actual SDF
        float d = evaluate_sdf(obj_id, p);
        
        if(d < EPSILON) {
            populate_sdf_hit(hit, obj_id, p, t);
            return t < max_t;
        }
        
        // Adaptive stepping with safety
        float grid_bound = texture(u_scene_sdf_distance_grid, p * 0.5 + 0.5).r;
        t += min(d, grid_bound) * 0.9;  // Conservative factor
        
        if(t > max_t) break;
    }
    return false;
}
```

#### 5. Non-Euclidean Considerations

Acceleration structures in curved spaces require special handling:

```glsl
// Geodesic segment approximation for BVH traversal
bool curved_ray_box_test(Ray ray, vec3 box_min, vec3 box_max, float max_t) {
    // Subdivide geodesic into segments
    const int SEGMENTS = 4;
    float dt = max_t / float(SEGMENTS);
    
    for(int i = 0; i < SEGMENTS; i++) {
        vec3 p0 = g_geodesic(ray.o, ray.d, dt * float(i));
        vec3 p1 = g_geodesic(ray.o, ray.d, dt * float(i+1));
        
        // Conservative line-box test for segment
        if(segment_box_intersect(p0, p1, box_min, box_max))
            return true;
    }
    return false;
}
```

### Build Pipeline Integration

The acceleration structure build happens at compile time:

1. **JavaScript Preprocessing**: Build BVH from mesh/SDF bounds
2. **Texture Generation**: Pack nodes into RGBA float textures
3. **Shader Generation**: Create specialized traversal code
4. **Upload to GPU**: Transfer textures with acceleration data

### Performance Targets

- **Simple scenes** (10-100 objects): 60+ fps at 1080p
- **Complex scenes** (1000+ objects): 30+ fps at 1080p
- **Hero scenes** (100k+ triangles): 10+ fps at 1080p

### Future WebGPU Migration

When WebGPU becomes available, we can enhance with:
- Storage buffers for pointer-like BVH traversal
- Compute shaders for GPU-side BVH builds
- Persistent threads for wavefront path tracing
- Hardware ray tracing (when available)

### Implementation Priority

This is a **Phase 2** feature - after basic rendering works but before production complexity. The implementation order:

1. Simple BVH for meshes (stackless traversal)
2. Distance field caching for SDFs
3. Unified hybrid traversal
4. Dynamic scene updates (Phase 3)




# Future Direction: Dual-Mode Spectral/RGB Rendering Architecture

## Overview

This document outlines the architectural approach for supporting both RGB and spectral rendering modes in the path tracer. The design allows materials and estimators to be authored in either mode, with compile-time selection ensuring zero overhead for the unused path.

## Core Design Principles

1. **Spectrum as a fundamental type** - Like Point and Direction, Spectrum is defined by the geometry module as a core mathematical type
2. **Compile-time specialization** - RGB vs spectral is chosen at shader compilation, not runtime
3. **Parallel module variants** - Separate RGB and spectral versions of materials and estimators
4. **Type safety** - Cannot mix RGB materials with spectral estimators or vice versa
5. **Zero overhead** - RGB path has no spectral code, spectral path has no RGB compromises

## Type System Architecture

### Fundamental Types

```glsl
// In math/types.glsl (after Geometry defines Point and Direction)

#ifdef SPECTRAL_RENDERING
  typedef float Spectrum;  // Single wavelength value
  struct WavelengthInfo {
    float lambda;         // Wavelength in nm
    float pdf;           // Sampling probability
  };
#else
  typedef vec3 Spectrum;  // RGB triplet
  struct WavelengthInfo {
    int dummy;           // Placeholder for uniform signatures
  };
#endif
```

### Spectrum Operations

```glsl
// Operations work for both modes
Spectrum spectrum_add(Spectrum a, Spectrum b);
Spectrum spectrum_mul(Spectrum s, float t);
Spectrum spectrum_modulate(Spectrum a, Spectrum b);
float spectrum_luminance(Spectrum s);

// Implementation differs based on mode
#ifdef SPECTRAL_RENDERING
  Spectrum spectrum_add(Spectrum a, Spectrum b) { return a + b; }
  Spectrum spectrum_modulate(Spectrum a, Spectrum b) { return a * b; }
#else
  Spectrum spectrum_add(Spectrum a, Spectrum b) { return a + b; }
  Spectrum spectrum_modulate(Spectrum a, Spectrum b) { return a * b; }
#endif
```

## Module Classification

### Module Descriptors

```typescript
interface MaterialDescriptor {
  id: {
    kind: 'Material';
    name: string;
    version: string;
    spectrum: 'rgb' | 'spectral';  // Declares compatibility
  };
  // ... rest of descriptor
}

interface EstimatorDescriptor {
  id: {
    kind: 'Estimator';
    name: string;
    version: string;
    spectrum: 'rgb' | 'spectral';  // Must match materials
  };
  // ... rest of descriptor
}
```

### Module Organization

```
world/
├── materials/
│   ├── rgb/
│   │   ├── disney_brdf_rgb/
│   │   ├── glass_rgb/
│   │   └── lambert_rgb/
│   └── spectral/
│       ├── disney_brdf_spectral/
│       ├── glass_spectral/        # With dispersion
│       └── measured_spectral/     # From spectrophotometer

photography/
└── estimators/
    ├── rgb/
    │   ├── pathtracer_rgb/
    │   └── direct_rgb/
    └── spectral/
        ├── pathtracer_spectral/
        └── hero_wavelength/
```

## Module Interfaces

### Material Interface (Both Modes)

```glsl
// RGB Material Implementation
vec3 m_interact(Direction wi, Hit hit, vec2 xi, 
                WavelengthInfo wl,  // Ignored in RGB mode
                out Direction wo, out float pdf) {
    vec3 albedo = material_albedos[hit.material_to];
    wo = sample_hemisphere(xi, hit.n);
    pdf = 1.0 / (2.0 * PI);
    return albedo / PI;
}

// Spectral Material Implementation (different module)
float m_interact(Direction wi, Hit hit, vec2 xi, 
                 WavelengthInfo wl,  // Used for wavelength
                 out Direction wo, out float pdf) {
    float albedo = interpolate_spectrum(hit.material_to, wl.lambda);
    wo = sample_hemisphere(xi, hit.n);
    pdf = 1.0 / (2.0 * PI);
    return albedo / PI;
}
```

### Estimator Interface

```glsl
// RGB Estimator
vec3 estimate(Ray ray) {
    WavelengthInfo wl;  // Dummy in RGB mode
    return trace_rgb(ray, wl);
}

// Spectral Estimator
vec3 estimate(Ray ray) {
    WavelengthInfo wl;
    wl.lambda = 380.0 + next_1d() * 400.0;
    wl.pdf = 1.0 / 400.0;
    
    float radiance = trace_spectral(ray, wl);
    return wavelength_to_rgb(wl.lambda, radiance / wl.pdf);
}
```

## Compilation Pipeline Changes

### Recipe Validation

```typescript
class RecipeValidator {
  validate(recipe: Recipe): ValidationResult {
    const material = registry.get(recipe.world.material);
    const estimator = registry.get(recipe.photography.estimator);
    const lights = registry.get(recipe.world.lights);
    
    // Check spectrum mode compatibility
    const spectrumMode = material.id.spectrum;
    
    if (estimator.id.spectrum !== spectrumMode) {
      return {
        valid: false,
        errors: [`Estimator '${estimator.id.name}' expects ${estimator.id.spectrum} but material '${material.id.name}' is ${material.id.spectrum}`]
      };
    }
    
    if (lights.id.spectrum && lights.id.spectrum !== spectrumMode) {
      return {
        valid: false,
        errors: [`Light module spectrum mode mismatch`]
      };
    }
    
    return { valid: true };
  }
}
```

### Shader Compilation

```typescript
class ShaderCompiler {
  compile(recipe: Recipe): CompiledProgram {
    const material = registry.get(recipe.world.material);
    const isSpectral = material.id.spectrum === 'spectral';
    
    // Set defines based on mode
    const defines: string[] = [];
    if (isSpectral) {
      defines.push('#define SPECTRAL_RENDERING');
      defines.push('#define WAVELENGTH_MIN 380.0');
      defines.push('#define WAVELENGTH_MAX 780.0');
    }
    
    // Continue with normal compilation
    return this.compileWithDefines(recipe, defines);
  }
}
```

## Material Data Structures

### RGB Materials

```glsl
// Simple RGB storage
struct RGBMaterial {
    vec3 albedo;
    float roughness;
    float metallic;
    float ior;
};

const RGBMaterial materials[NUM_MATERIALS] = RGBMaterial[](
    RGBMaterial(vec3(0.8, 0.2, 0.2), 0.5, 0.0, 1.5),
    // ...
);
```

### Spectral Materials

```glsl
// Spectral data storage
struct SpectralMaterial {
    float albedo_samples[32];      // Reflectance at each wavelength
    float wavelength_points[32];   // Wavelength sample points
    float roughness;
    float metallic;
    float ior_A;                   // Cauchy A coefficient
    float ior_B;                   // Cauchy B (dispersion)
};

float get_ior_at_wavelength(int mat_id, float lambda) {
    SpectralMaterial mat = spectral_materials[mat_id];
    return mat.ior_A + mat.ior_B / (lambda * lambda);
}
```

## Wavelength Conversion Infrastructure

```glsl
// Required for spectral mode
vec3 wavelength_to_rgb(float lambda, float radiance) {
    // CIE 1931 color matching functions
    vec3 xyz = sample_cie_1931(lambda);
    
    // XYZ to sRGB matrix
    const mat3 xyz_to_rgb = mat3(
         3.2404542, -1.5371385, -0.4985314,
        -0.9692660,  1.8760108,  0.0415560,
         0.0556434, -0.2040259,  1.0572252
    );
    
    return max(vec3(0.0), xyz_to_rgb * (xyz * radiance));
}
```

## Modules That Don't Change

The following modules are wavelength-agnostic and require no modifications:

- **Geometry**: Space curvature is wavelength-independent
- **Objects**: Shapes don't depend on wavelength
- **Scene**: Ray-object intersection is geometric
- **Camera**: Ray generation from pixels unchanged
- **Film**: Still accumulates RGB (after conversion)
- **Developer**: Tonemaps RGB values

## Implementation Phases

### Phase 1: Type Infrastructure
1. Add Spectrum typedef to math/types.glsl
2. Add WavelengthInfo struct
3. Implement spectrum operations
4. Keep Spectrum as vec3 initially

### Phase 2: Interface Updates
1. Add WavelengthInfo parameter to material functions
2. Add WavelengthInfo parameter to light functions
3. Update estimator signatures
4. RGB modules ignore the parameter

### Phase 3: Spectral Module Development
1. Create spectral variants of materials
2. Create hero wavelength estimator
3. Add wavelength-to-RGB conversion
4. Implement spectral light sources

### Phase 4: Integration
1. Update Recipe to specify spectrum mode
2. Modify compiler to set defines
3. Update validator for compatibility checking
4. Test RGB and spectral paths

## Benefits

- **Clean separation**: RGB and spectral paths don't compromise each other
- **Type safety**: Cannot mix incompatible modules
- **Performance**: Zero overhead for unused path
- **Research flexibility**: Easy comparison between RGB and spectral
- **Gradual migration**: Can port modules individually
- **Future-proof**: Architecture supports more complex spectral models

## Open Questions

1. **Wavelength sampling strategies**: Uniform vs importance sampling
2. **Spectral data formats**: How to author/import measured spectra
3. **Fluorescence**: Would require wavelength shifting, not just attenuation
4. **Polarization**: Natural extension that would follow similar pattern
