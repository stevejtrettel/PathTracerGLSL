# Materials Contract (Revised)

## Purpose

Materials provides **physical property data** for all materials in the scene. It maps MaterialIDs to properties that Photography's Interaction module will use to compute light behavior. Materials knows nothing about BRDFs, sampling strategies, or light transport - it is purely a data provider.

## Module Structure

```typescript
interface MaterialsModule {
  id: {
    kind: 'materials',
    name: string,              // 'standard' | 'simple' | 'full'
    version: string
  },
  fragment: {
    struct_definitions: string,  // MaterialProperties struct
    functions: string,           // material_get_properties() and helpers
    uniforms: string,           // Property arrays/textures
    constants: string,          // NUM_MATERIALS, flags, lookup tables
  },
  metadata: {
    numMaterials: number,
    hasVaryingProperties: Set<string>,
    hasVolumes: boolean,
    hasEmission: boolean,
    propertyRanges: Map<string, [min: number, max: number]>
  }
}
```

## Core Types

```glsl
// The central data structure
struct MaterialProperties {
  // Surface properties
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
  
  // Emission
  vec3 emission;
  float emission_intensity;
  
  // Volume properties
  vec3 sigma_scatter;
  vec3 sigma_absorb;
  float phase_g;
  
  // Transmission
  float transmission;
  vec3 transmission_color;
  
  // Additional
  float anisotropy;
  vec3 sheen_color;
  float sheen_roughness;
  
  // Packed flags for efficient testing
  int flags;  // Bit flags: DIELECTRIC | PARTICIPATING | EMISSIVE | THIN | etc.
}

// Material type flags
const int MATERIAL_FLAG_DIELECTRIC = 1;
const int MATERIAL_FLAG_PARTICIPATING = 2;
const int MATERIAL_FLAG_EMISSIVE = 4;
const int MATERIAL_FLAG_THIN = 8;
const int MATERIAL_FLAG_SUBSURFACE = 16;
```

## Required Functions

### material_get_properties
```glsl
MaterialProperties material_get_properties(int mat_id, vec3 p)
```
- Returns all properties for material at given point
- mat_id: MaterialID from Hit or Scene query
- p: World position for spatially-varying properties
- Must handle MATERIAL_AIR (returns air properties)

### material_get_ior
```glsl
float material_get_ior(int mat_id)
```
- Fast IOR-only query (often needed for interface calculations)
- Always returns constant (IOR rarely varies spatially)

### material_is_participating
```glsl
bool material_is_participating(int mat_id)
```
- Quick test for volume materials
- Used by Transport to choose integration strategy

## Optional Helper Functions

```glsl
vec3 material_get_emission(int mat_id, vec3 p)      // Just emission * intensity
bool material_is_emissive(int mat_id)               // Has any emission
bool material_is_dielectric(int mat_id)             // Glass/water/etc
float material_get_priority(int mat_id)             // For overlap resolution
```

## Implementation Patterns

### Compile-Time Specialized Properties

```glsl
// Generated based on scene analysis
#define HAS_VARYING_ALBEDO 1
#define HAS_VARYING_ROUGHNESS 0
#define HAS_EMISSION 1
#define HAS_VOLUMES 0

// Constant properties (when all materials have same value)
const float CONST_ROUGHNESS = 0.5;

// Property arrays for non-varying properties
const vec3 material_albedo[NUM_MATERIALS] = vec3[](
  vec3(0.8, 0.2, 0.2),  // Material 0
  vec3(0.2, 0.8, 0.2),  // Material 1
  vec3(0.95, 0.95, 0.95) // Material 2
);

const float material_ior[NUM_MATERIALS] = float[](
  1.5,   // Material 0: Plastic
  1.333, // Material 1: Water  
  1.5    // Material 2: Glass
);

// Texture handles for varying properties
uniform sampler2D albedo_textures[MAX_TEXTURES];
uniform int material_albedo_texture_id[NUM_MATERIALS];

// Main property function (optimized at compile time)
MaterialProperties material_get_properties(int mat_id, vec3 p) {
  MaterialProperties props;
  
  // Handle air specially
  if (mat_id == MATERIAL_AIR) {
    props.albedo = vec3(0);
    props.roughness = 0;
    props.metallic = 0;
    props.ior = 1.0;
    props.emission = vec3(0);
    props.emission_intensity = 0;
    props.sigma_scatter = vec3(0);
    props.sigma_absorb = vec3(0);
    props.phase_g = 0;
    props.flags = 0;
    return props;
  }
  
  // Albedo - varying or constant based on analysis
  #if HAS_VARYING_ALBEDO
    props.albedo = material_sample_albedo(mat_id, p);
  #else
    props.albedo = material_albedo[mat_id];
  #endif
  
  // Roughness - compile-time constant in this scene
  #if HAS_VARYING_ROUGHNESS
    props.roughness = material_sample_roughness(mat_id, p);
  #else
    props.roughness = CONST_ROUGHNESS;  // All materials have same roughness
  #endif
  
  // Properties that are always per-material constants
  props.metallic = material_metallic[mat_id];
  props.ior = material_ior[mat_id];
  
  // Emission (only if scene has emissive materials)
  #if HAS_EMISSION
    props.emission = material_emission[mat_id];
    props.emission_intensity = material_emission_intensity[mat_id];
  #else
    props.emission = vec3(0);
    props.emission_intensity = 0;
  #endif
  
  // Volume properties (excluded if no volumes)
  #if HAS_VOLUMES
    if (material_flags[mat_id] & MATERIAL_FLAG_PARTICIPATING) {
      props.sigma_scatter = material_sigma_scatter[mat_id];
      props.sigma_absorb = material_sigma_absorb[mat_id];
      props.phase_g = material_phase_g[mat_id];
    } else {
      props.sigma_scatter = vec3(0);
      props.sigma_absorb = vec3(0);
      props.phase_g = 0;
    }
  #else
    props.sigma_scatter = vec3(0);
    props.sigma_absorb = vec3(0);
    props.phase_g = 0;
  #endif
  
  props.flags = material_flags[mat_id];
  return props;
}
```

### Texture Sampling Helpers

```glsl
vec3 material_sample_albedo(int mat_id, vec3 p) {
  int tex_id = material_albedo_texture_id[mat_id];
  if (tex_id < 0) {
    return material_albedo[mat_id];  // Fallback to constant
  }
  
  vec2 uv = material_compute_uv(mat_id, p);
  return texture(albedo_textures[tex_id], uv).rgb;
}

vec2 material_compute_uv(int mat_id, vec3 p) {
  // UV mapping strategy per material
  switch(material_uv_mode[mat_id]) {
    case UV_MODE_SPHERICAL:
      return spherical_map(p);
    case UV_MODE_PLANAR:
      return planar_map(p, material_uv_params[mat_id]);
    case UV_MODE_TRIPLANAR:
      return triplanar_map(p, material_uv_params[mat_id]);
    default:
      return vec2(0);
  }
}
```

### Procedural Properties

```glsl
vec3 material_sample_albedo_procedural(int mat_id, vec3 p) {
  switch(mat_id) {
    case MATERIAL_MARBLE:
      return marble_pattern(p * 2.0);
    case MATERIAL_WOOD:
      return wood_pattern(p * vec3(1, 1, 0.5));
    default:
      return material_albedo[mat_id];
  }
}

vec3 marble_pattern(vec3 p) {
  float veins = fbm(p * 4.0) * 0.5 + 0.5;
  return mix(vec3(0.9), vec3(0.2), smoothstep(0.4, 0.6, veins));
}
```

## Build-Time Generation

```typescript
class MaterialsCompiler {
  compile(analysis: SceneAnalysis): MaterialsModule {
    const props = this.analyzeProperties(analysis);
    
    // Determine what can be compile-time constants
    const constants = this.findConstantProperties(props);
    
    // Generate optimized property function
    const propertyFunction = this.generatePropertyFunction(props, constants);
    
    // Generate helper functions only for varying properties
    const helpers = this.generateHelpers(props.varying);
    
    // Generate data arrays
    const arrays = this.generateArrays(props);
    
    return {
      id: { kind: 'materials', name: 'optimized', version: '1.0' },
      fragment: {
        struct_definitions: MATERIAL_PROPERTIES_STRUCT,
        functions: propertyFunction + helpers,
        uniforms: arrays.uniforms,
        constants: arrays.constants + this.generateDefines(props)
      },
      metadata: {
        numMaterials: analysis.materials.length,
        hasVaryingProperties: props.varying,
        hasVolumes: props.hasVolumes,
        hasEmission: props.hasEmission,
        propertyRanges: props.ranges
      }
    };
  }
  
  generatePropertyFunction(props: PropertyAnalysis, constants: Map<string, any>): string {
    const sections = [];
    
    // Generate each property access
    for (const [prop, info] of props.properties) {
      if (constants.has(prop)) {
        sections.push(`props.${prop} = ${constants.get(prop)};`);
      } else if (info.varying) {
        sections.push(`
          #if HAS_VARYING_${prop.toUpperCase()}
            props.${prop} = material_sample_${prop}(mat_id, p);
          #else
            props.${prop} = material_${prop}[mat_id];
          #endif
        `);
      } else {
        sections.push(`props.${prop} = material_${prop}[mat_id];`);
      }
    }
    
    return `
      MaterialProperties material_get_properties(int mat_id, vec3 p) {
        MaterialProperties props;
        
        if (mat_id == MATERIAL_AIR) {
          return air_properties();
        }
        
        ${sections.join('\n')}
        
        props.flags = material_flags[mat_id];
        return props;
      }
    `;
  }
}
```

## Validation Rules

1. **material_get_properties** must handle all MaterialIDs in scene plus MATERIAL_AIR
2. All properties must be finite and physically valid:
    - albedo ∈ [0,1]³
    - roughness ∈ [0,1]
    - metallic ∈ [0,1]
    - ior > 0
    - sigma_* ≥ 0
    - phase_g ∈ [-1,1]
3. Texture IDs must be valid or -1
4. UV coordinates should be in [0,1]² after mapping
5. Flag bits must be consistent with properties

## Usage Example from Photography

```glsl
// In Interaction module
Spectrum interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) {
  // Get properties once
  MaterialProperties props = material_get_properties(hit.material_to, hit.p);
  
  // Check if we need special handling
  if (props.flags & MATERIAL_FLAG_DIELECTRIC) {
    return shade_dielectric(wi, wo, hit, props);
  }
  
  // Standard shading using properties
  return disney_brdf(wi, wo, hit.n, props.albedo, props.roughness, props.metallic);
}
```

## Key Design Decisions

1. **Single Query**: One function returns all properties to minimize memory access
2. **Compile-Time Optimization**: Dead code elimination for unused properties
3. **Manual Prefixing**: All functions use `material_` prefix
4. **No Physics**: No BRDF evaluation, sampling, or PDFs - just data
5. **Spatial Variation**: Support for textures and procedural patterns where needed
6. **Flag-Based Dispatch**: Efficient type checking via bit flags

This design makes Materials a pure data module that knows nothing about how light interacts with these properties - that's entirely Photography's responsibility.
