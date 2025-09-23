
# Module Integration

## Purpose
Defines how World modules integrate with the Engine and Photography modules to form a complete shader, with special focus on how cross-reference data enables proper MIS calculations.

## The Integration Challenge

The key challenge is that Multiple Importance Sampling requires knowledge that spans modules:
- **Scene** knows which object was hit
- **Lighting** knows which objects correspond to samplable lights  
- **Transport** needs to combine this information for MIS weights

The cross-reference system bridges this gap.

## Module Loading Order

The Engine concatenates modules in a specific dependency order:

```typescript
const shaderSource = [
  commonTypes,                    // Shared type definitions
  recipe.world.geometry,          // Mathematical foundation
  recipe.world.scene,            // Objects and materials  
  recipe.world.lighting,         // Light sampling
  recipe.photography.camera,     // Ray generation
  recipe.photography.transport,  // Integration algorithms (USES MIS)
  recipe.photography.interaction,// BRDFs
  recipe.photography.film,       // Accumulation
  recipe.photography.developer,  // Tone mapping
  mainFunction                   // Entry point
].join('\n');
```

Order matters! Transport depends on both Scene and Lighting being already defined.

## Critical Data Flow for MIS

### The MIS Decision Point

When Transport hits an emissive object, it needs to make a critical decision:

```glsl
// In Transport module
Hit hit;
if (scene_intersect(ray, hit)) {
  MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
  
  if (length(props.emission) > 0.0) {
    // This is emissive! But how do we handle it?
    
    // NEW: Check if this object could have been sampled directly
    int light_id = lighting_get_light_for_object(hit.object_id);
    
    if (light_id >= 0 && lighting_can_sample_light(light_id)) {
      // This emissive CAN be sampled - need MIS
      float bsdf_pdf = last_bounce_pdf;
      float light_pdf = lighting_pdf(previous_point, ray.direction);
      float mis_weight = power_heuristic(bsdf_pdf, light_pdf);
      
      radiance += throughput * props.emission * mis_weight;
    } else {
      // This emissive can ONLY be found by path tracing
      // Full weight - no MIS needed
      radiance += throughput * props.emission;
    }
  }
}
```

### Why This Works

1. **Scene** provides `hit.object_id` - which object we hit
2. **Lighting** provides mapping - is this object also a light?
3. **Lighting** tells us if it's samplable - can we sample it directly?
4. **Transport** uses this info for correct MIS weights

## Function Dependencies

### Transport → Scene

Transport calls Scene for geometric queries:

```glsl
// Primary intersection
Hit hit;
if (scene_intersect(ray, hit)) {
  // hit.object_id tells us WHICH object (NEW)
  // hit.material_to tells us material
  
  MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
  // props.emission tells us if it's emissive
}

// Shadow rays (unchanged)
bool occluded = scene_intersect_any(shadow_ray, light_distance);

// Volume tracking (unchanged)
int material = scene_material_at(point);
```

### Transport → Lighting

Transport calls Lighting for sampling and MIS:

```glsl
// Sample a light
LightSample ls = lighting_sample(hit.p, xi);
if (ls.pdf > 0.0) {
  // Trace shadow ray
  if (!scene_intersect_any(shadow_ray, ls.distance)) {
    // Evaluate BSDF and compute contribution
    Spectrum f = interaction_evaluate(wo, ls.wi, props);
    
    // MIS weight for explicit sampling
    float bsdf_pdf = interaction_pdf(wo, ls.wi, props);
    float mis_weight = power_heuristic(ls.pdf, bsdf_pdf);
    
    radiance += throughput * ls.radiance * f * mis_weight / ls.pdf;
  }
}

// NEW: MIS helpers
int light_id = lighting_get_light_for_object(hit.object_id);
bool can_sample = lighting_can_sample_light(light_id);
```

### Lighting → Scene (NEW)

Lighting may need to call Scene for bbox rejection sampling:

```glsl
// In bbox light sampler (inside Lighting module)
float sdf = scene_evaluate_object_sdf(source_object_id, candidate_point);
if (abs(sdf) < 0.01) {
  // Point is on surface - valid sample
  vec3 normal = scene_compute_object_normal(source_object_id, candidate_point);
  // Use normal for PDF calculation
}
```

### Interaction → Scene

Interaction queries material properties for BRDF evaluation:

```glsl
Spectrum interaction_evaluate(Direction wi, Direction wo, Hit hit) {
  // Get material properties
  MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
  
  // Use properties for BRDF (unchanged)
  float alpha = props.roughness * props.roughness;
  vec3 F = fresnel(props.ior, dot(wi, hit.n));
  // ...
}
```

## Uniform Management with Cross-Reference

### World Uniforms

The WorldCompiler generates metadata about the cross-reference:

```typescript
interface WorldUniforms {
  // Scene uniforms
  'u_material_albedo_metallic': Float32Array,
  'u_material_emission_strength': Float32Array,
  'u_material_ior_roughness': Float32Array,
  
  // Lighting uniforms  
  'u_light_intensities': Float32Array,
  'u_environment_map'?: Texture2D,
  
  // NEW: Cross-reference metadata
  'u_num_objects': number,
  'u_num_lights': number,
  'u_num_samplable': number,
}
```

### Binding Contract

```typescript
// Engine receives compiled world
const world = worldCompiler.compile(scene, lights, geometry);

// Engine extracts metadata for uniform binding
engine.setUniform('u_num_objects', world.metadata.counts.objects);
engine.setUniform('u_num_samplable', world.crossRef.stats.samplableLights);

// Cross-reference tables are baked into GLSL, not uniforms
```

## Constants Coordination

Modules share compile-time constants that must agree:

```glsl
// Generated by WorldCompiler, used by all modules
#define NUM_MATERIALS 5
#define NUM_OBJECTS 10      // NEW: Total objects
#define NUM_LIGHTS 3        // Total lights (including non-samplable)
#define NUM_SAMPLABLE 2     // NEW: Lights we can actually sample
#define HAS_ENVIRONMENT 1
#define MATERIAL_AIR 0
```

These constants ensure array sizes match across modules.

## Error States and Validation

The Engine must validate the integration:

```typescript
class ShaderIntegrationValidator {
  validate(world: CompiledWorld): ValidationResult {
    const errors = [];
    
    // Check object ID consistency
    const maxObjectId = Math.max(...world.crossRef.objectToLight.keys());
    if (maxObjectId >= world.metadata.counts.objects) {
      errors.push(`Object ID ${maxObjectId} exceeds object count`);
    }
    
    // Check light samplability consistency
    const samplableCount = world.crossRef.samplableLights.size;
    if (samplableCount !== world.metadata.counts.samplableLights) {
      errors.push(`Samplable light count mismatch`);
    }
    
    // Verify all emissive objects are tracked
    for (const mat of world.materials) {
      if (mat.emission.some(e => e > 0)) {
        // Should have corresponding entry in cross-reference
        // ... validation logic
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
}
```

## Debug Integration

For debugging MIS weights:

```glsl
// Debug mode: visualize MIS weights
#ifdef DEBUG_MIS
vec3 debug_mis_weight_color(float weight) {
  // Red = BSDF only (weight = 1)
  // Green = balanced (weight ≈ 0.5)  
  // Blue = Light sampling only (weight = 0)
  return vec3(weight, 1.0 - abs(weight - 0.5) * 2.0, 1.0 - weight);
}

// In Transport
if (debug_mode == DEBUG_MIS_WEIGHTS) {
  output_color = debug_mis_weight_color(mis_weight);
  return;
}
#endif
```

## Performance Considerations

### Cross-Reference Lookup Cost

The object→light lookup is a single array access:
```glsl
// Constant time lookup
int light_id = OBJECT_TO_LIGHT[hit.object_id];  // O(1)
```

### Branch Prediction

Modern GPUs handle this pattern well:
```glsl
if (light_id >= 0 && LIGHT_CAN_SAMPLE[light_id]) {
  // MIS path - less common
} else {
  // Direct path - more common
}
```

### Register Pressure

The Hit structure is larger with object_id, but it's worth it:
- Without: incorrect MIS weights, energy loss/gain
- With: correct unbiased rendering

## Complete Example: MIS for Emissive Sphere

```glsl
// Scene: sphere is object 2, material 3 (emissive)
// Lighting: sphere became light 4, samplable

// In Transport, we hit the sphere:
Hit hit;
scene_intersect(ray, hit);
// hit.object_id = 2
// hit.material_to = 3

// Check emission
MaterialProperties props = scene_material_properties(3, hit.p);
// props.emission = vec3(10, 5, 2)

// Check if samplable
int light_id = lighting_get_light_for_object(2);  // Returns 4
bool can_sample = lighting_can_sample_light(4);   // Returns true

// Compute MIS weight
float bsdf_pdf = last_bounce_pdf;  // How we found it
float light_pdf = lighting_pdf(prev_point, ray.direction);  // Could we sample it?
float mis_weight = power_heuristic(bsdf_pdf, light_pdf);

// Apply with MIS weight
radiance += throughput * props.emission * mis_weight;
```

## Why This Architecture?

1. **Correctness**: Proper MIS weights prevent energy loss/gain
2. **Flexibility**: Can mark any emissive as samplable or not
3. **Performance**: Cross-reference is compile-time, lookups are O(1)
4. **Debugging**: Can visualize MIS decisions and weights
5. **Modularity**: Each module maintains its own concerns

The cross-reference system is the bridge that makes MIS work correctly across module boundaries.


This shows how the cross-reference data flows through the system and enables correct MIS calculations, while maintaining clean module separation.
