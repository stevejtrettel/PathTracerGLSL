                                                      # Module Registry Contract

## Purpose

The ModuleRegistry tracks all available modules, validates their contracts, resolves dependencies, and provides modules to the ShaderCompiler. It acts as the single source of truth for module availability and compatibility.

## Required Interface

```typescript
interface ModuleRegistry {
  // Registration
  register(module: ModuleDescriptor): void;
  registerBatch(modules: ModuleDescriptor[]): void;
  registerDefaults(): void;
  unregister(kind: ModuleKind, name: string): boolean;
  
  // Retrieval
  get(kind: ModuleKind, name: string): ModuleDescriptor | null;
  getAll(kind?: ModuleKind): ModuleDescriptor[];
  has(kind: ModuleKind, name: string): boolean;
  
  // Dependency resolution
  findProvider(functionName: string): ModuleDescriptor | null;
  findAllProviders(functionName: string): ModuleDescriptor[];
  validateDependencies(modules: ModuleDescriptor[]): DependencyValidation;
  
  // Module discovery
  listKinds(): ModuleKind[];
  listByKind(kind: ModuleKind): ModuleDescriptor[];
  search(query: ModuleQuery): ModuleDescriptor[];
  
  // Validation
  validateModule(module: ModuleDescriptor): ValidationResult;
  checkCompatibility(recipe: Recipe): CompatibilityResult;
  
  // Recipe resolution
  resolveModules(recipe: Recipe): ModuleCollection;
  
  // Cleanup
  clear(): void;
  dispose(): void;
}
```

## Storage Architecture

```typescript
class ModuleRegistry {
  // Primary storage: kind:name → module
  private modules: Map<string, ModuleDescriptor>;
  
  // Indexes for fast lookup
  private byKind: Map<ModuleKind, Set<ModuleDescriptor>>;
  private byProvides: Map<string, Set<ModuleDescriptor>>;
  private byRequires: Map<string, Set<ModuleDescriptor>>;
  
  // Metadata
  private registrationOrder: string[];
  private builtInModules: Set<string>;
  
  private getKey(kind: ModuleKind, name: string): string {
    return `${kind}:${name}`;
  }
}
```

## Module Validation Contract

Each registered module MUST be validated:

```typescript
validateModule(module: ModuleDescriptor): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // 1. Required fields
  if (!module.id?.kind) errors.push("Missing id.kind");
  if (!module.id?.name) errors.push("Missing id.name");
  if (!module.id?.version) warnings.push("Missing version (recommended)");
  
  // 2. Valid kind
  const validKinds: ModuleKind[] = [
    'geometry', 'material', 'scene', 'lights',
    'camera', 'estimator', 'film', 'developer'
  ];
  if (!validKinds.includes(module.id.kind)) {
    errors.push(`Invalid kind: ${module.id.kind}`);
  }
  
  // 3. Required functions for kind
  const requiredFunctions = this.getRequiredFunctions(module.id.kind);
  const providedFunctions = module.fragment.provides || [];
  
  for (const required of requiredFunctions) {
    if (!providedFunctions.includes(required)) {
      errors.push(`${module.id.kind} must provide '${required}'`);
    }
  }
  
  // 4. Parameter validation
  for (const param of module.parameters || []) {
    if (!param.name || !param.type) {
      errors.push(`Parameter missing name or type`);
    }
    if (param.min !== undefined && param.max !== undefined) {
      if (param.min >= param.max) {
        errors.push(`Parameter ${param.name}: min >= max`);
      }
    }
    if (param.default !== undefined) {
      if (param.min !== undefined && param.default < param.min) {
        errors.push(`Parameter ${param.name}: default < min`);
      }
      if (param.max !== undefined && param.default > param.max) {
        errors.push(`Parameter ${param.name}: default > max`);
      }
    }
  }
  
  // 5. GLSL validation (basic)
  if (module.fragment.functions) {
    const glslErrors = this.validateGLSL(module.fragment.functions);
    errors.push(...glslErrors);
  }
  
  return { 
    valid: errors.length === 0, 
    errors, 
    warnings 
  };
}
```

## Required Functions by Module Kind

```typescript
private getRequiredFunctions(kind: ModuleKind): string[] {
  switch (kind) {
    case 'geometry':
      return ['geodesic', 'dot', 'parallel_transport', 'frame'];
    case 'material':
      return ['evaluate', 'sample', 'pdf'];
    case 'scene':
      return ['intersect', 'intersect_any', 'classify_point'];
    case 'lights':
      return ['sample_light', 'eval_light', 'pdf_light'];
    case 'camera':
      return ['generate_ray'];
    case 'estimator':
      return ['estimate'];
    case 'film':
      return ['accumulate'];
    case 'developer':
      return ['develop'];
    default:
      return [];
  }
}
```

## Registration Contract

```typescript
register(module: ModuleDescriptor): void {
  // 1. Validate
  const validation = this.validateModule(module);
  if (!validation.valid) {
    throw new EngineError(
      `Module validation failed: ${validation.errors.join(', ')}`,
      'ModuleRegistry'
    );
  }
  
  // 2. Check duplicates
  const key = this.getKey(module.id.kind, module.id.name);
  if (this.modules.has(key)) {
    throw new EngineError(
      `Module already registered: ${key}`,
      'ModuleRegistry'
    );
  }
  
  // 3. Store
  this.modules.set(key, module);
  this.registrationOrder.push(key);
  
  // 4. Index
  this.indexModule(module);
  
  console.log(`Registered module: ${key}`);
}

private indexModule(module: ModuleDescriptor): void {
  // By kind
  if (!this.byKind.has(module.id.kind)) {
    this.byKind.set(module.id.kind, new Set());
  }
  this.byKind.get(module.id.kind)!.add(module);
  
  // By provides
  for (const fn of module.fragment.provides || []) {
    if (!this.byProvides.has(fn)) {
      this.byProvides.set(fn, new Set());
    }
    this.byProvides.get(fn)!.add(module);
  }
  
  // By requires
  for (const fn of module.fragment.requires || []) {
    if (!this.byRequires.has(fn)) {
      this.byRequires.set(fn, new Set());
    }
    this.byRequires.get(fn)!.add(module);
  }
}
```

## Dependency Resolution Contract

```typescript
interface DependencyValidation {
  satisfied: boolean;
  missing: Array<{
    module: string;
    requires: string;
    reason: string;
  }>;
  duplicates: Array<{
    function: string;
    providers: string[];
  }>;
  cycles: Array<{
    path: string[];
  }>;
}

validateDependencies(modules: ModuleDescriptor[]): DependencyValidation {
  const result: DependencyValidation = {
    satisfied: true,
    missing: [],
    duplicates: [],
    cycles: []
  };
  
  // Build provides map
  const provides = new Map<string, ModuleDescriptor[]>();
  for (const module of modules) {
    for (const fn of module.fragment.provides || []) {
      if (!provides.has(fn)) {
        provides.set(fn, []);
      }
      provides.get(fn)!.push(module);
    }
  }
  
  // Check all requires satisfied
  for (const module of modules) {
    for (const fn of module.fragment.requires || []) {
      const providers = provides.get(fn) || [];
      
      if (providers.length === 0) {
        result.missing.push({
          module: module.id.name,
          requires: fn,
          reason: 'No module provides this function'
        });
        result.satisfied = false;
      } else if (providers.length > 1) {
        result.duplicates.push({
          function: fn,
          providers: providers.map(m => m.id.name)
        });
      }
    }
  }
  
  // Check for cycles
  const cycles = this.findCycles(modules);
  if (cycles.length > 0) {
    result.cycles = cycles;
    result.satisfied = false;
  }
  
  return result;
}

private findCycles(modules: ModuleDescriptor[]): Array<{ path: string[] }> {
  // Tarjan's algorithm for cycle detection
  // Returns array of dependency cycles
  // Implementation details omitted for brevity
  return [];
}
```

## Recipe Compatibility Contract

```typescript
interface CompatibilityResult {
  compatible: boolean;
  missing: Array<{ kind: ModuleKind; name: string }>;
  issues: string[];
  suggestions: ModuleSuggestion[];
}

interface ModuleSuggestion {
  missing: { kind: ModuleKind; name: string };
  alternatives: ModuleDescriptor[];
  reason: string;
}

checkCompatibility(recipe: Recipe): CompatibilityResult {
  const result: CompatibilityResult = {
    compatible: true,
    missing: [],
    issues: [],
    suggestions: []
  };
  
  // Check all 8 modules exist
  const moduleRefs = [
    recipe.world.geometry,
    recipe.world.material,
    recipe.world.scene,
    recipe.world.lights,
    recipe.photography.camera,
    recipe.photography.estimator,
    recipe.photography.film,
    recipe.photography.developer
  ];
  
  for (const ref of moduleRefs) {
    if (!this.has(ref.kind, ref.name)) {
      result.compatible = false;
      result.missing.push({ kind: ref.kind, name: ref.name });
      
      // Find alternatives
      const alternatives = this.findSimilar(ref.kind, ref.name);
      if (alternatives.length > 0) {
        result.suggestions.push({
          missing: { kind: ref.kind, name: ref.name },
          alternatives,
          reason: `Similar ${ref.kind} modules available`
        });
      }
    }
  }
  
  // If all modules exist, validate dependencies
  if (result.missing.length === 0) {
    const modules = this.resolveModules(recipe);
    const depValidation = this.validateDependencies(Object.values(modules));
    
    if (!depValidation.satisfied) {
      result.compatible = false;
      for (const missing of depValidation.missing) {
        result.issues.push(
          `${missing.module} requires '${missing.requires}': ${missing.reason}`
        );
      }
    }
  }
  
  return result;
}
```

## Module Resolution Contract

```typescript
resolveModules(recipe: Recipe): ModuleCollection {
  const get = (ref: ModuleReference) => {
    const module = this.get(ref.kind, ref.name);
    if (!module) {
      throw new ModuleNotFoundError(ref.kind, ref.name);
    }
    return module;
  };
  
  return {
    geometry: get(recipe.world.geometry),
    material: get(recipe.world.material),  // SINGLE material
    scene: get(recipe.world.scene),
    lights: get(recipe.world.lights),
    camera: get(recipe.photography.camera),
    estimator: get(recipe.photography.estimator),
    film: get(recipe.photography.film),
    developer: get(recipe.photography.developer)
  };
}
```

## Built-in Modules Contract

The registry MUST provide these built-in modules via `registerDefaults()`:

```typescript
registerDefaults(): void {
  const builtIns = [
    // Geometry
    { kind: 'geometry', name: 'euclidean', provides: ['geodesic', 'dot', 'parallel_transport', 'frame'] },
    { kind: 'geometry', name: 'spherical', provides: ['geodesic', 'dot', 'parallel_transport', 'frame'] },
    
    // Materials
    { kind: 'material', name: 'lambert', provides: ['evaluate', 'sample', 'pdf'] },
    { kind: 'material', name: 'disney', provides: ['evaluate', 'sample', 'pdf'] },
    
    // Scenes
    { kind: 'scene', name: 'sdf', provides: ['intersect', 'intersect_any', 'classify_point'] },
    
    // Lights
    { kind: 'lights', name: 'point', provides: ['sample_light', 'eval_light', 'pdf_light'] },
    { kind: 'lights', name: 'hdri', provides: ['sample_light', 'eval_light', 'pdf_light'] },
    
    // Cameras
    { kind: 'camera', name: 'pinhole', provides: ['generate_ray'] },
    { kind: 'camera', name: 'thin_lens', provides: ['generate_ray'] },
    
    // Estimators
    { kind: 'estimator', name: 'pathtracer', provides: ['estimate'] },
    { kind: 'estimator', name: 'debug', provides: ['estimate'] },
    
    // Films
    { kind: 'film', name: 'simple', provides: ['accumulate'] },
    { kind: 'film', name: 'variance', provides: ['accumulate'] },
    
    // Developers
    { kind: 'developer', name: 'reinhard', provides: ['develop'] },
    { kind: 'developer', name: 'aces', provides: ['develop'] }
  ];
  
  for (const spec of builtIns) {
    const module = this.createBuiltInModule(spec);
    this.register(module);
    this.builtInModules.add(this.getKey(spec.kind as ModuleKind, spec.name));
  }
}
```

## Minimal Working Example

```typescript
// Create registry
const registry = new ModuleRegistry();

// Register built-in modules
registry.registerDefaults();

// Register custom module
const customMaterial: ModuleDescriptor = {
  id: { 
    kind: 'material', 
    name: 'custom_brdf', 
    version: '1.0.0' 
  },
  fragment: {
    functions: `
      vec3 evaluate(vec3 wi, vec3 wo, Hit hit) {
        return albedo / PI;
      }
      vec3 sample(vec3 wi, Hit hit, vec2 xi, out float pdf) {
        wo = sample_hemisphere(xi, hit.n);
        pdf = 1.0 / (2.0 * PI);
        return wo;
      }
      float pdf(vec3 wi, vec3 wo, Hit hit) {
        return 1.0 / (2.0 * PI);
      }
    `,
    provides: ['evaluate', 'sample', 'pdf'],
    requires: ['sample_hemisphere']
  },
  parameters: [
    {
      name: 'albedo',
      type: 'vec3',
      default: [0.8, 0.8, 0.8],
      min: 0,
      max: 1
    }
  ]
};

registry.register(customMaterial);

// Check recipe compatibility
const recipe: Recipe = {
  id: 'test',
  name: 'Test Recipe',
  world: {
    geometry: { kind: 'geometry', name: 'euclidean' },
    material: { kind: 'material', name: 'custom_brdf' },
    scene: { kind: 'scene', name: 'sdf' },
    lights: { kind: 'lights', name: 'point' }
  },
  photography: {
    camera: { kind: 'camera', name: 'pinhole' },
    estimator: { kind: 'estimator', name: 'pathtracer' },
    film: { kind: 'film', name: 'simple' },
    developer: { kind: 'developer', name: 'reinhard' }
  }
};

const compatibility = registry.checkCompatibility(recipe);
if (!compatibility.compatible) {
  console.error('Recipe issues:', compatibility.issues);
  console.log('Suggestions:', compatibility.suggestions);
}

// Resolve modules for compilation
const modules = registry.resolveModules(recipe);

// Search for modules
const volumetricEstimators = registry.search({
  kind: 'estimator',
  tags: ['volumetric']
});

// Get all materials
const materials = registry.listByKind('material');
```

## Invariants

1. **No duplicate modules** - same kind:name pair cannot be registered twice
2. **Required functions** - each module kind must provide specific functions
3. **Valid parameters** - min < max, default in range
4. **Dependency satisfaction** - all requires must have provides
5. **No circular dependencies** - dependency graph must be acyclic
6. **Built-ins always available** - after registerDefaults()
7. **Indexes consistent** - all indexes updated on registration/removal

## Error Handling

The registry MUST handle these error conditions:

| Error | Response |
|-------|----------|
| Invalid module structure | Throw with validation errors |
| Duplicate registration | Throw with module info |
| Module not found | Throw ModuleNotFoundError |
| Unsatisfied dependencies | Return in validation result |
| Circular dependencies | Return in validation result |
| Invalid GLSL syntax | Include in validation errors |

## Performance Requirements

- Module lookup by kind:name: O(1)
- Provider lookup by function: O(1)
- Dependency validation: O(n·m) where n=modules, m=avg dependencies
- Recipe compatibility: O(1) for module existence
- Module search: O(n) worst case with early termination
