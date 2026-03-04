# Volumetric Path Tracing Architecture

## Overview

This document describes an architecture for GPU path tracing that treats volumetric objects as first-class citizens while maintaining efficiency. The core insight is that **once a ray enters an object (glass or volumetric), that object should handle all internal transport using specialized, generated code**.

## The Problem

Traditional approaches have issues:

1. **Calling `scene_intersect` for every volume scatter step is too expensive** - raymarching the entire scene when you know which volume you're in
2. **Switch statements over all objects create branch divergence** - checking 20 objects when you only care about 1
3. **Volume tracking is complex** - managing stacks, adjacency graphs, etc.

## The Solution: Three Transport Modes

Objects fall into three categories, each with different handling:

### 1. Opaque Objects
Examples: walls, floors, diffuse spheres, mirrors

**Behavior**: Light bounces off the surface and never enters
**Transport**: Standard surface bouncing via `scene_intersect`

### 2. Glass Objects (Transmissive, Non-Scattering)
Examples: clear glass, windows, thin transparent shells

**Behavior**: Light refracts through in a straight line, possibly with absorption (Beer's law)
**Transport**: Specialized trace function handles entry → exit → refract out

### 3. Volumetric Objects (Scattering Media)
Examples: smoke, fog, subsurface scattering, clouds

**Behavior**: Light scatters randomly inside the volume
**Transport**: Specialized trace function handles random walk until exit

## Key Architectural Principle

**`scene_intersect` only works from "outside" (in air/vacuum between objects)**

Once you enter an object (glass or volumetric), that object's specialized function takes over and handles everything until you exit. Then you're back "outside" and `scene_intersect` works again.

This avoids expensive full-scene queries when you know exactly which object you're inside.

## Material Structure

Materials describe substances and their properties. A material can have both surface and volume properties:

```typescript
{
  id: 'frosted_glass',
  surface: {
    type: 'dielectric',
    ior: 1.5,
    roughness: 0.1
  },
  volume: {
    scattering: vec3(0.5, 0.5, 0.5),  // Scattering coefficient
    absorption: vec3(0.01, 0.01, 0.01), // Absorption coefficient
    phase_g: 0.3  // Henyey-Greenstein parameter
  }
}
```

### Material Classifications

The compiler automatically determines object type from material properties:

- **Opaque**: Only has `surface` properties, no `volume`
- **Glass**: Has `surface` with `ior`, `volume` with zero/minimal scattering
- **Volumetric**: Has `volume` with non-zero scattering

You never manually specify object type - it's inferred from the material!

### Material Examples

```typescript
// Opaque wall
{
  id: 'concrete',
  surface: { type: 'lambertian', albedo: vec3(0.7, 0.7, 0.7) }
}

// Clear glass (straight path, absorption only)
{
  id: 'clear_glass',
  surface: { type: 'dielectric', ior: 1.5 },
  volume: { absorption: vec3(0.01, 0.01, 0.01) }  // No scattering!
}

// Subsurface scattering (random walk)
{
  id: 'jade',
  surface: { type: 'dielectric', ior: 1.6 },
  volume: { 
    scattering: vec3(2.0, 5.0, 3.0),
    absorption: vec3(0.1, 0.05, 0.08),
    phase_g: 0.0
  }
}

// Pure participating medium (fog/smoke)
{
  id: 'smoke',
  volume: {
    scattering: vec3(1.0, 1.0, 1.0),
    absorption: vec3(0.1, 0.1, 0.1),
    phase_g: 0.3
  }
}
```

## Object Definition

Objects reference materials and define geometry:

### Simple Objects

```typescript
{
  id: 'smoke_cube',
  geometry: {
    type: 'sdf',
    sdf_glsl: 'box_sdf(p, vec3(0,2,0), vec3(1,1,1))'
  },
  material: 'smoke'
  // Compiler sees material has scattering → generates volume trace function
}

{
  id: 'glass_pane',
  geometry: {
    type: 'sdf',
    sdf_glsl: 'box_sdf(p, vec3(2,1,0), vec3(2,3,0.1))'
  },
  material: 'clear_glass'
  // Compiler sees material has IOR but no scattering → generates glass trace function
}
```

### Multi-Region Objects

For objects with different materials in different spatial regions (like a cocktail glass):

```typescript
{
  id: 'water_shell',
  geometry: {
    type: 'multi_region_sdf',
    regions: [
      {
        id: 0,
        name: 'exterior',
        material: 'air',
        predicate_glsl: 'sphere_sdf(p, vec3(0,2,0), 2.0) > 0.0'
      },
      {
        id: 1,
        name: 'shell',
        material: 'glass',
        predicate_glsl: `
          float outer = sphere_sdf(p, vec3(0,2,0), 2.0);
          float inner = sphere_sdf(p, vec3(0,2,0), 1.8);
          return outer <= 0.0 && inner > 0.0;
        `
      },
      {
        id: 2,
        name: 'interior',
        material: 'water',  // Has scattering!
        predicate_glsl: 'sphere_sdf(p, vec3(0,2,0), 1.8) <= 0.0'
      }
    ]
  }
}
// Compiler generates trace function only for region 2 (water)
```

## Code Generation

The compiler processes the scene and generates specialized GLSL code.

### Phase 1: Analyze Materials

For each material, determine:
- Is it opaque? (surface only)
- Is it glass? (surface with IOR, no/minimal scattering)
- Is it volumetric? (volume with scattering)

### Phase 2: Analyze Objects

For each object:
- If material is glass → generate glass trace function
- If material is volumetric → generate volume trace function
- If multi-region → generate trace functions for regions with glass/volumetric materials

Build dispatch tables:
- Opaque objects: No trace function needed
- Glass objects: Assign glass_trace_id
- Volumetric objects: Assign volume_trace_id

### Phase 3: Generate Geometry Functions

Already handled by your existing SDF compilation:

```glsl
// For smoke_cube
float sdf_smoke_cube_distance(vec3 p) {
    return box_sdf(p, vec3(0,2,0), vec3(1,1,1));
}

// For water_shell (multi-region)
float sdf_water_shell_distance(vec3 p) {
    return sphere_sdf(p, vec3(0,2,0), 2.0);
}

int sdf_water_shell_region_at(vec3 p) {
    // Check predicates, return region ID
    // ...
}
```

### Phase 4: Generate Trace Functions

#### Glass Trace Function Template

```glsl
void trace_glass_{object_id}(inout Ray ray, inout vec3 throughput, inout bool alive) {
    // Material properties (known at compile time)
    const float ior = {material.surface.ior};
    const vec3 absorption = vec3({material.volume.absorption});
    
    // Refract into object
    vec3 refracted_dir = refract(ray.direction, surface_normal, 1.0/ior);
    if (length(refracted_dir) == 0.0) {
        // Total internal reflection - reflect instead
        ray.direction = reflect(ray.direction, surface_normal);
        return;
    }
    
    ray.direction = refracted_dir;
    ray.origin += EPSILON * ray.direction;
    
    // Find exit using hardcoded SDF (no scene_intersect!)
    float exit_dist = raymarch_exit_inline(ray, 
        p => {sdf_glsl for this object}
    );
    
    // Travel to exit
    ray.origin += ray.direction * exit_dist;
    
    // Apply absorption (Beer's law)
    throughput *= exp(-absorption * exit_dist);
    
    // Compute exit normal
    vec3 exit_normal = compute_normal_inline(ray.origin,
        p => {sdf_glsl for this object}
    );
    
    // Refract out
    ray.direction = refract(ray.direction, -exit_normal, ior);
    ray.origin += EPSILON * ray.direction;
}
```

#### Volume Trace Function Template

```glsl
void trace_volume_{object_id}(inout Ray ray, inout vec3 throughput, inout bool alive) {
    // Material properties (from uniforms or constants)
    const vec3 scattering = {material.volume.scattering};
    const vec3 absorption = {material.volume.absorption};
    const float phase_g = {material.volume.phase_g};
    
    vec3 sigma_t = scattering + absorption;
    vec3 albedo = scattering / sigma_t;
    
    // Random walk until exit
    while (alive) {
        // Sample scatter distance
        float scatter_dist = -log(random()) / sigma_t.x;  // Or sample per-channel
        
        // Find exit distance using hardcoded SDF (no scene_intersect!)
        float exit_dist = raymarch_exit_inline(ray,
            p => {sdf_glsl for this object}
        );
        
        if (scatter_dist < exit_dist) {
            // Scatter inside volume
            ray.origin += ray.direction * scatter_dist;
            throughput *= albedo;
            
            // Sample new direction from phase function
            ray.direction = sampleHenyeyGreenstein(phase_g);
            
            // Continue loop - still inside volume
            
        } else {
            // Exit the volume
            ray.origin += ray.direction * exit_dist;
            
            // Apply transmittance (no scattering events)
            throughput *= exp(-sigma_t * exit_dist);
            
            // Compute exit normal
            vec3 exit_normal = compute_normal_inline(ray.origin,
                p => {sdf_glsl for this object}
            );
            
            // Optional: handle surface interaction at boundary
            // (refraction, reflection, etc.)
            
            ray.origin += EPSILON * ray.direction;
            
            // Exit function - return to surface transport
            return;
        }
    }
}
```

#### Multi-Region Volume Trace Function

For region 2 of water_shell:

```glsl
void trace_volume_water_shell_r2(inout Ray ray, inout vec3 throughput, inout bool alive) {
    // Material properties for water
    const vec3 scattering = vec3(1.0, 0.8, 0.6);
    const vec3 absorption = vec3(0.1, 0.2, 0.3);
    
    vec3 sigma_t = scattering + absorption;
    vec3 albedo = scattering / sigma_t;
    
    while (alive) {
        float scatter_dist = -log(random()) / sigma_t.x;
        
        // Find exit - when region changes from 2 to something else
        float exit_dist = raymarch_until_region_change(ray, 2,
            p => sdf_water_shell_region_at(p)
        );
        
        if (scatter_dist < exit_dist) {
            // Scatter
            ray.origin += ray.direction * scatter_dist;
            throughput *= albedo;
            ray.direction = sampleHenyeyGreenstein(0.0);
        } else {
            // Exit
            ray.origin += ray.direction * exit_dist;
            throughput *= exp(-sigma_t * exit_dist);
            
            // Compute normal
            vec3 exit_normal = compute_normal_inline(ray.origin,
                p => sdf_water_shell_distance(p)
            );
            
            ray.origin += EPSILON * ray.direction;
            return;
        }
    }
}
```

### Phase 5: Generate scene_intersect

Your existing scene intersection code, enhanced to detect when entering glass/volumetric objects:

```glsl
struct Hit {
    float t;
    vec3 p;
    vec3 n;
    int material_from;
    int material_to;
    int glass_trace_id;   // -1 if not glass, else which glass function
    int volume_trace_id;  // -1 if not volumetric, else which volume function
};

bool scene_intersect(Ray ray, out Hit hit) {
    float closest_t = 1e10;
    int closest_obj = -1;
    
    // Check all objects, find closest
    for (int i = 0; i < NUM_OBJECTS; i++) {
        float t = intersect_object_i(ray, i);
        if (t > 0.0 && t < closest_t) {
            closest_t = t;
            closest_obj = i;
        }
    }
    
    if (closest_obj < 0) return false;
    
    // Fill hit info
    hit.t = closest_t;
    hit.p = ray.origin + closest_t * ray.direction;
    hit.n = compute_normal(hit.p, closest_obj);
    
    // Determine material_from by probing behind hit
    hit.material_from = scene_material_at(hit.p - EPSILON * ray.direction);
    
    // Determine material_to and trace functions
    vec3 test_ahead = hit.p + EPSILON * ray.direction;
    
    // This is where object_id and region_id are used internally
    if (closest_obj == OBJ_SMOKE_CUBE) {
        hit.material_to = MAT_SMOKE;
        if (sdf_smoke_cube_distance(test_ahead) < 0.0) {
            // Entering the volume
            hit.glass_trace_id = -1;
            hit.volume_trace_id = VOL_TRACE_SMOKE_CUBE;
        }
    } else if (closest_obj == OBJ_GLASS_PANE) {
        hit.material_to = MAT_CLEAR_GLASS;
        if (sdf_glass_pane_distance(test_ahead) < 0.0) {
            // Entering glass
            hit.glass_trace_id = GLASS_TRACE_PANE;
            hit.volume_trace_id = -1;
        }
    } else if (closest_obj == OBJ_WATER_SHELL) {
        // Multi-region - determine which region
        int region = sdf_water_shell_region_at(test_ahead);
        hit.material_to = water_shell_region_materials[region];
        
        if (region == 2) {
            // Entering water region (volumetric)
            hit.glass_trace_id = -1;
            hit.volume_trace_id = VOL_TRACE_WATER_SHELL_R2;
        } else if (region == 1) {
            // Entering glass region
            hit.glass_trace_id = GLASS_TRACE_WATER_SHELL_R1;
            hit.volume_trace_id = -1;
        }
    }
    // ... other objects ...
    
    return true;
}
```

**Note**: The `object_id` and `region_id` variables are **internal to this function**. They're temporary bookkeeping to navigate lookups. The Hit struct only exports what Transport needs.

### Phase 6: Generate Transport Loop

```glsl
void pathTrace(Ray ray) {
    vec3 throughput = vec3(1.0);
    vec3 radiance = vec3(0.0);
    bool alive = true;
    
    for (int bounce = 0; bounce < MAX_BOUNCES && alive; bounce++) {
        
        // Find next surface from "outside"
        Hit hit;
        if (!scene_intersect(ray, hit)) {
            // Missed scene - sample environment
            radiance += throughput * sampleEnvironment(ray.direction);
            break;
        }
        
        ray.origin = hit.p;
        
        // Dispatch based on what we're entering
        if (hit.glass_trace_id >= 0) {
            // Entering glass object
            switch (hit.glass_trace_id) {
                case GLASS_TRACE_PANE:
                    trace_glass_pane(ray, throughput, alive);
                    break;
                case GLASS_TRACE_WATER_SHELL_R1:
                    trace_glass_water_shell_r1(ray, throughput, alive);
                    break;
                // ... other glass objects ...
            }
            // When function returns, we've exited - back "outside"
            
        } else if (hit.volume_trace_id >= 0) {
            // Entering volumetric object
            switch (hit.volume_trace_id) {
                case VOL_TRACE_SMOKE_CUBE:
                    trace_volume_smoke_cube(ray, throughput, alive);
                    break;
                case VOL_TRACE_FOG_SPHERE:
                    trace_volume_fog_sphere(ray, throughput, alive);
                    break;
                case VOL_TRACE_WATER_SHELL_R2:
                    trace_volume_water_shell_r2(ray, throughput, alive);
                    break;
                // ... other volumetric objects ...
            }
            // When function returns, we've exited - back "outside"
            
        } else {
            // Hit opaque surface - standard BRDF bounce
            vec3 brdf = evaluateBRDF(hit.material_to, -ray.direction, hit.n);
            ray.direction = sampleBRDF(hit.material_to, hit.n);
            throughput *= brdf;
            
            // Check for light emission
            if (isEmissive(hit.material_to)) {
                radiance += throughput * getEmission(hit.material_to);
            }
        }
    }
    
    return radiance;
}
```

## The Switch Statement

Yes, we still have switch statements for dispatching to specialized functions. But:

### Why It's OK

1. **Small switches**: Only over objects that need trace functions, not all objects
    - Scene with 20 objects: 15 opaque (no switch), 2 glass, 3 volumetric = switch over 5 cases

2. **Temporal coherence**: A single ray might take 10 steps through the same volume, all hitting the same switch case

3. **Better than the alternative**: Much better than calling `scene_intersect` on every volume scatter

4. **Branch divergence is inherent**: Different volumes have different scattering properties anyway

### Switch Options

**Option A: Unified switch**
```glsl
if (hit.trace_id >= 0) {
    switch (hit.trace_id) {
        // All glass and volumetric together
    }
}
```

**Option B: Separate switches (recommended)**
```glsl
if (hit.glass_trace_id >= 0) {
    switch (hit.glass_trace_id) {
        // Only glass objects
    }
} else if (hit.volume_trace_id >= 0) {
    switch (hit.volume_trace_id) {
        // Only volumetric objects
    }
}
```

Option B is clearer and allows different function signatures if needed.

## Benefits of This Architecture

1. **Efficiency**: No expensive scene_intersect calls inside volumes - only check one hardcoded SDF

2. **Simplicity**: No volume stacks, no adjacency graphs - just "am I inside or outside?"

3. **Modularity**: Each object's internal transport is self-contained

4. **Compiler optimization**: Each trace function can be optimized independently

5. **Minimal branching**: Switch only over objects that need special handling

6. **Easy to extend**: Add new volumetric object? Just generate its trace function

7. **Natural material model**: Materials describe substances, compiler handles the rest

## Implementation Roadmap

### Step 1: Material Classification
Add logic to analyze materials and determine if they're opaque/glass/volumetric

### Step 2: Trace Function Generator
Build code generator that creates `trace_glass_X` and `trace_volume_X` functions from object descriptions

### Step 3: Enhance scene_intersect
Add logic to detect when entering glass/volumetric regions and set trace IDs in Hit struct

### Step 4: Dispatch in Transport
Add switch statements to dispatch to appropriate trace functions

### Step 5: Helper Functions
Implement:
- `raymarch_exit_inline()` - march SDF from inside until exit
- `raymarch_until_region_change()` - for multi-region volumes
- `compute_normal_inline()` - compute normal from inline SDF
- Phase function sampling (Henyey-Greenstein, etc.)

### Step 6: Testing
Start with simple scenes:
- Single glass pane
- Single smoke cube
- Multi-region object (glass shell with water)

## Edge Cases and Considerations

### Nested Volumes
Example: Glass ball with smoke inside

Model as multi-region object:
- Region 0: Exterior (air)
- Region 1: Glass shell (glass material)
- Region 2: Interior (smoke material)

Each region gets its own trace function if needed. When ray exits smoke and enters glass, scene_intersect is called again from the new "outside" position.

### Thin Surfaces
For delta surfaces (infinitely thin glass), the glass trace function immediately finds the exit on the back face without volume transport.

### Material Interfaces
When exiting a volume, you might need to handle refraction at the boundary. The trace function can do this before returning to surface transport.

### Russian Roulette
Can be applied either:
- In surface transport (standard)
- Inside volume trace functions (for long random walks)

### Multiple Scattering
Naturally handled - volume trace function keeps scattering until exit, accumulating throughput

## Example Scene

```typescript
const scene = {
  materials: [
    { id: 'diffuse_white', surface: { type: 'lambertian', albedo: [0.9, 0.9, 0.9] } },
    { id: 'mirror', surface: { type: 'specular' } },
    { id: 'clear_glass', surface: { ior: 1.5 }, volume: { absorption: [0.01, 0.01, 0.01] } },
    { id: 'jade', surface: { ior: 1.6 }, volume: { scattering: [2, 5, 3], absorption: [0.1, 0.05, 0.08] } },
    { id: 'fog', volume: { scattering: [0.5, 0.5, 0.5], absorption: [0.1, 0.1, 0.1] } }
  ],
  
  objects: [
    // Opaque objects - standard transport
    { id: 'floor', geometry: { type: 'plane', ... }, material: 'diffuse_white' },
    { id: 'ceiling', geometry: { type: 'plane', ... }, material: 'diffuse_white' },
    { id: 'mirror_sphere', geometry: { type: 'sphere', ... }, material: 'mirror' },
    
    // Glass object - generates trace_glass_window
    { id: 'window', geometry: { type: 'sdf', sdf_glsl: '...' }, material: 'clear_glass' },
    
    // Volumetric objects - generate trace_volume_X functions
    { id: 'jade_statue', geometry: { type: 'sdf', sdf_glsl: '...' }, material: 'jade' },
    { id: 'fog_box', geometry: { type: 'box', ... }, material: 'fog' },
  ]
};
```

Generated code will have:
- `scene_intersect`: Checks all 6 objects, returns closest
- `trace_glass_window`: Handles refraction through window
- `trace_volume_jade_statue`: Random walk through jade
- `trace_volume_fog_box`: Random walk through fog
- Transport loop with 2 switches (1 glass case, 2 volume cases)

## Conclusion

This architecture treats volumetric transport as first-class while maintaining efficiency through code generation. By generating specialized trace functions for each glass/volumetric object, we avoid expensive scene-wide intersection tests and minimize branch divergence.

The key insight: **separate "outside" transport (scene_intersect) from "inside" transport (specialized functions)**. This maps naturally to how light actually behaves and generates clean, efficient code.
