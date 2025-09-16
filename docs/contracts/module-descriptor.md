# Module Descriptor Contract

Every module in the system must conform to this TypeScript interface.

## Interface

```typescript
interface ModuleDescriptor {
  // Identity - used for scoping parameters and debugging
  id: {
    kind: string;     // "Geometry" | "Material" | "Camera" | etc.
    name: string;     // "Pinhole" | "Lambert" | "Hyperbolic" | etc.
    version: string;  // Semantic versioning "1.0.0"
  };
  
  // Shader fragment
  fragment: {
    // Uniform declarations (will be auto-prefixed)
    uniforms?: string;
    
    // GLSL functions (the meat of your module)
    functions: string;
    
    // Functions this module exports for others to use
    provides?: string[];
    
    // Functions this module needs from other modules
    requires?: string[];
    
    // Entry point (only for modules that are fragment shader mains)
    entrypoints?: {
      fragmentMain?: string;
    };
  };
  
  // Parameters that can be adjusted at runtime
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
  | "float" | "int" | "bool" 
  | "vec2" | "vec3" | "vec4" 
  | "mat3" | "mat4";

type ResetPolicy = 
  | "none"         // Changing doesn't reset (e.g., exposure)
  | "accumulation" // Reset film on change (e.g., albedo)
  | "program";     // Recompile shader on change (rare)
```

## Example

```typescript
const pinholeCamera: ModuleDescriptor = {
  id: { 
    kind: "Camera", 
    name: "Pinhole", 
    version: "1.0.0" 
  },
  
  fragment: {
    // Don't prefix these - engine will auto-prefix
    uniforms: `
      uniform vec3 position;
      uniform vec3 target;
      uniform float fov;
    `,
    
    functions: `
      Ray c_generate_ray(vec2 pixel, vec2 xi) {
        // Implementation
      }
    `,
    
    provides: ["c_generate_ray"]
  },
  
  parameters: [
    { 
      name: "position", 
      kind: "vec3", 
      default: [0, 0, 5],
      resetPolicy: "accumulation" 
    }
  ]
};
```

## Auto-Prefixing

The engine automatically prefixes:
- Uniforms: `position` → `u_camera_pinhole_position`
- Module scope: `Camera/Pinhole@1.0.0`

## Validation

The engine validates:
1. All `requires` are satisfied by some module's `provides`
2. No duplicate `provides` across modules
3. Parameter types match uniform declarations
4. Entry point exists if specified
