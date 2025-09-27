# Integration Contract

## Build Pipeline

```
1. Analysis: Scene → MaterialIDs → Light requirements
2. Compilation: Generate optimized modules
3. Assembly: Combine into World descriptor
4. Validation: Verify contracts satisfied
```

## Module Dependencies

```
Geometry (defines types)
    ↓
Objects (use geometric ops)
    ↓
Scene (arranges objects, resolves materials)
    ↓
Materials (shade using MaterialIDs from Scene)
    ↓
Lights (use material properties)
```

## World Descriptor

```typescript
interface WorldDescriptor {
  geometry: ModuleDescriptor;    // Hand-written
  objects: ModuleDescriptor[];   // Compiled objects
  scene: ModuleDescriptor;       // Generated arrangement
  material: ModuleDescriptor;    // ONE per scene
  lights: ModuleDescriptor;      // Hand-written or generated
  
  metadata: {
    materialIds: MaterialID[];
    hasVolumes: boolean;
    hasDielectrics: boolean;
    objectCount: number;
  }
}
```

## Analysis Phase

```typescript
interface SceneAnalysis {
  // From Scene
  objectDefinitions: CompiledObject[];
  transforms: Transform[];
  
  // Derived
  usedMaterialIds: Set<MaterialID>;
  boundingVolume: BoundingBox;
  complexity: 'simple' | 'medium' | 'complex';
  
  // Feature flags
  hasIsosurfaces: boolean;
  hasMultiRegion: boolean;
  requiresAcceleration: boolean;
}

interface MaterialAnalysis {
  // From used MaterialIDs
  materialType: string;          // Single BSDF type
  parameterSets: MaterialParams[];
  
  // Optimization opportunities
  constantProperties: Set<string>;
  unusedFeatures: Set<string>;
  parameterRanges: Map<string, [min, max]>;
}
```

## Compilation Order

1. **Geometry**: Selected, not compiled (hand-written)
2. **Objects**: Compile each unique object definition
3. **Scene**: Generate from object arrangement
4. **Materials**: Generate optimized for used MaterialIDs
5. **Lights**: Select or generate based on configuration

## Object Compilation

```typescript
class ObjectCompiler {
  compile(definition: ObjectDefinition): CompiledObject {
    const functions = {
      distance: this.generateDistance(definition),
      classifier: this.generateClassifier(definition),
      normal: this.generateNormal(definition)
    };
    
    return {
      id: definition.id,
      glsl: functions,
      usedMaterials: this.extractMaterialIds(definition)
    };
  }
  
  generateClassifier(def: ObjectDefinition): string {
    if (def.materials.default !== undefined) {
      return `
        int classify_${def.id}(vec3 p) {
          return ${def.geometry.function}(p) < 0.0 ? 
                 ${def.materials.default} : MATERIAL_AIR;
        }`;
    }
    // Multi-region generation...
  }
}
```

## Scene Generation

```typescript
class SceneCompiler {
  compile(objects: CompiledObject[], transforms: Transform[]): ModuleDescriptor {
    const dispatch = this.generateDispatch(objects);
    const marching = this.generateMarching(objects.length);
    const acceleration = this.generateAcceleration(objects, transforms);
    
    return {
      id: { kind: 'scene', name: 'compiled_scene', version: '1.0.0' },
      provides: ['intersect', 'intersect_any', 'inside'],
      requires: ['geometry', 'objects'],
      fragment: {
        dispatch,
        functions: marching + acceleration,
        uniforms: this.generateUniforms(transforms)
      }
    };
  }
  
  generateDispatch(objects: CompiledObject[]): string {
    const cases = objects.map((obj, i) => 
      `case ${i}: return ${obj.id}_sdf(p);`
    ).join('\n    ');
    
    return `
      float eval_object_sdf(int obj_id, vec3 p) {
        switch(obj_id) {
          ${cases}
        }
        return MAX_DIST;
      }`;
  }
}
```

## Material Generation

```typescript
class MaterialCompiler {
  compile(materialType: string, usedIds: MaterialID[]): ModuleDescriptor {
    const analysis = this.analyze(materialType, usedIds);
    
    // Load base BRDF
    const base = this.loadBRDF(materialType);
    
    // Optimize
    const optimized = this.optimize(base, analysis);
    
    // Generate tables
    const tables = this.generateTables(usedIds);
    
    return {
      id: { kind: 'material', name: materialType, version: '1.0.0' },
      provides: ['material'],
      requires: ['geometry'],
      fragment: {
        functions: optimized + tables.accessors,
        constants: tables.constants,
        uniforms: tables.uniforms
      }
    };
  }
  
  optimize(brdf: string, analysis: MaterialAnalysis): string {
    let result = brdf;
    
    // Remove unused features
    if (analysis.constantProperties.has('roughness')) {
      result = result.replace(/mp\.roughness/g, '1.0');
    }
    
    if (analysis.unusedFeatures.has('clearcoat')) {
      result = this.removeClearcoat(result);
    }
    
    return result;
  }
}
```

## Cross-Module Function Resolution

```typescript
interface FunctionMapping {
  required: string;        // 'intersect'
  provider: string;        // 'scene'
  resolvedName: string;    // 'sc_intersect'
}

class Resolver {
  resolve(modules: ModuleDescriptor[]): FunctionMapping[] {
    const provides = new Map<string, ModuleDescriptor>();
    const requires = new Map<string, ModuleDescriptor[]>();
    
    // Build dependency graph
    for (const module of modules) {
      for (const fn of module.provides || []) {
        provides.set(fn, module);
      }
      for (const fn of module.requires || []) {
        if (!requires.has(fn)) requires.set(fn, []);
        requires.get(fn).push(module);
      }
    }
    
    // Generate mappings
    return Array.from(requires.entries()).map(([fn, requesters]) => ({
      required: fn,
      provider: provides.get(fn)?.id.kind || 'unknown',
      resolvedName: this.getPrefixedName(fn, provides.get(fn))
    }));
  }
}
```

## Optimization Strategies

### Dead Code Elimination

```typescript
// Only include used material types
if (!analysis.hasVolumes) {
  // Exclude all volume code
  code = code.replace(/\/\*VOLUME_START\*\/.*\/\*VOLUME_END\*\//gs, '');
}

// Remove unused object types
if (!analysis.hasIsosurfaces) {
  // No zero-crossing detection needed
}
```

### Constant Propagation

```typescript
// Replace uniforms with constants when possible
if (allValuesEqual(analysis.parameterSets, 'roughness')) {
  code = code.replace(
    'uniform float u_roughness[NUM_MATERIALS]',
    `const float roughness = ${analysis.parameterSets[0].roughness}`
  );
}
```

### Loop Unrolling

```typescript
// For small object counts
if (objects.length < 20) {
  marching = generateUnrolledMarching(objects);
} else {
  marching = generateLoopMarching(objects);
}
```

## Validation

```typescript
class Validator {
  validate(world: WorldDescriptor): ValidationResult {
    const errors: string[] = [];
    
    // Check module dependencies
    if (!this.checkDependencies(world)) {
      errors.push('Missing required functions');
    }
    
    // Check MaterialID consistency
    const sceneIds = world.scene.metadata.usedMaterials;
    const materialIds = world.material.metadata.supportedIds;
    
    for (const id of sceneIds) {
      if (!materialIds.includes(id)) {
        errors.push(`MaterialID ${id} not supported by material module`);
      }
    }
    
    // Check type consistency
    if (!this.checkTypeConsistency(world.geometry, world.scene)) {
      errors.push('Point/Direction types mismatch');
    }
    
    return { valid: errors.length === 0, errors };
  }
}
```

## Memory Layout

```glsl
// Optimize uniform layout for GPU cache
layout(std140) uniform MaterialData {
  vec4 albedo_metallic[NUM_MATERIALS];     // Pack vec3 + float
  vec4 roughness_ior_flags[NUM_MATERIALS]; // Pack properties
} u_materials;

// Access helpers
vec3 get_albedo(int id) { 
  return u_materials.albedo_metallic[id].rgb; 
}
float get_metallic(int id) { 
  return u_materials.albedo_metallic[id].a; 
}
```

## Error Handling

```typescript
interface CompilationError {
  stage: 'analysis' | 'compilation' | 'assembly' | 'validation';
  module?: string;
  message: string;
  recoverable: boolean;
}

class IntegrationPipeline {
  compile(config: SceneConfig): WorldDescriptor | CompilationError {
    try {
      const analysis = this.analyze(config);
      const modules = this.compileModules(analysis);
      const world = this.assemble(modules);
      
      const validation = this.validate(world);
      if (!validation.valid) {
        return { 
          stage: 'validation', 
          message: validation.errors.join('\n'),
          recoverable: false
        };
      }
      
      return world;
    } catch (e) {
      return this.handleError(e);
    }
  }
}
```

## Performance Metrics

Track compilation performance:
- Analysis time per object
- Code generation time
- Optimization effectiveness (% code eliminated)
- Shader compilation time
- Total pipeline time

## Design Principles

1. **Single material module**: One BSDF type per scene
2. **Build-time optimization**: Generate minimal code
3. **Clear dependencies**: Explicit module ordering
4. **Type safety**: Validate Point/Direction consistency
5. **MaterialID consistency**: Verify all IDs handled
6. **Progressive optimization**: More objects → more optimization
7. **Predictable output**: Same input → same generated code
