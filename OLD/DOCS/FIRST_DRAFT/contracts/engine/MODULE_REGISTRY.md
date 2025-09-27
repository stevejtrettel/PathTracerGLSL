# Module Registry Contract

The ModuleRegistry tracks available modules, validates their contracts, and resolves dependencies.

## Core Interface

```typescript
interface ModuleRegistry {
  // Registration
  register(module: ModuleDescriptor): void;
  registerBatch(modules: ModuleDescriptor[]): void;
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
}
```

## Module Storage

```typescript
interface RegistryStorage {
  // Primary storage: kind:name → module
  modules: Map<string, ModuleDescriptor>;
  
  // Indexes for fast lookup
  byKind: Map<string, Set<ModuleDescriptor>>;
  byProvides: Map<string, Set<ModuleDescriptor>>;
  byRequires: Map<string, Set<ModuleDescriptor>>;
  
  // Metadata
  registrationOrder: string[];
  registrationTime: Map<string, number>;
}

class ModuleRegistry {
  private storage: RegistryStorage = {
    modules: new Map(),
    byKind: new Map(),
    byProvides: new Map(),
    byRequires: new Map(),
    registrationOrder: [],
    registrationTime: new Map()
  };
  
  register(module: ModuleDescriptor) {
    // Validate first
    const validation = this.validateModule(module);
    if (!validation.valid) {
      throw new RegistrationError(module, validation.errors);
    }
    
    // Generate key
    const key = this.getKey(module.id.kind, module.id.name);
    
    // Check for duplicates
    if (this.storage.modules.has(key)) {
      throw new DuplicateModuleError(module);
    }
    
    // Store module
    this.storage.modules.set(key, module);
    this.storage.registrationOrder.push(key);
    this.storage.registrationTime.set(key, Date.now());
    
    // Update indexes
    this.indexModule(module);
  }
  
  private getKey(kind: string, name: string): string {
    return `${kind}:${name}`;
  }
}
```

## Indexing System

```typescript
interface ModuleIndexes {
  indexModule(module: ModuleDescriptor): void;
  deindexModule(module: ModuleDescriptor): void;
  rebuildIndexes(): void;
}

class ModuleRegistry {
  private indexModule(module: ModuleDescriptor) {
    // Index by kind
    if (!this.storage.byKind.has(module.id.kind)) {
      this.storage.byKind.set(module.id.kind, new Set());
    }
    this.storage.byKind.get(module.id.kind)!.add(module);
    
    // Index by provides
    for (const func of module.fragment.provides || []) {
      if (!this.storage.byProvides.has(func)) {
        this.storage.byProvides.set(func, new Set());
      }
      this.storage.byProvides.get(func)!.add(module);
    }
    
    // Index by requires
    for (const func of module.fragment.requires || []) {
      if (!this.storage.byRequires.has(func)) {
        this.storage.byRequires.set(func, new Set());
      }
      this.storage.byRequires.get(func)!.add(module);
    }
  }
}
```

## Dependency Resolution

```typescript
interface DependencyResolver {
  resolve(modules: ModuleDescriptor[]): DependencyGraph;
  findCycles(graph: DependencyGraph): Cycle[];
  topologicalSort(graph: DependencyGraph): ModuleDescriptor[];
}

interface DependencyGraph {
  nodes: Map<string, ModuleDescriptor>;
  edges: Map<string, Set<string>>;       // module → dependencies
  reverse: Map<string, Set<string>>;     // module → dependents
}

interface Cycle {
  modules: string[];
  functions: string[];                   // Which functions create cycle
}

class ModuleRegistry {
  validateDependencies(modules: ModuleDescriptor[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Check all requires are satisfied
    for (const module of modules) {
      for (const required of module.fragment.requires || []) {
        const provider = this.findProviderInSet(required, modules);
        
        if (!provider) {
          errors.push(
            `Module ${module.id.name} requires '${required}' ` +
            `but no module provides it`
          );
        }
      }
    }
    
    // Check for cycles
    const graph = this.buildDependencyGraph(modules);
    const cycles = this.findCycles(graph);
    
    for (const cycle of cycles) {
      errors.push(
        `Circular dependency detected: ${cycle.modules.join(' → ')}`
      );
    }
    
    // Check for duplicate provides
    const provides = new Map<string, ModuleDescriptor[]>();
    for (const module of modules) {
      for (const func of module.fragment.provides || []) {
        if (!provides.has(func)) {
          provides.set(func, []);
        }
        provides.get(func)!.push(module);
      }
    }
    
    for (const [func, providers] of provides) {
      if (providers.length > 1) {
        warnings.push(
          `Function '${func}' provided by multiple modules: ` +
          providers.map(m => m.id.name).join(', ')
        );
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  private findProviderInSet(
    functionName: string,
    modules: ModuleDescriptor[]
  ): ModuleDescriptor | null {
    for (const module of modules) {
      if (module.fragment.provides?.includes(functionName)) {
        return module;
      }
    }
    return null;
  }
}
```

## Module Validation

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions?: string[];
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
      "Geometry", "Material", "Scene", "Lights",
      "Camera", "Estimator", "Film", "Developer"
    ];
    if (!validKinds.includes(module.id.kind)) {
      errors.push(`Invalid module kind: ${module.id.kind}`);
    }
    
    // Check required functions based on kind
    const requiredFunctions = this.getRequiredFunctions(module.id.kind);
    const providedFunctions = module.fragment.provides || [];
    
    for (const required of requiredFunctions) {
      if (!providedFunctions.includes(required)) {
        errors.push(
          `${module.id.kind} module must provide '${required}' function`
        );
      }
    }
    
    // Validate GLSL syntax (basic check)
    if (module.fragment.functions) {
      const syntaxErrors = this.validateGLSL(module.fragment.functions);
      errors.push(...syntaxErrors);
    }
    
    // Parameter validation
    for (const param of module.parameters || []) {
      if (param.min !== undefined && param.max !== undefined) {
        if (param.min >= param.max) {
          errors.push(`Parameter ${param.name}: min >= max`);
        }
      }
      
      // Check default is in range
      if (typeof param.default === 'number') {
        if (param.min !== undefined && param.default < param.min) {
          errors.push(`Parameter ${param.name}: default < min`);
        }
        if (param.max !== undefined && param.default > param.max) {
          errors.push(`Parameter ${param.name}: default > max`);
        }
      }
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }
  
  private getRequiredFunctions(kind: string): string[] {
    switch (kind) {
      case "Geometry":
        return ["geodesic", "dot", "parallel_transport", "frame"];
      case "Material":
        // Must provide either shade OR interact
        return [];  // Checked separately
      case "Scene":
        return ["intersect", "intersect_any", "inside"];
      case "Lights":
        return ["sample_light", "eval_light", "pdf_light"];
      case "Camera":
        return ["generate_ray"];
      case "Estimator":
        return ["estimate"];
      case "Film":
        return ["accumulate"];
      case "Developer":
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
    const strings = source.match(/"[^"]*$/gm);
    if (strings) {
      errors.push("Unterminated string literal");
    }
    
    // More checks could be added...
    
    return errors;
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
  author?: string;
  tags?: string[];
}

class ModuleRegistry {
  search(query: ModuleQuery): ModuleDescriptor[] {
    let results = Array.from(this.storage.modules.values());
    
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
        const provides = new Set(m.fragment.provides || []);
        return query.provides!.every(f => provides.has(f));
      });
    }
    
    // Filter by requires
    if (query.requires) {
      results = results.filter(m => {
        const requires = new Set(m.fragment.requires || []);
        return query.requires!.every(f => requires.has(f));
      });
    }
    
    // Filter by metadata
    if (query.author) {
      results = results.filter(m => 
        m.metadata?.author === query.author
      );
    }
    
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
    
    // Simple similarity: shared prefix or suffix
    const pattern = name.toLowerCase();
    return allOfKind.filter(m => {
      const mName = m.id.name.toLowerCase();
      return mName.includes(pattern) || pattern.includes(mName);
    });
  }
}
```

## Built-in Modules

```typescript
interface BuiltInModules {
  registerDefaults(): void;
}

class ModuleRegistry {
  registerDefaults() {
    // Core geometry
    this.register(EuclideanGeometry);
    this.register(SphericalGeometry);
    this.register(HyperbolicGeometry);
    
    // Basic materials
    this.register(LambertMaterial);
    this.register(GlassMaterial);
    this.register(MirrorMaterial);
    
    // Standard cameras
    this.register(PinholeCamera);
    this.register(ThinLensCamera);
    
    // Essential estimators
    this.register(DirectEstimator);
    this.register(PathTracerEstimator);
    
    // Films
    this.register(PassthroughFilm);
    this.register(SimpleAverageFilm);
    this.register(VarianceTrackingFilm);
    
    // Developers
    this.register(IdentityDeveloper);
    this.register(ReinhardDeveloper);
    this.register(ACESDeveloper);
    
    // Scenes
    this.register(SDFScene);
    
    // Lights
    this.register(PointLight);
    this.register(EnvironmentLight);
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

## Integration with Engine

```typescript
class ModuleRegistry {
    constructor() {
        this.registerDefaults();
    }

    // Called by ShaderCompiler
    resolveModules(recipe: Recipe): ModuleCollection {
        const resolved: ModuleCollection = {
            geometry: null,
            material: null,      // SINGLE material now
            scene: null,
            lights: null,
            camera: null,
            estimator: null,
            film: null,
            developer: null
        };

        // Resolve each module
        resolved.geometry = this.get(
            recipe.world.geometry.kind,
            recipe.world.geometry.name
        );

        // Just ONE material
        const matRef = recipe.world.material;
        resolved.material = this.get(matRef.kind, matRef.name);

        resolved.scene = this.get(
            recipe.world.scene.kind,
            recipe.world.scene.name
        );

        resolved.lights = this.get(
            recipe.world.lights.kind,
            recipe.world.lights.name
        );

        // ... continue for photography modules

        return resolved;
    }
}

// Update ModuleCollection type
interface ModuleCollection {
    geometry: ModuleDescriptor | null;
    material: ModuleDescriptor | null;  // SINGLE, not array
    scene: ModuleDescriptor | null;
    lights: ModuleDescriptor | null;
    camera: ModuleDescriptor | null;
    estimator: ModuleDescriptor | null;
    film: ModuleDescriptor | null;
    developer: ModuleDescriptor | null;
}
```

## Performance Considerations

- Use Maps for O(1) lookup by key
- Maintain indexes for common queries
- Cache dependency graphs for repeated validation
- Lazy-load module GLSL sources if needed
- Keep metadata separate from core functionality
