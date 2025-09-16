# Module Descriptor Contract

Every module in the system must conform to this TypeScript interface.

## Interface Definition

```typescript
interface ModuleDescriptor {
  // Module identity
  id: {
    kind: string;     // "Geometry", "Material", "Camera", etc.
    name: string;     // "Euclidean", "Lambert", "Pinhole", etc.
    version: string;  // Semantic versioning: "1.0.0"
  };
  
  // GLSL shader fragment
  fragment: {
    // Uniform declarations (will be auto-prefixed)
    uniforms?: string;
    
    // GLSL functions (your mathematical implementation)
    functions: string;
    
    // Functions this module exports for others to use
    provides?: string[];
    
    // Functions this module needs from other modules
    requires?: string[];
    
    // Entry point for shader main (rarely used)
    entrypoints?: {
      fragmentMain?: string;
    };
  };
  
  // Runtime parameters
  parameters?: Array<{
    name: string;                    // Clean name (auto-prefixed)
    kind: ParameterKind;             // Type of parameter
    default: number | boolean | number[];
    min?: number;                    // For numeric types
    max?: number;                    // For numeric types
    step?: number;                   // For UI sliders
    resetPolicy?: ResetPolicy;       // When to reset accumulation
    description?: string;            // For documentation/UI
  }>;
  
  // Optional metadata
  metadata?: {
    author?: string;
    paper?: string;      // Reference publication
    description?: string;
  };
}

type ParameterKind = 
  | "float" 
  | "int" 
  | "bool" 
  | "vec2" 
  | "vec3" 
  | "vec4" 
  | "mat3" 
  | "mat4";

type ResetPolicy = 
  | "none"         // Changing doesn't reset (e.g., exposure)
  | "accumulation" // Reset film on change (e.g., albedo)
  | "program";     // Recompile shader on change (rare)
```

## Auto-Prefixing Convention

The engine automatically transforms names based on module kind:

### Uniforms
```glsl
// You write:
uniform vec3 position;

// Engine produces:
uniform vec3 u_camera_pinhole_position;
// Format: u_${kind}_${name}_${parameter}
```

### Functions
```glsl
// You write:
vec3 generate_ray(vec2 pixel, vec2 xi) { ... }

// Engine produces:
vec3 c_generate_ray(vec2 pixel, vec2 xi) { ... }
```

### Prefix Map
- Geometry: `g_`
- Material: `m_`
- Scene: `sc_`
- Light: `l_`
- Camera: `c_`
- Estimator: `e_`
- Film: `f_`
- Developer: `d_`

## Example Module

```typescript
const pinholeCamera: ModuleDescriptor = {
  id: { 
    kind: "Camera", 
    name: "Pinhole", 
    version: "1.0.0" 
  },
  
  fragment: {
    // Clean names - no prefixes
    uniforms: `
      uniform vec3 position;
      uniform vec3 target;
      uniform float fov;
    `,
    
    // Clean function names
    functions: `
      Ray generate_ray(vec2 pixel, vec2 xi) {
        vec2 ndc = (pixel + xi - 0.5 * u_resolution) / u_resolution.y;
        
        vec3 forward = normalize(target - position);
        vec3 right = normalize(cross(vec3(0,1,0), forward));
        vec3 up = cross(forward, right);
        
        float tan_fov = tan(radians(fov) * 0.5);
        vec3 direction = normalize(
          forward + (right * ndc.x + up * ndc.y) * tan_fov
        );
        
        return Ray(position, direction);
      }
    `,
    
    // What this module exports
    provides: ["generate_ray"],
    
    // What this module needs (if any)
    requires: []  // Camera needs nothing from others
  },
  
  parameters: [
    { 
      name: "position", 
      kind: "vec3", 
      default: [0, 0, 5],
      resetPolicy: "accumulation",
      description: "Camera position in world space"
    },
    { 
      name: "target", 
      kind: "vec3", 
      default: [0, 0, 0],
      resetPolicy: "accumulation",
      description: "Look-at point"
    },
    { 
      name: "fov", 
      kind: "float", 
      default: 60,
      min: 10,
      max: 170,
      step: 1,
      resetPolicy: "accumulation",
      description: "Field of view in degrees"
    }
  ],
  
  metadata: {
    author: "Your Name",
    description: "Simple pinhole camera with no depth of field"
  }
};
```

## Cross-Module Function Calls

When calling functions from other modules (listed in `requires`):

```glsl
// You write (clean names):
Hit hit;
if (intersect(ray, hit)) {
  vec3 color = eval_bsdf(wi, wo, hit);
}

// Engine resolves to:
if (sc_intersect(ray, hit)) {
  vec3 color = m_eval_bsdf(wi, wo, hit);
}
```

## Compilation Process

1. **Collection**: Gather all modules from World + Photography
2. **Validation**: Check all `requires` are satisfied by some module's `provides`
3. **Ordering**: Topological sort based on dependencies
4. **Prefixing**: Add prefixes to uniforms and provided functions
5. **Resolution**: Resolve cross-module calls based on `requires`
6. **Assembly**: Generate final GLSL program

## Module Kinds

Valid module kinds and their responsibilities:

**World Modules:**
- `Geometry`: Space definition (metric, geodesics)
- `Material`: Surface properties (BSDF)
- `Scene`: Object arrangement (intersection)
- `Light`: Emitters (sampling, evaluation)

**Photography Modules:**
- `Camera`: Ray generation
- `Estimator`: Light transport
- `Film`: Accumulation
- `Developer`: Output processing

## Validation Rules

The engine validates:
1. Module ID has valid kind, name, and version
2. All functions in `requires` exist in some module's `provides`
3. No duplicate function names in `provides` across modules
4. Parameter types match uniform declarations
5. Entry point exists if specified
6. No circular dependencies

## Notes

- Write clean mathematical code without prefixes
- The engine handles all namespacing automatically
- Functions in `provides` become available to other modules
- Functions in `requires` must be provided by another module
- Parameters automatically become uniforms with proper scoping
