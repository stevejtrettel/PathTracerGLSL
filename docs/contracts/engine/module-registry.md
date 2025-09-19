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

## Data Types

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

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

interface ModuleQuery {
  kind?: string;
  name?: string;         // Partial match
  provides?: string[];   // Must provide all
  requires?: string[];   // Must require all
  tags?: string[];      // Must have all tags
}
```

## Storage Requirements

The registry MUST maintain:
- Primary storage indexed by `kind:name` key
- Secondary indexes for `provides` and `requires` functions
- Registration order and timestamps for debugging
- No duplicate modules (same kind:name pair)

## Module Validation

### Structure Validation

Each registered module MUST have:
- `id.kind` from valid set
- `id.name` (non-empty string)
- `id.version` (recommended, generates warning if missing)
- Valid GLSL fragment code

Valid module kinds: `geometry`, `material`, `scene`, `lights`, `camera`, `estimator`, `film`, `developer`

### Required Functions by Kind

Each module MUST provide specific functions based on its kind:

| Kind | Required Functions |
|------|-------------------|
| geometry | `geodesic`, `dot`, `parallel_transport`, `frame` |
| material | `evaluate`, `sample`, `pdf` |
| scene | `intersect`, `intersect_any`, `classify_point` |
| lights | `sample_light`, `eval_light`, `pdf_light` |
| camera | `generate_ray` |
| estimator | `estimate` |
| film | `accumulate` |
| developer | `develop` |

### Parameter Validation

For each parameter in `module.parameters`:
- MUST have `name` and `type` fields
- If range specified: `min < max`
- If default specified: `min ≤ default ≤ max`
- Type MUST be valid GLSL type

### GLSL Validation

The registry MUST perform basic GLSL validation:
- Balanced braces `{}`
- No unterminated string literals
- Valid function signatures for provided functions

## Dependency Resolution

### Dependency Validation

The registry MUST validate that:
- All functions in `requires` have at least one provider
- No circular dependencies exist
- Warn if multiple modules provide the same function

### Cycle Detection

The registry MUST detect dependency cycles using graph traversal:
- Build dependency graph from requires/provides
- Detect cycles during traversal
- Report full cycle path in errors

### Provider Resolution

When finding providers:
- Exact function name match required
- Return all providers for conflict detection
- Maintain fast lookup via provides index

## Recipe Operations

### Compatibility Checking

`checkCompatibility(recipe)` MUST:
1. Verify all 8 module references exist
2. Ensure material is single module (not array)
3. Validate all dependencies can be satisfied
4. Find alternative modules for missing ones
5. Return detailed compatibility report

### Module Resolution

`resolveModules(recipe)` MUST:
1. Look up all 8 modules by kind:name
2. Throw `ModuleNotFoundError` if any missing
3. Validate dependency satisfaction
4. Return complete `ModuleCollection`
5. Fail fast with clear error messages

## Module Search

The search function MUST support:
- Filtering by module kind
- Partial name matching (case-insensitive)
- Function provides filtering (must provide all)
- Function requires filtering (must require all)
- Tag-based filtering

All filters are conjunctive (AND operation).

## Built-in Modules

The registry MUST provide via `registerDefaults()`:

### Core Modules (minimum required set)

| Kind | Module | Description |
|------|--------|-------------|
| geometry | `euclidean` | Standard flat space |
| geometry | `spherical` | Positive curvature |
| material | `lambert` | Simple diffuse |
| material | `disney` | Principled BSDF |
| scene | `sdf` | Signed distance fields |
| lights | `point` | Point light source |
| lights | `hdri` | Environment map |
| camera | `pinhole` | No depth of field |
| camera | `thin_lens` | With aperture |
| estimator | `pathtracer` | Standard path tracing |
| estimator | `debug` | Visualization modes |
| film | `simple` | Basic accumulation |
| film | `variance` | With variance tracking |
| developer | `reinhard` | Simple tone mapping |
| developer | `aces` | Filmic tone mapping |

## Error Handling

The registry MUST throw specific errors:

### RegistrationError
- When: Module fails validation
- Contains: Module descriptor and validation errors

### DuplicateModuleError
- When: Module with same kind:name exists
- Contains: Module descriptor

### ModuleNotFoundError
- When: Requested module doesn't exist
- Contains: Kind and name requested

### DependencyError
- When: Dependencies cannot be satisfied
- Contains: Missing functions and requiring modules

## Performance Requirements

- Module lookup by kind:name: O(1)
- Provider lookup by function: O(1)
- Dependency validation: O(n·m) where n=modules, m=avg dependencies
- Cycle detection: O(n + e) where e=dependency edges
- Module search: O(n) with early termination

## Registration Rules

1. Modules are immutable once registered
2. Duplicate registration fails with error
3. Unregistration allowed but discouraged
4. Built-in modules registered before custom
5. Registration order preserved for debugging

## Invariants

1. No two modules have the same kind:name combination
2. All registered modules pass validation
3. Built-in modules are always available after `registerDefaults()`
4. Registry maintains consistent indexes after all operations
5. Module retrieval never modifies registry state
6. Failed registration leaves registry unchanged

## Integration Requirements

The registry MUST:
- Initialize built-in modules on creation
- Provide thread-safe read operations
- Support hot-reloading via unregister/register
- Export module lists for UI/debugging
- Integrate with ShaderCompiler for recipe compilation
