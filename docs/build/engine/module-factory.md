# Engine Implementation Guide - Built-in Module Factory Functions

## Overview

The Engine needs to provide built-in modules for each category. These are the "batteries included" modules that let the system work out of the box. Each factory function creates a ModuleDescriptor with the right GLSL code and parameters.

Remember: Users write unprefixed functions, the Engine adds prefixes automatically during compilation.

## Geometry Modules

### Euclidean Geometry Factory

This is the standard flat-space geometry that most ray tracers use.

```typescript
function createEuclideanGeometry(): ModuleDescriptor {
  // This module defines the basic types and operations for flat 3D space
  // It MUST be first because it defines Point and Direction types
  
  return {
    id: { 
      kind: 'geometry', 
      name: 'euclidean', 
      version: '1.0.0' 
    },
    
    provides: ['geodesic', 'dot', 'parallel_transport', 'frame'],
    requires: [],  // Geometry never requires anything
    
    fragment: {
      functions: `
        // Define the base types that everyone else uses
        // These are NOT prefixed because they're types, not functions
        typedef vec3 Point;
        typedef vec3 Direction;
        
        // The geodesic is just a straight line in Euclidean space
        // Users write: geodesic(origin, dir, t)
        // Engine produces: g_geodesic(origin, dir, t)
        Point geodesic(Point origin, Direction dir, float t) {
          return origin + dir * t;
        }
        
        // Dot product (metric-aware)
        // In Euclidean space this is just the standard dot product
        float dot(Direction a, Direction b, Point p) {
          // The Point p is ignored in flat space but needed for curved spaces
          return dot(a, b);  // Built-in GLSL dot
        }
        
        // Parallel transport (moving a vector along a curve)
        // In flat space, vectors don't change
        Direction parallel_transport(Direction v, Point from, Point to) {
          return v;  // No change in Euclidean space
        }
        
        // Build an orthonormal frame at a point
        // This is critical for BSDF evaluation
        Frame frame(Point p, Direction n) {
          // Build tangent and bitangent using Hughes-Möller method
          // or any other robust method
          
          // Find a vector not parallel to n
          Direction tangent;
          if (abs(n.x) < 0.9) {
            tangent = normalize(cross(vec3(1,0,0), n));
          } else {
            tangent = normalize(cross(vec3(0,1,0), n));
          }
          
          Direction bitangent = cross(n, tangent);
          
          Frame f;
          f.base = p;
          f.t = tangent;
          f.b = bitangent;
          f.n = n;
          return f;
        }
      `
    },
    
    parameters: []  // Euclidean geometry has no parameters
  };
}
```

### Why Geometry Must Be First

The Geometry module defines the fundamental types (`Point`, `Direction`, `Frame`) that ALL other modules use. The compiler puts it first so these types are available everywhere. Without this, other modules couldn't even compile.

## Material Modules

### Lambert Material Factory

The simplest possible material - pure diffuse reflection.

```typescript
function createLambertMaterial(): ModuleDescriptor {
  return {
    id: { 
      kind: 'material', 
      name: 'lambert', 
      version: '1.0.0' 
    },
    
    provides: ['evaluate', 'sample', 'pdf'],
    requires: ['frame'],  // Needs geometry to build frames
    
    fragment: {
      functions: `
        // The three-function BSDF interface
        // These enable Multiple Importance Sampling (MIS)
        
        // Evaluate the BSDF for given directions
        // Users write: evaluate(wi, wo, hit)
        // Engine produces: m_evaluate(wi, wo, hit)
        Spectrum evaluate(Direction wi, Direction wo, Hit hit) {
          // Lambert is just albedo / PI
          
          // Get the albedo for this material ID
          vec3 albedo = vec3(0.8);  // Would lookup from table using hit.material_id
          
          // Check if on same side of surface
          float ndi = dot(wi, hit.n);
          float ndo = dot(wo, hit.n);
          if (ndi * ndo < 0.0) return Spectrum(0);  // Different sides
          
          return Spectrum(albedo / PI);
        }
        
        // Sample a direction according to the BSDF
        Direction sample(Direction wi, Hit hit, vec2 xi, out float pdf) {
          // For Lambert, sample cosine-weighted hemisphere
          
          // Build local frame
          Frame f = frame(hit.p, hit.n);
          
          // Sample hemisphere (you'd have a helper for this)
          float theta = acos(sqrt(1.0 - xi.x));
          float phi = 2.0 * PI * xi.y;
          
          vec3 local_dir = vec3(
            sin(theta) * cos(phi),
            sin(theta) * sin(phi),
            cos(theta)
          );
          
          // Transform to world space
          Direction wo = f.t * local_dir.x + 
                        f.b * local_dir.y + 
                        f.n * local_dir.z;
          
          // PDF is cos(theta) / PI for cosine-weighted sampling
          pdf = max(0.0, dot(wo, hit.n)) / PI;
          
          return wo;
        }
        
        // Get the PDF for a given direction pair
        float pdf(Direction wi, Direction wo, Hit hit) {
          // For Lambert, PDF is cos(theta) / PI
          
          float ndi = dot(wi, hit.n);
          float ndo = dot(wo, hit.n);
          
          // Must be on same side
          if (ndi * ndo < 0.0) return 0.0;
          
          return max(0.0, abs(ndo)) / PI;
        }
      `
    },
    
    parameters: [
      {
        name: 'albedo',
        type: 'vec3',
        default: [0.8, 0.8, 0.8],
        min: 0.0,
        max: 1.0
      }
    ]
  };
}
```

### Disney Material Factory

The Disney (Principled) BSDF is much more complex. Here's the structure:

```typescript
function createDisneyMaterial(): ModuleDescriptor {
  // Disney BSDF with all the parameters
  // This is a production-ready material model
  
  return {
    id: { kind: 'material', name: 'disney', version: '1.0.0' },
    
    provides: ['evaluate', 'sample', 'pdf'],
    requires: ['frame'],
    
    fragment: {
      functions: `
        // Disney BSDF implementation
        // Based on the Disney Principled BSDF paper
        
        Spectrum evaluate(Direction wi, Direction wo, Hit hit) {
          // TODO: Implement full Disney BSDF evaluation
          // - Diffuse lobe
          // - Metallic lobe  
          // - Clearcoat lobe
          // - Subsurface lobe
          // - Sheen
          // - Proper Fresnel
          // All controlled by parameters
        }
        
        Direction sample(Direction wi, Hit hit, vec2 xi, out float pdf) {
          // TODO: Implement importance sampling
          // - Choose lobe based on weights
          // - Sample chosen lobe
          // - Compute PDF accounting for all lobes
        }
        
        float pdf(Direction wi, Direction wo, Hit hit) {
          // TODO: Compute PDF for MIS
          // - Weight PDFs from all lobes
        }
      `
    },
    
    parameters: [
      { name: 'base_color', type: 'vec3', default: [0.8, 0.8, 0.8] },
      { name: 'metallic', type: 'float', default: 0.0, min: 0, max: 1 },
      { name: 'roughness', type: 'float', default: 0.5, min: 0, max: 1 },
      { name: 'ior', type: 'float', default: 1.5, min: 1, max: 3 },
      { name: 'specular', type: 'float', default: 0.5, min: 0, max: 1 },
      { name: 'clearcoat', type: 'float', default: 0.0, min: 0, max: 1 },
      { name: 'clearcoat_gloss', type: 'float', default: 1.0, min: 0, max: 1 },
      { name: 'subsurface', type: 'float', default: 0.0, min: 0, max: 1 },
      { name: 'sheen', type: 'float', default: 0.0, min: 0, max: 1 },
      { name: 'sheen_tint', type: 'float', default: 0.5, min: 0, max: 1 }
    ]
  };
}
```

## Scene Modules

### SDF Scene Factory

A scene based on signed distance fields:

```typescript
function createSDFScene(): ModuleDescriptor {
  return {
    id: { kind: 'scene', name: 'sdf', version: '1.0.0' },
    
    provides: ['intersect', 'intersect_any', 'classify_point'],
    requires: ['geodesic'],  // Needs geometry for ray marching
    
    fragment: {
      functions: `
        // Ray-scene intersection using sphere tracing
        bool intersect(Ray ray, out Hit hit) {
          // TODO: Implement sphere tracing
          // - March along ray using SDF
          // - Stop when close enough to surface
          // - Fill hit structure with:
          //   - Position
          //   - Normal (from gradient)
          //   - Material IDs (from/to)
          //   - UV coordinates
          
          // Simplified example:
          float t = 0.0;
          for (int i = 0; i < 256; i++) {
            Point p = geodesic(ray.origin, ray.direction, t);
            float d = sdf(p);  // Would call actual SDF
            
            if (d < 0.001) {
              // Hit! Fill hit structure
              hit.p = p;
              hit.t = t;
              hit.n = calculate_normal(p);
              // ... fill rest of hit
              return true;
            }
            
            t += d * 0.9;  // Conservative marching
            
            if (t > ray.tmax) break;
          }
          
          return false;
        }
        
        // Shadow ray test (can be optimized)
        bool intersect_any(Ray ray, float max_t) {
          // TODO: Optimized version for shadow rays
          // - Can use larger steps
          // - Don't need hit details
          // - Early exit on any hit
        }
        
        // Check if point is inside an object
        int classify_point(Point p, int object_id) {
          // TODO: Return material ID at point
          // - Evaluate SDF
          // - If inside (SDF < 0), return material ID
          // - Otherwise return 0 (vacuum)
        }
        
        // The actual SDF would be here
        float sdf(Point p) {
          // TODO: Actual scene SDF
          // Could be generated from scene description
          return length(p) - 1.0;  // Sphere for now
        }
      `
    },
    
    parameters: [
      { name: 'march_iterations', type: 'int', default: 256 },
      { name: 'hit_epsilon', type: 'float', default: 0.001 },
      { name: 'march_factor', type: 'float', default: 0.9 }
    ]
  };
}
```

## Light Modules

### Point Light Factory

```typescript
function createPointLight(): ModuleDescriptor {
  return {
    id: { kind: 'lights', name: 'point', version: '1.0.0' },
    
    provides: ['sample_light', 'eval_light', 'pdf_light'],
    requires: [],
    
    fragment: {
      functions: `
        // Point lights are delta distributions
        
        LightSample sample_light(Point p, vec2 xi) {
          LightSample ls;
          
          // Direction to light
          vec3 to_light = u_light_position - p;
          ls.distance = length(to_light);
          ls.wi = normalize(to_light);
          
          // Inverse square falloff
          float falloff = 1.0 / (ls.distance * ls.distance);
          ls.radiance = Spectrum(u_light_color * u_light_intensity * falloff);
          
          // Delta light has PDF = 1
          ls.pdf = 1.0;
          ls.is_delta = true;
          
          return ls;
        }
        
        // Delta lights can't be hit by random rays
        Spectrum eval_light(Point p, Direction wi) {
          return Spectrum(0.0);
        }
        
        float pdf_light(Point p, Direction wi) {
          return 0.0;
        }
      `
    },
    
    parameters: [
      { name: 'position', type: 'vec3', default: [0, 10, 0] },
      { name: 'color', type: 'vec3', default: [1, 1, 1] },
      { name: 'intensity', type: 'float', default: 100.0 }
    ]
  };
}
```

## Camera, Estimator, Film, and Developer Factories

These follow the same pattern:

```typescript
function createPinholeCamera(): ModuleDescriptor {
  // Returns a module that provides 'generate_ray'
  // Uses precomputed camera matrices from engine
}

function createPathTracerEstimator(): ModuleDescriptor {
  // Returns a module that provides 'estimate'
  // Implements the main path tracing loop
}

function createSimpleFilm(): ModuleDescriptor {
  // Returns a module that provides 'accumulate'
  // Just averages samples
}

function createReinhardDeveloper(): ModuleDescriptor {
  // Returns a module that provides 'develop'
  // Simple tone mapping
}
```

## Key Points About Module Creation

1. **Users write unprefixed functions** - The engine adds prefixes
2. **Geometry must define types** - Point, Direction, Frame
3. **Materials use the 3-function interface** - evaluate, sample, pdf
4. **All modules declare their requires/provides** - For dependency checking
5. **Parameters become uniforms** - With automatic prefixing
6. **GLSL code is a string** - Will be assembled by compiler

## Module Registration Flow

```typescript
// In ModuleRegistry.registerDefaults():
const modules = [
  createEuclideanGeometry(),
  createLambertMaterial(),
  createDisneyMaterial(),
  createSDFScene(),
  createPointLight(),
  createPinholeCamera(),
  createPathTracerEstimator(),
  createSimpleFilm(),
  createReinhardDeveloper()
];

for (const module of modules) {
  this.register(module);  // Validates and indexes
}
```

The factory functions just create the ModuleDescriptor objects. The actual registration validates them, checks for duplicates, and builds the indexes for fast lookup.
