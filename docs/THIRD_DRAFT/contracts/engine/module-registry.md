# Module Registry Contract (Simplified)

## Purpose

The ModuleRegistry stores all available modules, validates they implement required functions with correct KIND prefixing, and provides modules to the SimpleCompiler. It acts as the module database and enforces the KIND prefixing convention.

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
  
  // Index by kind for fast filtering
  private byKind: Map<ModuleKind, Set<ModuleDescriptor>>;
  
  // Metadata
  private registrationOrder: string[];
  private builtInModules: Set<string>;
  
  private getKey(kind: ModuleKind, name: string): string {
    return `${kind}:${name}`;
  }
}
```

## Module Validation Contract

Each module MUST provide specific functions with KIND-based prefixing:

```typescript
validateModule(module: ModuleDescriptor): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const context: string[] = [];
  
  // 1. Required fields
  if (!module.id?.kind) errors.push("Missing id.kind");
  if (!module.id?.name) errors.push("Missing id.name");
  if (!module.id?.version) warnings.push("Missing version (recommended)");
  
  // 2. Valid kind
  const validKinds: ModuleKind[] = [
    'geometry', 'scene', 'lighting',
    'camera', 'transport', 'interaction', 'film', 'developer'
  ];
  if (!validKinds.includes(module.id.kind)) {
    errors.push(`Invalid kind: ${module.id.kind}`);
  }
  
  // 3. Required functions with KIND PREFIXING
  const requiredFunctions = this.getRequiredFunctions(module.id.kind);
  if (requiredFunctions.length > 0) {
    const source = module.fragment.functions;
    const kindPrefix = `${module.id.kind}_`;  // PREFIX IS MODULE KIND
    
    for (const funcName of requiredFunctions) {
      // Enforce exact pattern: kind_functionName
      const expectedFunction = `${kindPrefix}${funcName}`;
      const pattern = new RegExp(`\\b${expectedFunction}\\s*\\(`);
      
      if (!pattern.test(source)) {
        errors.push(
          `Module '${module.id.name}' (${module.id.kind}) missing required function: ${expectedFunction}()`
        );
        
        // Try to find incorrectly prefixed version for helpful error
        const wrongPattern = new RegExp(`\\b${module.id.name}_${funcName}\\s*\\(`);
        if (wrongPattern.test(source)) {
          context.push(
            `Found '${module.id.name}_${funcName}' with wrong prefix. ` +
            `All functions must use KIND prefix: ${expectedFunction}`
          );
        }
        
        // Check for unprefixed version
        const unprefixedPattern = new RegExp(`\\b${funcName}\\s*\\(`);
        if (unprefixedPattern.test(source)) {
          context.push(
            `Found '${funcName}' without prefix. ` +
            `All functions must be KIND-prefixed: ${expectedFunction}`
          );
        }
      }
    }
  }
  
  // 4. Check for module-name prefixed versions (warning)
  const requiredFuncs = this.getRequiredFunctions(module.id.kind);
  for (const func of requiredFuncs) {
    const wrongPrefix = new RegExp(`\\b${module.id.name}_${func}\\s*\\(`);
    const correctPrefix = new RegExp(`\\b${module.id.kind}_${func}\\s*\\(`);
    
    if (wrongPrefix.test(module.fragment.functions) && 
        !correctPrefix.test(module.fragment.functions)) {
      errors.push(
        `Found '${module.id.name}_${func}' but need '${module.id.kind}_${func}'. ` +
        `Use KIND prefix, not module name.`
      );
    }
  }
  
  // 5. Parameter validation
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
        warnings.push(`Parameter ${param.name}: default < min`);
      }
      if (param.max !== undefined && param.default > param.max) {
        warnings.push(`Parameter ${param.name}: default > max`);
      }
    }
  }
  
  return { 
    valid: errors.length === 0, 
    errors, 
    warnings,
    context: context.length > 0 ? context.join('\n') : undefined
  };
}
```

## Required Functions by Module Kind

These are the BASE function names that MUST be prefixed with the module KIND:

```typescript
private getRequiredFunctions(kind: ModuleKind): string[] {
  // Returns base function names that must exist with KIND prefix
  // Example: 'generateRay' must become 'camera_generateRay'
  
  switch (kind) {
    case 'geometry':
      return ['geodesic', 'dot', 'parallel_transport', 'frame'];
      
    case 'scene':
      return ['intersect', 'intersect_any', 'material_properties', 'material_at'];
      
    case 'lighting':
      return ['sample', 'pdf', 'get_light', 'can_sample'];
      
    case 'camera':
      return ['generateRay'];  // Must be prefixed: camera_generateRay
      
    case 'transport':
      return ['trace'];        // Must be prefixed: transport_trace
      
    case 'interaction':
      return ['surface_shade', 'surface_scatter', 'surface_pdf'];
      
    case 'film':
      return ['accumulate'];   // Must be prefixed: film_accumulate
      
    case 'developer':
      return ['develop'];      // Must be prefixed: developer_develop
      
    default:
      return [];
  }
}
```

## Registration Contract

```typescript
register(module: ModuleDescriptor): void {
  // 1. Validate with KIND prefixing enforcement
  const validation = this.validateModule(module);
  if (!validation.valid) {
    const errorMsg = validation.errors.join('\n');
    const contextMsg = validation.context ? `\n${validation.context}` : '';
    throw new EngineError(
      `Module validation failed:\n${errorMsg}${contextMsg}`,
      'ModuleRegistry'
    );
  }
  
  // Log warnings
  if (validation.warnings && validation.warnings.length > 0) {
    console.warn(`Module ${module.id.name} warnings:`, validation.warnings);
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
  
  // 4. Index by kind
  if (!this.byKind.has(module.id.kind)) {
    this.byKind.set(module.id.kind, new Set());
  }
  this.byKind.get(module.id.kind)!.add(module);
  
  console.log(`Registered module: ${key} (functions use '${module.id.kind}_' prefix)`);
}

registerBatch(modules: ModuleDescriptor[]): void {
  for (const module of modules) {
    this.register(module);
  }
}

unregister(kind: ModuleKind, name: string): boolean {
  const key = this.getKey(kind, name);
  const module = this.modules.get(key);
  
  if (!module) return false;
  
  // Remove from storage
  this.modules.delete(key);
  
  // Remove from kind index
  this.byKind.get(kind)?.delete(module);
  
  // Remove from registration order
  const index = this.registrationOrder.indexOf(key);
  if (index >= 0) {
    this.registrationOrder.splice(index, 1);
  }
  
  return true;
}
```

## Recipe Compatibility Contract

```typescript
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
    recipe.world.scene,
    recipe.world.lighting,
    recipe.photography.camera,
    recipe.photography.transport,
    recipe.photography.interaction,
    recipe.photography.film,
    recipe.photography.developer
  ];
  
  for (const ref of moduleRefs) {
    if (!this.has(ref.kind, ref.name)) {
      result.compatible = false;
      result.missing.push({ kind: ref.kind, name: ref.name });
      
      // Find alternatives of same kind
      const alternatives = this.listByKind(ref.kind);
      if (alternatives.length > 0) {
        result.suggestions?.push({
          missing: { kind: ref.kind, name: ref.name },
          alternatives,
          reason: `Available ${ref.kind} modules: ${alternatives.map(m => m.id.name).join(', ')}`
        });
      }
    }
  }
  
  // Note about KIND prefixing
  if (result.compatible) {
    console.log('Recipe compatible. Module function prefixes:');
    for (const ref of moduleRefs) {
      console.log(`  ${ref.kind}: ${ref.kind}_*`);
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
  
  const collection = {
    geometry: get(recipe.world.geometry),
    scene: get(recipe.world.scene),
    lighting: get(recipe.world.lighting),
    camera: get(recipe.photography.camera),
    transport: get(recipe.photography.transport),
    interaction: get(recipe.photography.interaction),
    film: get(recipe.photography.film),
    developer: get(recipe.photography.developer)
  };
  
  // Log the expected function prefixes for debugging
  console.log('Module collection resolved with KIND prefixes:');
  for (const [kind, module] of Object.entries(collection)) {
    console.log(`  ${kind}: ${kind}_* (implementation: ${module.id.name})`);
  }
  
  return collection;
}
```

## Retrieval Methods

```typescript
get(kind: ModuleKind, name: string): ModuleDescriptor | null {
  const key = this.getKey(kind, name);
  return this.modules.get(key) || null;
}

getAll(kind?: ModuleKind): ModuleDescriptor[] {
  if (!kind) {
    return Array.from(this.modules.values());
  }
  return Array.from(this.byKind.get(kind) || []);
}

has(kind: ModuleKind, name: string): boolean {
  const key = this.getKey(kind, name);
  return this.modules.has(key);
}

listKinds(): ModuleKind[] {
  return Array.from(this.byKind.keys());
}

listByKind(kind: ModuleKind): ModuleDescriptor[] {
  return Array.from(this.byKind.get(kind) || []);
}
```

## Search Contract

```typescript
search(query: ModuleQuery): ModuleDescriptor[] {
  let results = Array.from(this.modules.values());
  
  // Filter by kind
  if (query.kind) {
    results = results.filter(m => m.id.kind === query.kind);
  }
  
  // Filter by name (partial match)
  if (query.name) {
    const nameLower = query.name.toLowerCase();
    results = results.filter(m => 
      m.id.name.toLowerCase().includes(nameLower)
    );
  }
  
  // Filter by tags
  if (query.tags && query.tags.length > 0) {
    results = results.filter(m => {
      const moduleTags = m.metadata?.tags || [];
      return query.tags!.every(tag => moduleTags.includes(tag));
    });
  }
  
  return results;
}
```

## Built-in Modules Contract

```typescript
registerDefaults(): void {
  const builtIns = [
    // Geometry
    { kind: 'geometry', name: 'euclidean' },
    { kind: 'geometry', name: 'spherical' },
    
    // Scene (compiled by WorldCompiler usually)
    { kind: 'scene', name: 'sdf' },
    
    // Lighting (compiled by WorldCompiler usually)
    { kind: 'lighting', name: 'point' },
    { kind: 'lighting', name: 'hdri' },
    
    // Cameras
    { kind: 'camera', name: 'pinhole' },
    { kind: 'camera', name: 'thin_lens' },
    
    // Transport
    { kind: 'transport', name: 'pathtracer' },
    { kind: 'transport', name: 'debug' },
    
    // Interaction
    { kind: 'interaction', name: 'lambert' },
    { kind: 'interaction', name: 'disney' },
    
    // Films
    { kind: 'film', name: 'simple' },
    { kind: 'film', name: 'variance' },
    
    // Developers
    { kind: 'developer', name: 'reinhard' },
    { kind: 'developer', name: 'aces' }
  ];
  
  for (const spec of builtIns) {
    const module = this.createBuiltInModule(spec);
    this.register(module);
    this.builtInModules.add(this.getKey(spec.kind as ModuleKind, spec.name));
  }
  
  console.log(`Registered ${builtIns.length} built-in modules with KIND prefixing`);
}

private createBuiltInModule(spec: any): ModuleDescriptor {
  // Create stub module with PROPERLY KIND-PREFIXED functions
  const kindPrefix = `${spec.kind}_`;  // KIND is the prefix
  const functions = this.getRequiredFunctions(spec.kind).map(fn => {
    // Generate properly KIND-prefixed function
    return `vec3 ${kindPrefix}${fn}() { return vec3(0.0); }`;
  }).join('\n');
  
  return {
    id: {
      kind: spec.kind,
      name: spec.name,
      version: '1.0.0'
    },
    fragment: {
      functions,
      uniforms: `// Uniforms for ${spec.name}`
    },
    metadata: {
      author: 'Built-in',
      description: `Built-in ${spec.kind} module: ${spec.name}`
    }
  };
}
```

## Cleanup Contract

```typescript
clear(): void {
  this.modules.clear();
  this.byKind.clear();
  this.registrationOrder = [];
  this.builtInModules.clear();
}

dispose(): void {
  this.clear();
}
```

## Minimal Working Example

```typescript
// Create registry
const registry = new ModuleRegistry();

// Register built-in modules (all with KIND prefixing)
registry.registerDefaults();

// Register custom module WITH KIND PREFIXING
const customInteraction: ModuleDescriptor = {
  id: { 
    kind: 'interaction', 
    name: 'custom_brdf',  // This is the implementation name
    version: '1.0.0' 
  },
  fragment: {
    functions: `
      uniform vec3 u_interaction_albedo;
      uniform float u_interaction_roughness;
      
      // CORRECT: All functions use KIND prefix
      Spectrum interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) {
        MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
        return Spectrum(props.albedo / PI);
      }
      
      vec3 interaction_surface_scatter(vec3 wi, Hit hit, vec2 xi, out float pdf) {
        vec3 wo = sample_hemisphere(xi, hit.n);
        pdf = 1.0 / (2.0 * PI);
        return wo;
      }
      
      float interaction_surface_pdf(vec3 wi, vec3 wo, Hit hit) {
        return 1.0 / (2.0 * PI);
      }
      
      // Helper functions don't need prefix (internal use only)
      vec3 sample_hemisphere(vec2 xi, vec3 n) {
        // Implementation
      }
    `
  },
  parameters: [
    {
      name: 'albedo',
      type: 'vec3',
      default: [0.8, 0.8, 0.8],
      min: 0,
      max: 1
    },
    {
      name: 'roughness',
      type: 'float',
      default: 0.5,
      min: 0,
      max: 1
    }
  ]
};

// Register validates KIND prefixing
try {
  registry.register(customInteraction);
  console.log('Module registered with functions: interaction_*');
} catch (e) {
  console.error('Validation failed - check function prefixing');
}

// Check recipe compatibility
const recipe: Recipe = {
  id: 'test',
  name: 'Test Recipe',
  world: {
    geometry: { kind: 'geometry', name: 'euclidean' },     
    scene: { kind: 'scene', name: 'sdf' },                 
    lighting: { kind: 'lighting', name: 'point' }         
  },
  photography: {
    camera: { kind: 'camera', name: 'pinhole' },           
    transport: { kind: 'transport', name: 'pathtracer' },  
    interaction: { kind: 'interaction', name: 'custom_brdf' }, 
    film: { kind: 'film', name: 'simple' },                
    developer: { kind: 'developer', name: 'reinhard' }     
  }
};

const compatibility = registry.checkCompatibility(recipe);
if (!compatibility.compatible) {
  console.error('Recipe issues:', compatibility.issues);
  console.log('Suggestions:', compatibility.suggestions);
} else {
  console.log('Recipe compatible!');
  console.log('Functions will be called with KIND prefixes:');
  console.log('  Camera: camera_generateRay()');
  console.log('  Transport: transport_trace()');
  console.log('  Interaction: interaction_surface_shade(), interaction_surface_scatter()');
  console.log('  Scene: scene_intersect(), scene_material_properties()');
  // etc.
}

// Resolve modules for compilation
const modules = registry.resolveModules(recipe);

// Search for specific modules
const interactions = registry.search({
  kind: 'interaction'
});

// Get all transport modules
const transports = registry.listByKind('transport');
console.log(`Available transport modules: ${transports.map(m => m.id.name).join(', ')}`);
console.log('All use prefix: transport_* for functions');

// Cleanup
registry.dispose();
```

## Example: Module Registration Failure

```typescript
// This module will FAIL validation
const badInteraction: ModuleDescriptor = {
  id: { 
    kind: 'interaction', 
    name: 'bad_brdf',
    version: '1.0.0' 
  },
  fragment: {
    functions: `
      // WRONG: Functions using module name instead of KIND
      vec3 bad_brdf_surface_shade(vec3 wi, vec3 wo, Hit hit) {
        return vec3(1.0);
      }
      
      // WRONG: Unprefixed function
      vec3 surface_scatter(vec3 wi, Hit hit, vec2 xi, out float pdf) {
        pdf = 1.0;
        return vec3(0.0);
      }
      
      // MISSING: No surface_pdf function at all
    `
  }
};

try {
  registry.register(badInteraction);
} catch (e) {
  console.error(e);
  // Error output:
  // Module validation failed:
  // Module 'bad_brdf' (interaction) missing required function: interaction_surface_shade()
  // Module 'bad_brdf' (interaction) missing required function: interaction_surface_scatter()
  // Module 'bad_brdf' (interaction) missing required function: interaction_surface_pdf()
  // Found 'bad_brdf_surface_shade' with wrong prefix. All functions must use KIND prefix: interaction_surface_shade
  // Found 'surface_scatter' without prefix. All functions must be KIND-prefixed: interaction_surface_scatter
}
```

## Invariants

1. **No duplicate modules** - same kind:name pair cannot be registered twice
2. **Required functions validated WITH KIND PREFIX** - each module must provide KIND-prefixed functions
3. **Prefix is module KIND** - not module name, always kind_functionName
4. **Parameter validation** - min < max, default in range
5. **Built-ins use KIND prefixing** - even built-in modules follow the convention
6. **No automatic transformation** - modules must be correctly prefixed

## Error Handling

| Error | Response |
|-------|----------|
| Invalid module structure | Throw with validation errors |
| Wrong function prefix | Include in validation errors with context |
| Duplicate registration | Throw with module info |
| Module not found | Throw ModuleNotFoundError |
| Unprefixed functions found | Provide helpful context about KIND prefixing |
| Invalid parameter ranges | Include in validation warnings |

## Performance Requirements

- Module lookup by kind:name: O(1)
- List by kind: O(1)
- Recipe compatibility: O(8) - just check 8 modules exist
- Module search: O(n) with early termination
- Registration: O(1) amortized
- Prefix validation: O(f) where f = number of required functions
