# Material Module Compilation – Problem Description and Design

## 1. Overview and Goals

The Material module is responsible for:

1. **Defining material properties** across the entire path tracer (albedo, roughness, metallic, IOR, emission, etc.)
2. **Compiling material instances** from scene descriptions into efficient GLSL
3. **Providing the material query interface**: `MaterialProperties scene_material_properties(int mat_id, vec3 p)`
4. **Managing material IDs** that objects in the Scene module reference
5. **Supporting const/uniform/procedural parameters** for all material properties

The Material module compiles **before** the Scene module, so that objects can reference material IDs during scene compilation.

---

## 2. Material Model - The Universal Schema

### 2.1. Global Material Model Definition

The entire path tracer uses a **single, fixed material model** that defines all possible material properties:

```typescript
/**
 * Global material model - defines all material properties for this path tracer
 * This is a system-wide constant that all materials conform to
 */
export const MATERIAL_MODEL: MaterialModel = {
  properties: {
    albedo: { 
      type: 'vec3', 
      default: [0.5, 0.5, 0.5],
      description: 'Base color / reflectance'
    },
    roughness: { 
      type: 'float', 
      default: 0.5,
      min: 0.0,
      max: 1.0,
      description: 'Surface roughness (0=mirror, 1=diffuse)'
    },
    metallic: { 
      type: 'float', 
      default: 0.0,
      min: 0.0,
      max: 1.0,
      description: 'Metallic vs dielectric (0=dielectric, 1=metal)'
    },
    ior: { 
      type: 'float', 
      default: 1.5,
      min: 1.0,
      description: 'Index of refraction for dielectrics'
    },
    transmission: {
      type: 'float',
      default: 0.0,
      min: 0.0,
      max: 1.0,
      description: 'Transmission coefficient for glass/transparent materials'
    },
    emission: { 
      type: 'vec3', 
      default: [0.0, 0.0, 0.0],
      description: 'Emissive color'
    },
    emission_strength: { 
      type: 'float', 
      default: 0.0,
      min: 0.0,
      description: 'Emission intensity multiplier'
    },
    // ... additional properties as needed
  }
};

interface MaterialModel {
  properties: Record<string, PropertyDefinition>;
}

interface PropertyDefinition {
  type: 'float' | 'vec2' | 'vec3' | 'vec4' | 'int';
  default: any;
  min?: number;
  max?: number;
  description?: string;
}
```

**Key design decisions:**

- **Fixed at system initialization**: All materials use this schema
- **Smart defaults**: Every property has a sensible default value
- **Extensible**: Can add new properties for research (subsurface scattering, anisotropy, etc.)
- **Generates GLSL struct**: The MaterialProperties struct is generated directly from this model

**Note**: Changing the material model would require recompilation of the entire system. In practice, we'll define it once and use it throughout. However, the system is designed so that a different research project could use a different material model.

### 2.2. Generated MaterialProperties Struct

From the material model, we generate the GLSL struct:

```glsl
struct MaterialProperties {
  // Properties from MATERIAL_MODEL
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
  float transmission;
  vec3 emission;
  float emission_strength;
  
  // Added by compiler for lighting integration
  int light_id;  // -1 if not emissive, else index into light array for MIS
};
```

The `light_id` field is **not** part of the user-facing material model, but is added by the compiler to support Multiple Importance Sampling between direct light sampling and BRDF sampling.

---

## 3. Material Type Library

Similar to the object type library, we provide **convenience material types** that set appropriate defaults and constraints:

### 3.1. Material Type Definitions

```typescript
/**
 * Library of common material types
 * Each type specifies property overrides and required parameters
 */
export const MATERIAL_TYPES = {
  metal: {
    description: 'Metallic conductor (gold, silver, copper, etc.)',
    propertyOverrides: {
      metallic: 1.0,        // always 1 for metals
      transmission: 0.0,    // metals don't transmit
      ior: 1.0             // IOR unused for metals
    },
    requiredParams: ['albedo'],
    optionalParams: ['roughness', 'emission', 'emission_strength']
  },
  
  dielectric: {
    description: 'Non-metallic material (plastic, glass, water, etc.)',
    propertyOverrides: {
      metallic: 0.0        // always 0 for dielectrics
    },
    requiredParams: ['ior'],
    optionalParams: ['albedo', 'roughness', 'transmission', 'emission', 'emission_strength']
  },
  
  diffuse: {
    description: 'Pure diffuse/Lambertian material',
    propertyOverrides: {
      metallic: 0.0,
      roughness: 1.0,       // fully rough = diffuse
      transmission: 0.0,
      ior: 1.5             // standard dielectric IOR
    },
    requiredParams: ['albedo'],
    optionalParams: ['emission', 'emission_strength']
  },
  
  emissive: {
    description: 'Emissive light source material',
    requiredParams: ['emission', 'emission_strength'],
    optionalParams: ['albedo']  // can have colored emissive surface
  },
  
  glass: {
    description: 'Transparent glass material',
    propertyOverrides: {
      metallic: 0.0,
      transmission: 1.0,    // fully transmissive
      roughness: 0.0        // smooth glass
    },
    requiredParams: ['ior'],
    optionalParams: ['albedo']  // tinted glass
  },
  
  custom: {
    description: 'Custom material - specify all properties manually',
    propertyOverrides: {},
    requiredParams: [],
    optionalParams: Object.keys(MATERIAL_MODEL.properties)
  }
};

interface MaterialType {
  description: string;
  propertyOverrides: Partial<Record<string, any>>;
  requiredParams: string[];
  optionalParams: string[];
}
```

### 3.2. Using Material Types

In scene descriptions:

```typescript
const materials = {
  gold: {
    type: 'metal',
    albedo: [1.0, 0.84, 0.0],
    roughness: 0.2
  },
  
  glass: {
    type: 'glass',
    ior: 1.5,
    albedo: [0.95, 0.98, 1.0]  // slight blue tint
  },
  
  red_diffuse: {
    type: 'diffuse',
    albedo: [0.8, 0.1, 0.1]
  },
  
  area_light: {
    type: 'emissive',
    emission: [1.0, 0.9, 0.8],
    emission_strength: 10.0,
    albedo: [0.0, 0.0, 0.0]  // non-reflective emitter
  },
  
  weird_custom: {
    type: 'custom',
    // Must specify everything not in MATERIAL_MODEL defaults
    albedo: [0.5, 0.3, 0.8],
    roughness: 0.6,
    metallic: 0.3,
    transmission: 0.2,
    // ... etc
  }
};
```

**Material compilation process:**
1. Look up material type definition
2. Start with MATERIAL_MODEL defaults
3. Apply type's `propertyOverrides`
4. Apply user-specified parameters
5. Validate required parameters are present
6. Result: complete material instance with all properties filled

---

## 4. Material Description Input

### 4.1. MaterialDescription Structure

The input to the material compiler:

```typescript
interface MaterialDescription {
  /**
   * Map of material name to material definition
   * Material names are used by objects to reference materials
   */
  materials: Record<string, MaterialInstance>;
  
  /**
   * Optional: specify which material is ambient (default background)
   * If not specified, rays that miss all geometry return an error
   */
  ambientMaterial?: string;  // material name
}

interface MaterialInstance {
  /**
   * Material type (optional convenience)
   * If omitted, user must specify all properties explicitly
   */
  type?: keyof typeof MATERIAL_TYPES;
  
  /**
   * Material properties (const/uniform/procedural)
   * Property names must match MATERIAL_MODEL
   */
  [propertyName: string]: Parameter<any>;
}

// Parameter type (assumed solved from earlier discussion)
type Parameter<T> = 
  | T                     // constant
  | { param: string }     // uniform
  | string;               // GLSL function
```

### 4.2. Example Material Description

```typescript
const materialDescription: MaterialDescription = {
  materials: {
    gold: {
      type: 'metal',
      albedo: [1.0, 0.84, 0.0],
      roughness: 0.2
    },
    
    animated_glass: {
      type: 'glass',
      ior: { param: 'glass.ior' },  // uniform - can animate
      albedo: [1.0, 1.0, 1.0]
    },
    
    striped_surface: {
      type: 'diffuse',
      albedo: `
        vec3 compute(vec3 p) {
          float stripes = step(0.5, fract(p.y * 5.0));
          vec3 color1 = vec3(0.8, 0.1, 0.1);
          vec3 color2 = vec3(0.1, 0.1, 0.8);
          return mix(color1, color2, stripes);
        }
      `
    },
    
    ceiling_light: {
      type: 'emissive',
      emission: [1.0, 0.95, 0.9],
      emission_strength: 50.0
    }
  },
  
  ambientMaterial: 'air'  // or undefined for no ambient
};
```

---

## 5. Material ID Assignment

### 5.1. ID Assignment Strategy

Material IDs are assigned during compilation:

```typescript
/**
 * Material ID assignment
 * IDs are small integers starting from 0
 */
const materialIdMap: Map<string, number> = new Map();
const idToNameMap: Map<number, string> = new Map();

let nextId = 0;

// Assign IDs in deterministic order (e.g., alphabetical by name)
const materialNames = Object.keys(materialDescription.materials).sort();

for (const name of materialNames) {
  materialIdMap.set(name, nextId);
  idToNameMap.set(nextId, name);
  nextId++;
}

// Result:
// air -> 0
// animated_glass -> 1
// ceiling_light -> 2
// gold -> 3
// striped_surface -> 4
```

**Design decisions:**

- **No reserved IDs**: Unlike earlier thoughts, we don't reserve ID 0 for AIR or errors
- **Deterministic ordering**: Alphabetical ensures stable IDs across recompilation
- **Ambient material**: Just another material in the list with a special flag
- **Export mapping**: The compiler exports the name↔ID mapping for debugging and for the Scene module to use

### 5.2. Handling Ambient Material

**Option A - Scene-level specification (if materials and objects share a description):**
```typescript
const scene = {
  ambientMaterial: 'air',
  materials: { ... },
  objects: [ ... ]
};
```

**Option B - Material-level flag:**
```typescript
materials: {
  air: {
    type: 'dielectric',
    ior: 1.0,
    isAmbient: true
  }
}
```

**Open question**: How to represent ambient material in scene description? Need to decide based on how Scene and Material descriptions are organized.

For now, assume ambient material is specified somehow and the Material module records which material ID is ambient.

---

## 6. GLSL Code Generation

### 6.1. Main Material Query Function

The core output of material compilation:

```glsl
/**
 * Query material properties at a point
 * @param mat_id Material ID (from scene intersection)
 * @param p Position in world space (for procedural materials)
 * @return Complete material properties
 */
MaterialProperties scene_material_properties(int mat_id, vec3 p) {
  MaterialProperties props;
  
  switch (mat_id) {
    case 0:  // air
      props.albedo = vec3(0.5, 0.7, 1.0);
      props.roughness = 0.0;
      props.metallic = 0.0;
      props.ior = 1.0;
      props.transmission = 1.0;
      props.emission = vec3(0.0);
      props.emission_strength = 0.0;
      props.light_id = -1;
      break;
      
    case 1:  // animated_glass
      props.albedo = vec3(1.0, 1.0, 1.0);
      props.roughness = 0.0;
      props.metallic = 0.0;
      props.ior = u_material_glass_ior;  // uniform
      props.transmission = 1.0;
      props.emission = vec3(0.0);
      props.emission_strength = 0.0;
      props.light_id = -1;
      break;
      
    case 2:  // ceiling_light
      props.albedo = vec3(0.0);
      props.roughness = 0.0;
      props.metallic = 0.0;
      props.ior = 1.0;
      props.transmission = 0.0;
      props.emission = vec3(1.0, 0.95, 0.9);
      props.emission_strength = 50.0;
      props.light_id = 0;  // assigned by lighting coordination
      break;
      
    case 3:  // gold
      props.albedo = vec3(1.0, 0.84, 0.0);
      props.roughness = 0.2;
      props.metallic = 1.0;
      props.ior = 1.0;
      props.transmission = 0.0;
      props.emission = vec3(0.0);
      props.emission_strength = 0.0;
      props.light_id = -1;
      break;
      
    case 4:  // striped_surface
      props.albedo = material_4_albedo(p);  // call procedural helper
      props.roughness = 1.0;
      props.metallic = 0.0;
      props.ior = 1.5;
      props.transmission = 0.0;
      props.emission = vec3(0.0);
      props.emission_strength = 0.0;
      props.light_id = -1;
      break;
      
    default:
      // Invalid material ID - return error material (hot pink)
      props.albedo = vec3(1.0, 0.0, 1.0);
      props.roughness = 0.5;
      props.metallic = 0.0;
      props.ior = 1.5;
      props.transmission = 0.0;
      props.emission = vec3(0.0);
      props.emission_strength = 0.0;
      props.light_id = -1;
      break;
  }
  
  return props;
}
```

**Code generation strategy:**

- **Switch statement**: Clean, readable, likely compiles efficiently
- **All properties assigned**: Every case sets all properties explicitly
- **No early returns**: Keep structure uniform (compiler can optimize)
- **Default case**: Handle invalid IDs gracefully (helps debugging)

### 6.2. Procedural Property Helpers

For materials with procedural properties, generate helper functions:

```glsl
/**
 * Helper functions for procedural material properties
 * Generated above scene_material_properties()
 */

// For striped_surface material (ID 4)
vec3 material_4_albedo(vec3 p) {
  float stripes = step(0.5, fract(p.y * 5.0));
  vec3 color1 = vec3(0.8, 0.1, 0.1);
  vec3 color2 = vec3(0.1, 0.1, 0.8);
  return mix(color1, color2, stripes);
}

// If multiple properties are procedural:
float material_5_roughness(vec3 p) {
  // ... procedural roughness computation
}

vec3 material_5_emission(vec3 p) {
  // ... procedural emission pattern
}
```

**Naming convention**: `material_{id}_{property}(vec3 p)`

**Function extraction**: The compiler extracts user-provided GLSL functions, renames them to avoid collisions, and places them in the module's `functions` section.

### 6.3. Uniform Declarations

For materials with uniform parameters:

```glsl
// Generated in the uniforms section
uniform float u_material_glass_ior;
uniform vec3 u_material_metal_tint;
uniform float u_material_adjustable_roughness;
```

**Naming convention**: `u_material_{param_name}`

Where `param_name` comes from the user's parameter reference: `{ param: 'glass.ior' }` becomes `u_material_glass_ior`.

**Important**: We use the **parameter name directly** (with dots replaced by underscores), not the material instance name. This allows multiple materials to share the same uniform if desired.

---

## 7. Light ID Coordination

### 7.1. The Problem

Materials need a `light_id` field for Multiple Importance Sampling (MIS). This field:

- Is `-1` for non-emissive materials
- Points to an index in the global light array for emissive materials that are also in the lighting system

The challenge: **light IDs are assigned by the Lighting module**, but materials are compiled first.

### 7.2. Coordination Strategy

**Phase 1: Pre-compilation analysis (World Compiler)**

Before compiling either materials or lighting:

```typescript
// World compiler analyzes scene description
const emissiveMaterials = findEmissiveMaterials(materialDescription);
// ["ceiling_light", "floor_glow", ...]

const explicitLights = findLights(lightDescription);
// [{ type: 'point', ... }, { type: 'directional', ... }]

// Determine which emissive materials are ALSO lights
// (user specifies this somehow - e.g., materials that appear in lighting list)
const emissiveMaterialsToSample = intersect(emissiveMaterials, lightingList);
// ["ceiling_light"]  // only this one is in both lists

// Assign light IDs
let nextLightId = 0;

// First, assign IDs to explicit lights
for (const light of explicitLights) {
  assignLightId(light, nextLightId++);
}

// Then, assign IDs to emissive materials that should be sampled
const materialLightIds = new Map<string, number>();
for (const matName of emissiveMaterialsToSample) {
  materialLightIds.set(matName, nextLightId++);
}
```

**Phase 2: Material compilation**

Material compiler receives the `materialLightIds` mapping and uses it:

```typescript
function compileMaterials(
  description: MaterialDescription,
  materialLightIds: Map<string, number>  // from World Compiler
): ModuleDescriptor {
  // ... generate switch statement
  // When generating case for an emissive material:
  const lightId = materialLightIds.get(materialName) ?? -1;
  // props.light_id = {lightId};
}
```

**Phase 3: Lighting compilation**

Lighting module is told about emissive materials:

```typescript
function compileLighting(
  lightDescription: LightDescription,
  emissiveMaterialsToSample: Array<{
    materialName: string,
    materialId: number,
    lightId: number
  }>
): ModuleDescriptor {
  // Generate light sampling code that includes both
  // explicit lights AND emissive materials
}
```

### 7.3. Open Questions

- **How does user specify which emissive materials should be sampled as lights?**
    - Separate lighting description that references materials?
    - Flag in material definition?
    - Implicit (all emissive materials become lights)?

- **How do we handle area lights that need geometry information?**
    - Light module needs shape/size for sampling
    - This information comes from Scene module
    - Coordination challenge across all three modules

**For now**: Document that this coordination happens, but details TBD when we design the Lighting module.

---

## 8. Module Descriptor Output

### 8.1. Complete ModuleDescriptor Structure

```typescript
interface ModuleDescriptor {
  id: {
    kind: 'material';
    name: 'materials';
    version: string;
  };
  
  fragment: {
    /**
     * Generated GLSL code
     * Order: helper functions, then main query function
     */
    functions: string;
    
    /**
     * Uniform declarations for parameterized materials
     */
    uniforms?: string;
    
    /**
     * Constants (if any - probably unused for materials)
     */
    constants?: string;
  };
  
  /**
   * Uniform bindings with initial values
   */
  uniformBindings?: UniformBinding[];
  
  /**
   * Exported function names (for validation)
   */
  exports?: string[];
  
  /**
   * Parameter definitions for UI/control system
   */
  parameters?: Record<string, ParameterMetadata>;
  
  /**
   * Material-specific metadata
   */
  metadata?: {
    /**
     * Material name to ID mapping (for Scene module)
     */
    materialIdMap: Record<string, number>;
    
    /**
     * ID to material name mapping (for debugging)
     */
    idToNameMap: Record<number, string>;
    
    /**
     * Ambient material ID (if specified)
     */
    ambientMaterialId?: number;
    
    /**
     * List of emissive material IDs
     */
    emissiveMaterialIds: number[];
  };
}
```

### 8.2. Example Generated Module

```typescript
const materialModule: ModuleDescriptor = {
  id: {
    kind: 'material',
    name: 'materials',
    version: '1.0.0'
  },
  
  fragment: {
    functions: `
      // MaterialProperties struct (generated from MATERIAL_MODEL)
      struct MaterialProperties {
        vec3 albedo;
        float roughness;
        float metallic;
        float ior;
        float transmission;
        vec3 emission;
        float emission_strength;
        int light_id;
      };
      
      // Procedural property helpers
      vec3 material_4_albedo(vec3 p) {
        float stripes = step(0.5, fract(p.y * 5.0));
        vec3 color1 = vec3(0.8, 0.1, 0.1);
        vec3 color2 = vec3(0.1, 0.1, 0.8);
        return mix(color1, color2, stripes);
      }
      
      // Main material query function
      MaterialProperties scene_material_properties(int mat_id, vec3 p) {
        MaterialProperties props;
        
        switch (mat_id) {
          case 0:  // air
            props.albedo = vec3(0.5, 0.7, 1.0);
            props.roughness = 0.0;
            props.metallic = 0.0;
            props.ior = 1.0;
            props.transmission = 1.0;
            props.emission = vec3(0.0);
            props.emission_strength = 0.0;
            props.light_id = -1;
            break;
            
          case 1:  // animated_glass
            props.albedo = vec3(1.0, 1.0, 1.0);
            props.roughness = 0.0;
            props.metallic = 0.0;
            props.ior = u_material_glass_ior;
            props.transmission = 1.0;
            props.emission = vec3(0.0);
            props.emission_strength = 0.0;
            props.light_id = -1;
            break;
            
          case 2:  // ceiling_light
            props.albedo = vec3(0.0);
            props.roughness = 0.0;
            props.metallic = 0.0;
            props.ior = 1.0;
            props.transmission = 0.0;
            props.emission = vec3(1.0, 0.95, 0.9);
            props.emission_strength = 50.0;
            props.light_id = 0;
            break;
            
          case 3:  // gold
            props.albedo = vec3(1.0, 0.84, 0.0);
            props.roughness = 0.2;
            props.metallic = 1.0;
            props.ior = 1.0;
            props.transmission = 0.0;
            props.emission = vec3(0.0);
            props.emission_strength = 0.0;
            props.light_id = -1;
            break;
            
          case 4:  // striped_surface
            props.albedo = material_4_albedo(p);
            props.roughness = 1.0;
            props.metallic = 0.0;
            props.ior = 1.5;
            props.transmission = 0.0;
            props.emission = vec3(0.0);
            props.emission_strength = 0.0;
            props.light_id = -1;
            break;
            
          default:
            props.albedo = vec3(1.0, 0.0, 1.0);
            props.roughness = 0.5;
            props.metallic = 0.0;
            props.ior = 1.5;
            props.transmission = 0.0;
            props.emission = vec3(0.0);
            props.emission_strength = 0.0;
            props.light_id = -1;
            break;
        }
        
        return props;
      }
    `,
    
    uniforms: `
      uniform float u_material_glass_ior;
    `,
    
    constants: ''
  },
  
  uniformBindings: [
    {
      name: 'u_material_glass_ior',
      type: 'float',
      value: 1.5
    }
  ],
  
  exports: ['scene_material_properties'],
  
  parameters: {
    'glass.ior': {
      type: 'float',
      default: 1.5,
      min: 1.0,
      max: 3.0,
      displayName: 'Glass IOR',
      description: 'Index of refraction for animated glass material'
    }
  },
  
  metadata: {
    materialIdMap: {
      'air': 0,
      'animated_glass': 1,
      'ceiling_light': 2,
      'gold': 3,
      'striped_surface': 4
    },
    idToNameMap: {
      0: 'air',
      1: 'animated_glass',
      2: 'ceiling_light',
      3: 'gold',
      4: 'striped_surface'
    },
    ambientMaterialId: 0,
    emissiveMaterialIds: [2]
  }
};
```

---

## 9. Compilation Pipeline

### 9.1. High-Level Flow

```
MaterialDescription
    ↓
1. Validate material definitions
   - Check required parameters
   - Validate property names against MATERIAL_MODEL
    ↓
2. Expand material types
   - Apply type defaults and overrides
   - Fill in MATERIAL_MODEL defaults
    ↓
3. Assign material IDs
   - Sort by name (deterministic)
   - Create bidirectional mapping
    ↓
4. Process parameters
   - Detect const/uniform/procedural
   - Extract procedural functions
   - Generate uniform declarations
    ↓
5. Generate GLSL code
   - MaterialProperties struct
   - Procedural helper functions
   - scene_material_properties() switch statement
    ↓
6. Build ModuleDescriptor
   - Assemble all GLSL
   - Create uniform bindings
   - Export metadata
    ↓
ModuleDescriptor (Material module ready for shader compilation)
```

### 9.2. Detailed Steps

**Step 1: Validation**
```typescript
function validateMaterialDescription(desc: MaterialDescription): void {
  for (const [name, material] of Object.entries(desc.materials)) {
    // Check type exists
    if (material.type && !(material.type in MATERIAL_TYPES)) {
      throw new Error(`Unknown material type: ${material.type}`);
    }
    
    // Check property names
    for (const propName of Object.keys(material)) {
      if (propName === 'type') continue;
      if (!(propName in MATERIAL_MODEL.properties)) {
        throw new Error(`Unknown property ${propName} in material ${name}`);
      }
    }
    
    // Check required parameters for type
    if (material.type) {
      const typeDef = MATERIAL_TYPES[material.type];
      for (const required of typeDef.requiredParams) {
        if (!(required in material)) {
          throw new Error(`Material ${name} missing required property ${required}`);
        }
      }
    }
  }
}
```

**Step 2: Expand material types**
```typescript
function expandMaterial(instance: MaterialInstance): ExpandedMaterial {
  // Start with MATERIAL_MODEL defaults
  const expanded = { ...MATERIAL_MODEL.defaults };
  
  // Apply type overrides if specified
  if (instance.type) {
    const typeDef = MATERIAL_TYPES[instance.type];
    Object.assign(expanded, typeDef.propertyOverrides);
  }
  
  // Apply user-specified properties
  for (const [key, value] of Object.entries(instance)) {
    if (key !== 'type') {
      expanded[key] = value;
    }
  }
  
  return expanded;
}
```

**Step 3: Parameter processing**
```typescript
function processParameter(
  value: Parameter<any>,
  materialId: number,
  propertyName: string
): ProcessedParameter {
  // Constant
  if (typeof value !== 'string' && !('param' in value)) {
    return { type: 'constant', value };
  }
  
  // Uniform
  if ('param' in value) {
    const uniformName = `u_material_${value.param.replace(/\./g, '_')}`;
    return {
      type: 'uniform',
      uniformName,
      paramPath: value.param
    };
  }
  
  // Procedural
  const functionName = `material_${materialId}_${propertyName}`;
  const extractedGLSL = extractAndRenameFunction(value, functionName);
  return {
    type: 'procedural',
    functionName,
    glsl: extractedGLSL
  };
}
```

**Step 4: Generate switch statement**
```typescript
function generateSwitchCase(
  materialId: number,
  materialName: string,
  expanded: ExpandedMaterial,
  processed: Record<string, ProcessedParameter>
): string {
  const cases: string[] = [];
  
  cases.push(`case ${materialId}:  // ${materialName}`);
  
  for (const [propName, propDef] of Object.entries(MATERIAL_MODEL.properties)) {
    const param = processed[propName];
    
    let valueExpr: string;
    if (param.type === 'constant') {
      valueExpr = formatGLSLValue(param.value, propDef.type);
    } else if (param.type === 'uniform') {
      valueExpr = param.uniformName;
    } else {  // procedural
      valueExpr = `${param.functionName}(p)`;
    }
    
    cases.push(`  props.${propName} = ${valueExpr};`);
  }
  
  // Add light_id
  const lightId = getLightIdForMaterial(materialName);  // from coordination
  cases.push(`  props.light_id = ${lightId};`);
  
  cases.push(`  break;\n`);
  
  return cases.join('\n');
}
```

---

## 10. Efficiency Considerations

### 10.1. Current Approach (Simple)

- **Switch statement**: Clean, readable
- **All properties assigned**: Explicit, no magic
- **Procedural functions**: Called as needed

**Performance characteristics:**
- One switch branch per material ID (fast)
- Constants inlined by compiler
- Uniforms are single memory reads
- Procedural functions add call overhead but are only used when needed

### 10.2. Future Optimizations (Deferred)

**Property subsetting**: If we know the Interaction module only needs certain properties (e.g., albedo and roughness for a simple BRDF), we could:
- Generate minimal MaterialProperties structs
- Skip computing unused properties
- Reduce register pressure

**Example**:
```glsl
// Instead of full MaterialProperties:
MaterialPropertiesSubset scene_material_properties_diffuse(int mat_id, vec3 p) {
  // Only compute albedo, skip everything else
}
```

This is **future optimization** - not needed for initial implementation.

**Constant material packing**: For materials with all constant properties, could pack into arrays:
```glsl
const vec3 material_albedos[N] = vec3[N](...);
const float material_roughnesses[N] = float[N](...);

props.albedo = material_albedos[mat_id];
props.roughness = material_roughnesses[mat_id];
```

However, this doesn't work well when some materials have procedural properties, so probably not worth it.

**Verdict**: Start with simple switch statement. Optimize only if profiling shows it's a bottleneck (unlikely - geometry intersection is the expensive part).




## 12. Open Questions and Future Work

### 12.1. Immediate Questions

1. **Ambient material specification**: How should this be expressed in scene descriptions?
    - Separate field in world description?
    - Flag on material?
    - Default to error material?

2. **Light ID coordination details**: Exact mechanism for coordinating material and lighting compilation
    - Who initiates the analysis?
    - How is the mapping communicated?
    - What if materials change but lights don't (incremental recompilation)?

3. **Material type extensibility**: Should users be able to define custom material types, or is the library fixed?

### 12.2. Future Enhancements

1. **Texture support**: Materials will eventually need texture maps (albedo maps, normal maps, etc.)
    - How do textures integrate with procedural parameters?
    - Texture slots in material model?

2. **Subsurface scattering**: Additional material properties and specialized transport
    - Extend material model
    - Coordinate with Transport module

3. **Anisotropic materials**: Directional properties (brushed metal, velvet, etc.)
    - Additional properties in model
    - More complex BRDF evaluation

4. **Material graphs/layering**: Combining materials (e.g., clearcoat over base)
    - Compositional material system
    - More complex compilation

5. **Performance optimization**: Property subsetting, constant packing, etc.
    - Profile first, optimize if needed

---

## 13. Success Criteria

A successful Material module implementation will:

1. **Compile efficiently**: Fast compilation, clean GLSL output
2. **Support all parameter types**: Constants, uniforms, procedural work correctly
3. **Integrate cleanly**: Scene and Transport modules can use it without coupling
4. **Be extensible**: Adding new material properties doesn't break existing code
5. **Be debuggable**: Clear mapping from material names to IDs, good error messages
6. **Perform well**: Material queries don't bottleneck the path tracer

---

This document provides the foundation for implementing the Material module. The actual implementation can proceed incrementally, starting with simple constant materials and adding uniform and procedural support once the basic structure is working.
