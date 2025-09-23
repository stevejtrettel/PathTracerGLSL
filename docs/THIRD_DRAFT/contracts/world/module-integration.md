
# Module Integration

## Purpose
Defines how World modules integrate with the Engine and Photography modules to form a complete shader, with focus on how materials directly reference lights for proper MIS calculations.

## Module Loading Order

The Engine concatenates modules in a specific dependency order:

```typescript
const shaderSource = [
  commonTypes,                    // Shared type definitions
  recipe.world.geometry,          // Mathematical foundation
  recipe.world.scene,            // Objects and materials  
  recipe.world.lighting,         // Light sampling
  recipe.photography.camera,     // Ray generation
  recipe.photography.transport,  // Integration algorithms
  recipe.photography.interaction,// BRDFs
  recipe.photography.film,       // Accumulation
  recipe.photography.developer,  // Tone mapping
  mainFunction                   // Entry point
].join('\n');
```

Order matters: Transport depends on both Scene and Lighting being already defined.

## Critical Data Flow for MIS

### The Simplified Flow

The new system eliminates indirection through direct material→light references:

```glsl
// OLD FLOW (complex):
Hit hit;  // Contains object_id
scene_intersect(ray, hit);
int light_id = lighting_get_light_for_object(hit.object_id);
bool can_sample = lighting_can_sample_light(light_id);

// NEW FLOW (direct):
Hit hit;  // No object_id needed!
scene_intersect(ray, hit);
MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
if (props.light_id >= 0) {
  bool can_sample = lighting_can_sample(props.light_id);
}
```

### The MIS Decision Point

When Transport hits an emissive surface:

```glsl
// In Transport module
Hit hit;
if (scene_intersect(ray, hit)) {
  MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
  
  if (props.light_id >= 0) {
    // This material emits light!
    LightData light = lighting_get_light(props.light_id);
    
    if (lighting_can_sample(props.light_id)) {
      // This light CAN be sampled - need MIS
      float bsdf_pdf = last_bounce_pdf;
      float light_pdf = lighting_pdf(previous_point, ray.direction);
      float mis_weight = power_heuristic(bsdf_pdf, light_pdf);
      
      radiance += throughput * light.radiance * mis_weight;
    } else {
      // This light can ONLY be found by path tracing
      // Full weight - no MIS needed
      radiance += throughput * light.radiance;
    }
  }
}
```

## Function Dependencies

### Transport → Scene

Transport calls Scene for geometric queries:

```glsl
// Primary intersection
Hit hit;
if (scene_intersect(ray, hit)) {
  // hit.material_to tells us the material
  MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
  // props.light_id tells us if it's emissive (-1 if not)
}

// Shadow rays
bool occluded = scene_intersect_any(shadow_ray, light_distance);

// Volume tracking
int material = scene_material_at(point);
```

### Transport → Lighting

Transport calls Lighting for sampling and light information:

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

// Direct light access (NEW - much simpler!)
if (props.light_id >= 0) {
  LightData light = lighting_get_light(props.light_id);
  bool can_sample = lighting_can_sample(props.light_id);
}
```

### Interaction → Scene

Interaction queries material properties for BRDF evaluation:

```glsl
Spectrum interaction_evaluate(Direction wi, Direction wo, Hit hit) {
  // Get material properties
  MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
  
  // Use properties for BRDF
  float alpha = props.roughness * props.roughness;
  vec3 F = fresnel(props.ior, dot(wi, hit.n));
  // ...
}
```

## Uniform Management

### World Uniforms

The WorldCompiler generates simpler metadata:

```typescript
interface WorldUniforms {
  // Scene uniforms
  'u_material_albedo_metallic': Float32Array,
  'u_material_emission_strength': Float32Array,
  'u_material_ior_roughness_light': Float32Array,  // .z = light_id
  
  // Lighting uniforms  
  'u_lights': LightData[],
  'u_environment_map'?: Texture2D,
  
  // Simple counts
  'u_num_materials': number,
  'u_num_lights': number,
  'u_num_samplable': number,
}
```

### Binding Contract

```typescript
// Engine receives compiled world
const world = worldCompiler.compile(scene, lights, geometry);

// Engine binds uniforms
engine.setUniform('u_num_materials', world.metadata.counts.materials);
engine.setUniform('u_num_lights', world.metadata.counts.lights);
engine.setUniform('u_num_samplable', world.registry.samplableIndices.length);

// Light data as uniform array
engine.setUniform('u_lights', world.registry.lights);
```

## Constants Coordination

Modules share compile-time constants:

```glsl
// Generated by WorldCompiler, used by all modules
#define NUM_MATERIALS 5
#define NUM_LIGHTS 3        // Total lights (including non-samplable)
#define NUM_SAMPLABLE 2     // Lights we can actually sample
#define HAS_ENVIRONMENT 1
#define MATERIAL_AIR 0
```

## Error States and Validation

The Engine validates the integration:

```typescript
class ShaderIntegrationValidator {
  validate(world: CompiledWorld): ValidationResult {
    const errors = [];
    
    // Check light ID consistency
    for (const mat of world.materials) {
      if (mat.light_id >= world.registry.lights.length) {
        errors.push(`Material references invalid light ${mat.light_id}`);
      }
    }
    
    // Check samplable indices
    for (const idx of world.registry.samplableIndices) {
      if (idx >= world.registry.lights.length) {
        errors.push(`Samplable index ${idx} out of range`);
      }
    }
    
    // Verify all emissive materials have lights
    for (const mat of world.materials) {
      if (mat.emission.some(e => e > 0) && mat.light_id < 0) {
        errors.push(`Emissive material missing light assignment`);
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
}
```

## Debug Integration

For debugging MIS weights:

```glsl
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

### Direct Light Lookup

Light access is now a single array lookup:
```glsl
// Direct access - no indirection
LightData light = u_lights[props.light_id];  // O(1)
```

### Reduced Register Pressure

Hit structure is smaller without object_id:
- Saves register space
- Better GPU occupancy
- Simpler ray tracing loops

### Branch Prediction

Simpler branching pattern:
```glsl
if (props.light_id >= 0 && lighting_can_sample(props.light_id)) {
  // MIS path
} else {
  // Direct contribution or non-emissive
}
```

## Complete Example: MIS for Emissive Sphere

```glsl
// Scene: sphere has material 2 (emissive)
// Material 2 has light_id = 1

// In Transport, we hit the sphere:
Hit hit;
scene_intersect(ray, hit);
// hit.material_to = 2

// Get material properties
MaterialProperties props = scene_material_properties(2, hit.p);
// props.emission = vec3(10, 5, 2)
// props.light_id = 1

// Get light information
LightData light = lighting_get_light(1);
bool can_sample = lighting_can_sample(1);  // true for sphere

// Compute MIS weight
if (can_sample) {
  float bsdf_pdf = last_bounce_pdf;
  float light_pdf = lighting_pdf(prev_point, ray.direction);
  float mis_weight = power_heuristic(bsdf_pdf, light_pdf);
  radiance += throughput * light.radiance * mis_weight;
} else {
  radiance += throughput * light.radiance;
}
```

## Why This Architecture?

1. **Simplicity**: Direct material→light reference, no complex mappings
2. **Performance**: Smaller Hit structure, fewer indirections
3. **Correctness**: MIS weights computed correctly
4. **Maintainability**: Clear data flow, easy to debug
5. **Flexibility**: Easy to add new light types or sampling strategies

The integration is cleaner because each module maintains focused responsibilities with minimal cross-dependencies.
