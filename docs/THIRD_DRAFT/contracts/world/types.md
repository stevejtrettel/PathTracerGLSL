You're absolutely right. The compilers should be pure functions that take simple lists and produce modules. Let me revise types.md with this cleaner separation:

# types.md (Revised)

## User Input Types (for convenience)

```typescript
interface SceneDescription {
  objects: UserObject[];
  materials: Map<string, MaterialDescription>;
}

interface LightDescription {
  lights: UserLight[];
  environment?: EnvironmentMap;
}

// ... user-friendly types
```

## Compiler Input Types (what compilers actually consume)

```typescript
// Scene Compiler takes:
interface SceneCompilerInput {
  objects: CompilerObject[];
  materials: CompilerMaterial[];
}

interface CompilerObject {
  id: string;
  sdf: string;            // GLSL function for SDF
  materialId: number;     // Which material it uses
  transform: mat4;
}

interface CompilerMaterial {
  id: number;
  albedo: vec3;
  roughness: number;
  metallic: number;
  ior: number;
  emission: vec3;
  flags: number;
}

// Lighting Compiler takes:
interface LightingCompilerInput {
  lights: CompilerLight[];
  environment?: EnvironmentMap;
}

interface CompilerLight {
  id: string;
  type: 'point' | 'directional' | 'spot' | 'area' | 'bbox';
  
  // Common
  intensity: vec3;
  
  // Type-specific
  position?: vec3;
  direction?: vec3;
  radius?: number;          // For sphere area lights
  bounds?: AABB;            // For bbox sampling
  geometryId?: string;      // For area lights tied to objects
}
```

Now the compilers are truly agnostic:

```typescript
class SceneCompiler {
  compile(input: SceneCompilerInput): ModuleDescriptor {
    // Doesn't know or care where objects came from
    // Just compiles SDFs and material lookups
  }
}

class LightingCompiler {
  compile(input: LightingCompilerInput): ModuleDescriptor {
    // Doesn't know or care if lights were originally objects
    // Just compiles sampling functions
  }
}
```

The augmentor is just a transformation utility:
```typescript
class Augmentor {
  transform(scene: SceneDescription, lights: LightDescription): {
    sceneInput: SceneCompilerInput;
    lightingInput: LightingCompilerInput;
  } {
    // Convenience function that cross-references
    // But compilers work fine without it
  }
}
```

This is much cleaner. Should we write the SceneCompiler or LightingCompiler next? They're now simple pure functions with clear inputs and outputs.
