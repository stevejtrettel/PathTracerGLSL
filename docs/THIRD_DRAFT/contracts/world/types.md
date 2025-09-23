Perfect! Let's design this right from the ground up. Here's a cleaner types.md that makes the design intent explicit:

```typescript
# types.md (Clean Design)

## User Input Types

```typescript
interface SceneDescription {
  objects: UserObject[];
  materials: Map<string, MaterialDescription>;
}

interface LightDescription {
  lights: UserLight[];
  environment?: EnvironmentMap;
}
```

## Compiler Input Types

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
  crossRef: CrossReferenceData;
}

// More explicit light representation
type CompilerLight = SamplableLight | NonSamplableLight;

interface SamplableLight {
  id: string;
  canSample: true;
  intensity: vec3;
  sourceObjectId?: string;  // Present if from emissive object
  
  sampling: 
    | { type: 'point'; position: vec3 }
    | { type: 'directional'; direction: vec3 }
    | { type: 'spot'; position: vec3; direction: vec3; angle: number }
    | { type: 'sphere'; position: vec3; radius: number }
    | { type: 'quad'; vertices: vec3[] }
    | { type: 'bbox'; bounds: AABB };  // Approximate sampling
}

interface NonSamplableLight {
  id: string;
  canSample: false;
  intensity: vec3;
  sourceObjectId: string;  // Always from an emissive object
}

interface EnvironmentMap {
  type: 'constant' | 'hdri';
  value?: vec3;
  path?: string;
  intensity: number;
}
```

## Cross-Reference System

```typescript
interface CrossReferenceData {
  // Core mappings
  objectToLight: Map<string, string>;  // objectId → lightId
  lightToObject: Map<string, string>;  // lightId → objectId
  
  // Sampling capability
  samplableLights: Set<string>;        // Which lights can be sampled
  
  // Statistics for optimization
  stats: {
    totalLights: number;
    samplableLights: number;
    pathOnlyEmissives: number;
  };
}
```

## Compiler Outputs

```typescript
interface CompiledWorld {
  modules: {
    geometry: ModuleDescriptor;
    scene: ModuleDescriptor;
    lighting: ModuleDescriptor;
  };
  crossRef: CrossReferenceData;
  metadata: WorldMetadata;
}

interface WorldMetadata {
  counts: {
    materials: number;
    objects: number;
    lights: number;
    samplableLights: number;
  };
  
  features: {
    hasEmissive: boolean;
    hasPathOnlyEmissive: boolean;
    hasEnvironment: boolean;
    hasVolumes: boolean;
  };
}

interface ModuleDescriptor {
  source: string;
  uniforms: UniformDescriptor[];
  constants: Map<string, any>;
  exports: string[];  // List of exported function names
}
```

## Sampling Strategy Configuration

```typescript
interface SamplingStrategyConfig {
  emissiveStrategy: {
    // How to handle emissive objects
    mode: 'all' | 'simple' | 'analyzed' | 'none';
    
    // For 'analyzed' mode
    complexityThreshold?: number;
    maxBboxVolume?: number;
    
    // Quality settings
    bboxSampleAttempts?: number;  // How many rejection samples
  };
  
  // Debug features
  verification: {
    enabled: boolean;
    pdfConsistencyChecks: boolean;
    logSamplingDecisions: boolean;
  };
}
```

## Compiler Interfaces

```typescript
class SceneCompiler {
  compile(input: SceneCompilerInput): ModuleDescriptor;
}

class LightingCompiler {
  compile(input: LightingCompilerInput): ModuleDescriptor;
}

class WorldCompiler {
  constructor(config: SamplingStrategyConfig);
  
  compile(
    scene: SceneDescription,
    lights: LightDescription,
    geometryModule: string
  ): CompiledWorld;
}
```


Key improvements in this clean design:

1. **Explicit light types** - `SamplableLight` vs `NonSamplableLight` using a discriminated union
2. **Cleaner sampling representation** - The `sampling` field clearly shows what kind of sampler we need
3. **CrossReference as first-class data** - Not an afterthought, but central to the design
4. **Structured metadata** - Organized into counts and features for better clarity
5. **Configuration object** - Explicit control over sampling strategies
6. **Module exports list** - Each module declares what functions it provides

This design makes impossible states unrepresentable (e.g., a non-samplable light can't have sampling parameters) and makes the intent crystal clear.
