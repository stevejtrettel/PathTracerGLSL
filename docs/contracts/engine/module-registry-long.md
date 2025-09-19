
# Module Registry Contract

## Purpose

The ModuleRegistry tracks all available modules, validates their contracts, resolves dependencies, and provides modules to the ShaderCompiler. It acts as the single source of truth for what modules exist and whether they can work together.

## Core Interface

```typescript
interface ModuleRegistry {
  // Registration
  register(module: ModuleDescriptor): void;
  registerBatch(modules: ModuleDescriptor[]): void;
  registerDefaults(): void;
  unregister(kind: string, name: string): void;
  
  // Retrieval
  get(kind: string, name: string): ModuleDescriptor | null;
  getAll(kind?: string): ModuleDescriptor[];
  has(kind: string, name: string): boolean;
  
  // Dependency resolution
  findProvider(functionName: string): ModuleDescriptor | null;
  findAllProviders(functionName: string): ModuleDescriptor[];
  validateDependencies(modules: ModuleDescriptor[]): ValidationResult;
  
  // Module discovery
  listKinds(): string[];
  listByKind(kind: string): ModuleDescriptor[];
  search(query: ModuleQuery): ModuleDescriptor[];
  
  // Validation
  validateModule(module: ModuleDescriptor): ValidationResult;
  checkCompatibility(recipe: Recipe): CompatibilityResult;
  
  // Recipe resolution
  resolveModules(recipe: Recipe): ModuleCollection;
}
```

## Module Storage

```typescript
class ModuleRegistry {
  // Primary storage: kind:name → module
  private modules: Map<string, ModuleDescriptor> = new Map();
  
  // Indexes for fast lookup
  private byKind: Map<string, Set<ModuleDescriptor>> = new Map();
  private byProvides: Map<string, Set<ModuleDescriptor>> = new Map();
  private byRequires: Map<string, Set<ModuleDescriptor>> = new Map();
  
  // Metadata
  private registrationOrder: string[] = [];
  private registrationTime: Map<string, number> = new Map();
  
  private getKey(kind: string, name: string): string {
    return `${kind}:${name}`;
  }
}
```

## Module Registration

```typescript
class ModuleRegistry {
  register(module: ModuleDescriptor): void {
    // 1. Validate module structure
    const validation = this.validateModule(module);
    if (!validation.valid) {
      throw new RegistrationError(module, validation.errors);
    }
    
    // 2. Check for duplicates
    const key = this.getKey(module.id.kind, module.id.name);
    if (this.modules.has(key)) {
      throw new DuplicateModuleError(module);
    }
    
    // 3. Store module
    this.modules.set(key, module);
    this.registrationOrder.push(key);
    this.registrationTime.set(key, Date.now());
    
    // 4. Update indexes
    this.indexModule(module);
    
    console.log(`Registered module: ${key}`);
  }
  
  private indexModule(module: ModuleDescriptor): void {
    // Index by kind
    if (!this.byKind.has(module.id.kind)) {
      this.byKind.set(module.id.kind, new Set());
    }
    this.byKind.get(module.id.kind)!.add(module);
    
    // Index by provides
    for (const func of module.provides || []) {
      if (!this.byProvides.has(func)) {
        this.byProvides.set(func, new Set());
      }
      this.byProvides.get(func)!.add(module);
    }
    
    // Index by requires
    for (const func of module.requires || []) {
      if (!this.byRequires.has(func)) {
        this.byRequires.set(func, new Set());
      }
      this.byRequires.get(func)!.add(module);
    }
  }
}
```

## Module Validation

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

class ModuleRegistry {
  validateModule(module: ModuleDescriptor): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Required fields
    if (!module.id?.kind) {
      errors.push("Module must have id.kind");
    }
    if (!module.id?.name) {
      errors.push("Module must have id.name");
    }
    if (!module.id?.version) {
      warnings.push("Module should have version");
    }
    
    // Valid kind
    const validKinds = [
      "geometry", "material", "scene", "lights",
      "camera", "estimator", "film", "developer"
    ];
    if (!validKinds.includes(module.id.kind)) {
      errors.push(`Invalid module kind: ${module.id.kind}`);
    }
    
    // Check required functions based on kind
    const requiredFunctions = this.getRequiredFunctions(module.id.kind);
    const providedFunctions = module.provides || [];
    
    for (const required of requiredFunctions) {
      if (!providedFunctions.includes(required)) {
        errors.push(
          `${module.id.kind} module must provide '${required}' function`
        );
      }
    }
    
    // Validate parameters
    for (const param of module.parameters || []) {
      if (!param.name || !param.type) {
        errors.push(`Parameter missing name or type`);
      }
      
      // Check range validity
      if (param.min !== undefined && param.max !== undefined) {
        if (param.min >= param.max) {
          errors.push(`Parameter ${param.name}: min >= max`);
        }
      }
      
      // Check default in range
      if (typeof param.default === 'number') {
        if (param.min !== undefined && param.default < param.min) {
          errors.push(`Parameter ${param.name}: default < min`);
        }
        if (param.max !== undefined && param.default > param.max) {
          errors.push(`Parameter ${param.name}: default > max`);
        }
      }
    }
    
    // Basic GLSL validation
    if (module.fragment?.functions) {
      const glslErrors = this.validateGLSL(module.fragment.functions);
      errors.push(...glslErrors);
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }
  
  private getRequiredFunctions(kind: string): string[] {
    switch (kind) {
      case "geometry":
        return ["geodesic", "dot", "parallel_transport", "frame"];
      case "material":
        return ["evaluate", "sample", "pdf"];
      case "scene":
        return ["intersect", "intersect_any", "classify_point"];
      case "lights":
        return ["sample_light", "eval_light", "pdf_light"];
      case "camera":
        return ["generate_ray"];
      case "estimator":
        return ["estimate"];
      case "film":
        return ["accumulate"];
      case "developer":
        return ["develop"];
      default:
        return [];
    }
  }
  
  private validateGLSL(source: string): string[] {
    const errors: string[] = [];
    
    // Check for basic syntax issues
    const openBraces = (source.match(/{/g) || []).length;
    const closeBraces = (source.match(/}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push(`Mismatched braces: ${openBraces} open, ${closeBraces} close`);
    }
    
    // Check for unterminated strings
    const unterminated = source.match(/"[^"]*$/gm);
    if (unterminated) {
      errors.push("Unterminated string literal found");
    }
    
    return errors;
  }
}
```

## Dependency Resolution

```typescript
interface DependencyGraph {
  nodes: Map<string, ModuleDescriptor>;
  edges: Map<string, Set<string>>;      // module → dependencies
  reverse: Map<string, Set<string>>;    // module → dependents
}

class ModuleRegistry {
  validateDependencies(modules: ModuleDescriptor[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Build provides map
    const provides = new Map<string, ModuleDescriptor[]>();
    for (const module of modules) {
      for (const func of module.provides || []) {
        if (!provides.has(func)) {
          provides.set(func, []);
        }
        provides.get(func)!.push(module);
      }
    }
    
    // Check all requires are satisfied
    for (const module of modules) {
      for (const required of module.requires || []) {
        const providers = provides.get(required) || [];
        
        if (providers.length === 0) {
          errors.push(
            `Module ${module.id.name} requires '${required}' ` +
            `but no module provides it`
          );
        } else if (providers.length > 1) {
          warnings.push(
            `Function '${required}' provided by multiple modules: ` +
            providers.map(m => m.id.name).join(', ')
          );
        }
      }
    }
    
    // Check for circular dependencies
    const cycles = this.findCycles(modules);
    for (const cycle of cycles) {
      errors.push(`Circular dependency: ${cycle.join(' → ')}`);
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }
  
  private findCycles(modules: ModuleDescriptor[]): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const visit = (module: ModuleDescriptor, path: string[]): void => {
      const key = this.getKey(module.id.kind, module.id.name);
      
      if (recursionStack.has(key)) {
        // Found cycle
        const cycleStart = path.indexOf(key);
        cycles.push(path.slice(cycleStart));
        return;
      }
      
      if (visited.has(key)) return;
      
      visited.add(key);
      recursionStack.add(key);
      path.push(key);
      
      // Visit dependencies
      for (const required of module.requires || []) {
        const provider = this.findProviderInSet(required, modules);
        if (provider) {
          visit(provider, [...path]);
        }
      }
      
      recursionStack.delete(key);
    };
    
    for (const module of modules) {
      visit(module, []);
    }
    
    return cycles;
  }
  
  private findProviderInSet(
    functionName: string,
    modules: ModuleDescriptor[]
  ): ModuleDescriptor | null {
    for (const module of modules) {
      if (module.provides?.includes(functionName)) {
        return module;
      }
    }
    return null;
  }
}
```

## Recipe Compatibility

```typescript
interface CompatibilityResult {
  compatible: boolean;
  missing: Array<{ kind: string; name: string }>;
  issues: string[];
  suggestions: ModuleSuggestion[];
}

interface ModuleSuggestion {
  missing: { kind: string; name: string };
  alternatives: ModuleDescriptor[];
  reason: string;
}

class ModuleRegistry {
  checkCompatibility(recipe: Recipe): CompatibilityResult {
    const missing: Array<{ kind: string; name: string }> = [];
    const issues: string[] = [];
    const suggestions: ModuleSuggestion[] = [];
    
    // Check all modules exist
    const moduleRefs = [
      recipe.world.geometry,
      recipe.world.material,  // Single material
      recipe.world.scene,
      recipe.world.lights,
      recipe.photography.camera,
      recipe.photography.estimator,
      recipe.photography.film,
      recipe.photography.developer
    ];
    
    for (const ref of moduleRefs) {
      if (!this.has(ref.kind, ref.name)) {
        missing.push({ kind: ref.kind, name: ref.name });
        
        // Find alternatives
        const alternatives = this.findSimilar(ref.kind, ref.name);
        if (alternatives.length > 0) {
          suggestions.push({
            missing: { kind: ref.kind, name: ref.name },
            alternatives,
            reason: `Similar ${ref.kind} modules available`
          });
        }
      }
    }
    
    // Check dependencies can be satisfied
    const modules = moduleRefs
      .filter(ref => this.has(ref.kind, ref.name))
      .map(ref => this.get(ref.kind, ref.name)!);
    
    const depResult = this.validateDependencies(modules);
    if (!depResult.valid) {
      issues.push(...depResult.errors);
    }
    
    return {
      compatible: missing.length === 0 && issues.length === 0,
      missing,
      issues,
      suggestions
    };
  }
  
  private findSimilar(kind: string, name: string): ModuleDescriptor[] {
    const allOfKind = this.listByKind(kind);
    
    // Simple similarity: contains substring
    const pattern = name.toLowerCase();
    return allOfKind.filter(m => {
      const mName = m.id.name.toLowerCase();
      return mName.includes(pattern) || pattern.includes(mName);
    });
  }
}
```

## Module Resolution

```typescript
interface ModuleCollection {
  geometry: ModuleDescriptor;
  material: ModuleDescriptor;  // SINGLE material
  scene: ModuleDescriptor;
  lights: ModuleDescriptor;
  camera: ModuleDescriptor;
  estimator: ModuleDescriptor;
  film: ModuleDescriptor;
  developer: ModuleDescriptor;
}

class ModuleRegistry {
  resolveModules(recipe: Recipe): ModuleCollection {
    const resolved = {} as ModuleCollection;
    
    // Resolve each module
    resolved.geometry = this.getRequired(
      recipe.world.geometry.kind,
      recipe.world.geometry.name
    );
    
    // Single material module
    resolved.material = this.getRequired(
      recipe.world.material.kind,
      recipe.world.material.name
    );
    
    resolved.scene = this.getRequired(
      recipe.world.scene.kind,
      recipe.world.scene.name
    );
    
    resolved.lights = this.getRequired(
      recipe.world.lights.kind,
      recipe.world.lights.name
    );
    
    resolved.camera = this.getRequired(
      recipe.photography.camera.kind,
      recipe.photography.camera.name
    );
    
    resolved.estimator = this.getRequired(
      recipe.photography.estimator.kind,
      recipe.photography.estimator.name
    );
    
    resolved.film = this.getRequired(
      recipe.photography.film.kind,
      recipe.photography.film.name
    );
    
    resolved.developer = this.getRequired(
      recipe.photography.developer.kind,
      recipe.photography.developer.name
    );
    
    // Validate all dependencies satisfied
    const modules = Object.values(resolved);
    const validation = this.validateDependencies(modules);
    
    if (!validation.valid) {
      throw new Error(
        `Recipe has unsatisfied dependencies:\n${validation.errors.join('\n')}`
      );
    }
    
    return resolved;
  }
  
  private getRequired(kind: string, name: string): ModuleDescriptor {
    const module = this.get(kind, name);
    if (!module) {
      throw new ModuleNotFoundError(kind, name);
    }
    return module;
  }
}
```

## Module Search

```typescript
interface ModuleQuery {
  kind?: string;
  name?: string;                      // Partial match
  provides?: string[];                // Must provide all
  requires?: string[];                // Must require all
  tags?: string[];
}

class ModuleRegistry {
  search(query: ModuleQuery): ModuleDescriptor[] {
    let results = Array.from(this.modules.values());
    
    // Filter by kind
    if (query.kind) {
      results = results.filter(m => m.id.kind === query.kind);
    }
    
    // Filter by name (partial match)
    if (query.name) {
      const pattern = query.name.toLowerCase();
      results = results.filter(m => 
        m.id.name.toLowerCase().includes(pattern)
      );
    }
    
    // Filter by provides
    if (query.provides) {
      results = results.filter(m => {
        const provides = new Set(m.provides || []);
        return query.provides!.every(f => provides.has(f));
      });
    }
    
    // Filter by requires
    if (query.requires) {
      results = results.filter(m => {
        const requires = new Set(m.requires || []);
        return query.requires!.every(f => requires.has(f));
      });
    }
    
    // Filter by tags
    if (query.tags) {
      results = results.filter(m => {
        const tags = new Set(m.metadata?.tags || []);
        return query.tags!.every(t => tags.has(t));
      });
    }
    
    return results;
  }
}
```

## Built-in Modules

```typescript
class ModuleRegistry {
  registerDefaults(): void {
    console.log('Registering built-in modules...');
    
    // Core geometry
    this.register(EuclideanGeometry);
    this.register(SphericalGeometry);
    
    // Basic materials
    this.register(LambertMaterial);
    this.register(DisneyMaterial);
    
    // Standard cameras
    this.register(PinholeCamera);
    this.register(ThinLensCamera);
    
    // Essential estimators
    this.register(PathTracerEstimator);
    this.register(VolumetricPTEstimator);
    this.register(DebugEstimator);
    
    // Films
    this.register(SimpleFilm);
    this.register(VarianceFilm);
    
    // Developers
    this.register(ReinhardDeveloper);
    this.register(ACESDeveloper);
    
    // Scenes
    this.register(SDFScene);
    
    // Lights
    this.register(PointLight);
    this.register(HDRILight);
    
    console.log(`Registered ${this.modules.size} built-in modules`);
  }
}
```

## Error Types

```typescript
class RegistrationError extends Error {
  constructor(
    public module: ModuleDescriptor,
    public validationErrors: string[]
  ) {
    super(`Failed to register module ${module.id.name}: ${validationErrors.join(', ')}`);
  }
}

class DuplicateModuleError extends Error {
  constructor(public module: ModuleDescriptor) {
    super(`Module ${module.id.kind}:${module.id.name} already registered`);
  }
}

class ModuleNotFoundError extends Error {
  constructor(public kind: string, public name: string) {
    super(`Module ${kind}:${name} not found in registry`);
  }
}
```

## Performance Considerations

- **O(1) lookups** by kind:name key
- **Indexed access** for provides/requires queries
- **Cached dependency graphs** for repeated validation
- **Lazy cycle detection** only when needed
- **Pre-indexed** built-in modules at startup

## Usage Example

```typescript
const registry = new ModuleRegistry();

// Register built-ins
registry.registerDefaults();

// Register custom module
registry.register({
  id: { kind: 'material', name: 'custom_brdf', version: '1.0.0' },
  provides: ['evaluate', 'sample', 'pdf'],
  requires: [],
  fragment: { functions: '...' },
  parameters: [
    { name: 'albedo', type: 'vec3', default: [0.8, 0.8, 0.8] }
  ]
});

// Check recipe compatibility
const compatibility = registry.checkCompatibility(recipe);
if (!compatibility.compatible) {
  console.error('Recipe issues:', compatibility.issues);
  console.log('Suggestions:', compatibility.suggestions);
}

// Resolve modules for compilation
const modules = registry.resolveModules(recipe);

// Search for specific modules
const volumetricEstimators = registry.search({
  kind: 'estimator',
  provides: ['estimate'],
  tags: ['volumetric']
});
```

---
