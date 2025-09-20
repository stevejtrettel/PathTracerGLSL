# App Types Contract

## Purpose

Core types, interfaces, and data structures for the App pillar. All App components and extensions depend on these type definitions.

## Recipe Types

### Recipe Definition

```typescript
interface Recipe {
  id: string;                      // Unique identifier (e.g., "pathtracer_glass_caustics")
  name: string;                     // Human-readable name
  version: string;                  // Recipe format version (e.g., "1.0.0")
  
  world: WorldConfig;              // World pillar modules
  photography: PhotographyConfig;   // Photography pillar modules
  parameters?: RecipeParameters;    // Initial parameter values
  metadata?: RecipeMetadata;        // Optional description/tags
}

interface WorldConfig {
  geometry: ModuleReference;       // Single geometry module
  material: ModuleReference;       // Single material module (per architecture)
  scene: ModuleReference;          // Single scene module
  lights: ModuleReference;         // Single lights module
}

interface PhotographyConfig {
  camera: ModuleReference;         // Single camera module
  estimator: ModuleReference;      // Single estimator module
  film: ModuleReference;           // Single film module
  developer: ModuleReference;      // Single developer module
}

interface ModuleReference {
  kind: ModuleKind;                // Type of module
  name: string;                    // Module name (must exist in registry)
  version?: string;                // Optional version constraint
}

type ModuleKind = 
  | 'geometry' 
  | 'material' 
  | 'scene' 
  | 'lights'
  | 'camera' 
  | 'estimator' 
  | 'film' 
  | 'developer';

interface RecipeParameters {
  [path: string]: any;             // Dot-notation paths to initial values
}

interface RecipeMetadata {
  description?: string;            // What this recipe demonstrates
  author?: string;                 // Creator
  created?: string;                // ISO date string
  tags?: string[];                 // Searchable tags
  thumbnail?: string;              // Base64 preview or URL
  estimatedSPP?: number;           // Samples for convergence
}
```

### Recipe Bundle

```typescript
interface RecipeBundle {
  recipes: Record<string, Recipe>;  // Named recipes (2-3 typical)
  defaultRecipe: string;            // Which recipe to start with
}

// Example structure
const bundle: RecipeBundle = {
  recipes: {
    'pathtracer': { /* ... */ },
    'debug': { /* ... */ },
    'production': { /* ... */ }
  },
  defaultRecipe: 'pathtracer'
};
```

## Parameter Types

### Parameter Storage

```typescript
interface ParameterMetadata {
  type: ParameterType;             // Data type
  min?: number | number[];         // Minimum value(s)
  max?: number | number[];         // Maximum value(s)
  default: any;                    // Default value
  step?: number;                   // Increment for UI controls
  options?: any[];                 // For enum types
  uiHint?: UIHint;                 // How to display in UI
  description?: string;            // Human-readable description
  units?: string;                  // "degrees", "meters", etc.
  
  // Reset behavior
  triggersReset?: boolean;         // Does changing this reset accumulation?
  group?: string;                  // Grouping for UI organization
}

type ParameterType = 
  | 'float' 
  | 'int' 
  | 'vec2' 
  | 'vec3' 
  | 'vec4' 
  | 'bool' 
  | 'enum'
  | 'mat3'
  | 'mat4';

type UIHint = 
  | 'slider'        // Continuous value
  | 'color'         // Color picker for vec3
  | 'dropdown'      // Enumeration
  | 'checkbox'      // Boolean
  | 'angle'         // Rotation in degrees
  | 'hidden'        // Not shown in UI
  | 'readonly';     // Shown but not editable
```

### Parameter Changes

```typescript
interface ParameterChange {
  path: string;                    // Dot-notation path (e.g., "camera.fov")
  oldValue: any;                   // Previous value
  newValue: any;                   // New value
  timestamp: number;               // When changed (performance.now())
  metadata?: ParameterMetadata;    // Associated metadata if available
  source?: ChangeSource;           // What triggered the change
}

interface ParameterChanges {
  changes: ParameterChange[];      // Batch of changes
  triggersReset?: boolean;         // Any change requires accumulation reset?
  source?: ChangeSource;           // What triggered these changes
}

type ChangeSource = 
  | 'user'          // Direct user interaction
  | 'animation'     // Animation system
  | 'extension'     // Extension-initiated
  | 'session'       // Loading from session
  | 'recipe'        // Recipe switch
  | 'api';          // External API call
```

## Render Types

### Render Modes

```typescript
type RenderMode = 
  | 'interactive'   // Real-time preview, no accumulation
  | 'progressive'   // Continuous accumulation
  | 'production';   // Tiled high-resolution

interface RenderConfig {
  mode: RenderMode;
  
  // Common options
  resolution?: [number, number];    // Override canvas resolution
  samplesPerPass?: number;          // Samples per frame (usually 1)
  
  // Progressive mode options
  targetSamples?: number;           // Stop after N samples
  convergenceThreshold?: number;    // Variance threshold for auto-stop
  checkInterval?: number;           // Frames between convergence checks
  
  // Production mode options
  tiles?: TileConfig;               // Tiling configuration
  checkpoints?: CheckpointConfig;   // Save progress
  output?: OutputConfig;            // Where to save results
  
  // Interactive mode options
  targetFPS?: number;               // Target framerate
  adaptiveResolution?: boolean;     // Reduce resolution for performance
  maxResolution?: [number, number]; // Cap for adaptive resolution
}

interface TileConfig {
  tileSize: number;                 // Square tile dimension (e.g., 512)
  overlap?: number;                 // Pixel overlap for filtering
  order?: TileOrder;                // Rendering order
  maxMemory?: number;               // Memory limit per tile (bytes)
}

type TileOrder = 
  | 'spiral'        // Start from center
  | 'linear'        // Left-to-right, top-to-bottom
  | 'random'        // Random order
  | 'hilbert';      // Space-filling curve

interface CheckpointConfig {
  enabled: boolean;                 // Save checkpoints
  interval?: number;                // Tiles between saves
  path?: string;                    // Where to save
  keepCount?: number;               // Max checkpoints to keep
}

interface OutputConfig {
  format: OutputFormat;             // File format
  path?: string;                    // Output directory
  filename?: string;                // Filename pattern
  quality?: number;                 // JPEG quality (0-100)
  bitDepth?: 8 | 16 | 32;          // Bits per channel
}

type OutputFormat = 
  | 'png' 
  | 'jpeg' 
  | 'exr' 
  | 'hdr';
```

### Progress Tracking

```typescript
interface ProgressInfo {
  // Common fields
  mode: RenderMode;                 // Current render mode
  state: RenderState;               // Current state
  elapsedTime: number;              // Milliseconds since start
  
  // Sample tracking
  currentSamples: number;           // Samples accumulated
  targetSamples?: number;           // Target if specified
  samplesPerSecond?: number;        // Current throughput
  
  // Progressive mode
  variance?: number;                // Current variance estimate
  convergence?: number;             // Percentage converged [0-1]
  estimatedTimeRemaining?: number;  // Milliseconds
  
  // Production mode
  currentTile?: number;             // Which tile rendering
  totalTiles?: number;              // Total tile count
  tilesComplete?: number;           // Completed tiles
  tileProgress?: number;            // Current tile progress [0-1]
  
  // Performance
  frameTime?: number;               // Last frame duration
  fps?: number;                     // Current framerate
  gpuMemory?: number;               // GPU memory usage
}

type RenderState = 
  | 'idle'
  | 'rendering'
  | 'paused'
  | 'complete'
  | 'error';

interface RenderResult {
  mode: RenderMode;
  samples: number;
  time: number;                     // Total time in milliseconds
  variance?: number;                // Final variance
  tiles?: number;                   // Tiles rendered (production mode)
  checkpoints?: string[];           // Saved checkpoint paths
}
```

## Session Types

```typescript
interface SessionData {
  version: string;                  // Session format version
  timestamp: number;                // When saved
  
  // Core state
  recipeName: string;               // Active recipe
  parameters: Record<string, any>;  // All parameter values
  
  // Render state
  renderMode: RenderMode;           // Current mode
  renderConfig?: RenderConfig;      // Mode configuration
  accumulationCount: number;        // Samples accumulated
  
  // Camera state (from input extension if present)
  camera?: {
    position: [number, number, number];
    rotation?: [number, number, number];
    target?: [number, number, number];
    up?: [number, number, number];
    mode?: string;                  // Control mode
  };
  
  // Extension states
  extensions?: Record<string, any>; // Extension-specific state
  
  // Metadata
  metadata?: {
    title?: string;
    notes?: string;
    tags?: string[];
    thumbnail?: string;             // Base64 preview
  };
}

interface SessionMetadata {
  id: string;                      // Unique session ID
  filename: string;                // File path/name
  created: string;                 // ISO date
  modified?: string;               // Last modified
  size?: number;                   // File size in bytes
  preview?: string;                // Thumbnail
}
```

## Extension Types

```typescript
interface Extension {
  name: string;                     // Unique identifier
  version?: string;                 // Extension version
  dependencies?: string[];          // Required extensions
  
  install(app: ResearchApp, bus: EventBus): void;
  uninstall?(): void;               // Cleanup
  
  // State persistence
  saveState?(): any;                // For session saving
  restoreState?(state: any): void;  // For session loading
  
  // Metadata
  description?: string;             // What this extension does
  author?: string;                  // Extension creator
}

interface Service {
  // Services have no required interface
  // Each service defines its own API
  [key: string]: any;
}

interface ServiceRegistry {
  register(name: string, service: Service): void;
  unregister(name: string): void;
  get(name: string): Service | undefined;
  has(name: string): boolean;
  list(): string[];
}
```

## Event Types

```typescript
interface EventBus {
  on(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void;
  once(event: string, handler: EventHandler): void;
  emit(event: string, data?: any): void;
  
  // Utility methods
  removeAllListeners(event?: string): void;
  listenerCount(event: string): number;
  eventNames(): string[];
}

type EventHandler = (data?: any) => void;

// Standard events
type CoreEvent = 
  | 'recipe.changed'
  | 'recipe.compiled'
  | 'parameter.changed'
  | 'parameter.batch_updated'
  | 'render.started'
  | 'render.stopped'
  | 'render.frame'
  | 'render.progress'
  | 'render.complete'
  | 'accumulation.reset'
  | 'session.saved'
  | 'session.loaded'
  | 'extension.installed'
  | 'extension.uninstalled'
  | 'service.registered'
  | 'service.unregistered';

// Extension events (common patterns)
type ExtensionEvent = 
  | 'camera.moved'
  | 'camera.mode_changed'
  | 'ui.panel_created'
  | 'ui.panel_closed'
  | 'experiment.started'
  | 'experiment.progress'
  | 'experiment.complete'
  | 'screenshot.taken'
  | 'export.complete';
```

## Error Types

```typescript
class AppError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public component: string,
    public recoverable: boolean = false
  ) {
    super(message);
    this.name = 'AppError';
  }
}

type ErrorCode = 
  | 'RECIPE_NOT_FOUND'
  | 'RECIPE_INVALID'
  | 'PARAMETER_INVALID'
  | 'PARAMETER_OUT_OF_RANGE'
  | 'EXTENSION_DEPENDENCY_MISSING'
  | 'EXTENSION_INSTALL_FAILED'
  | 'SERVICE_NOT_FOUND'
  | 'SESSION_CORRUPT'
  | 'SESSION_VERSION_MISMATCH'
  | 'RENDER_FAILED'
  | 'ENGINE_NOT_INITIALIZED'
  | 'GPU_RESOURCE_EXHAUSTED';

interface ErrorContext {
  error: AppError;
  timestamp: number;
  state?: Partial<AppState>;       // App state when error occurred
  canRecover: boolean;
  suggestions?: string[];           // How to fix
}
```

## Core App Types

```typescript
interface ResearchApp {
  // Core components (always present)
  engine: Engine;
  parameterStore: ParameterStore;
  renderCoordinator: RenderCoordinator;
  sessionManager: SessionManager;
  
  // Extension system
  extensions: Map<string, Extension>;
  services: ServiceRegistry;
  bus: EventBus;
  
  // State
  recipes: RecipeBundle;
  activeRecipeName: string;
  state: AppState;
  
  // Core methods
  switchRecipe(name: string): void;
  quickStart(recipeName?: string): void;
  use(extension: Extension): ResearchApp;
  registerService(name: string, service: Service): void;
  getService(name: string): Service | undefined;
}

type AppState = 
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'rendering'
  | 'error';

interface AppConfig {
  recipes: RecipeBundle;            // 2-3 recipes defined upfront
  canvas: HTMLCanvasElement;        // Render target
  
  // Optional configuration
  autoStart?: boolean;              // Start rendering immediately
  defaultMode?: RenderMode;         // Initial render mode
  enableStats?: boolean;            // Track performance metrics
  logLevel?: LogLevel;              // Console output level
}

type LogLevel = 'error' | 'warn' | 'info' | 'debug';
```

## Validation Types

```typescript
interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
  suggestions?: string[];
}

interface RecipeValidation extends ValidationResult {
  missingModules?: ModuleReference[];
  incompatibleModules?: ModuleReference[];
  parameterConflicts?: string[];
}

interface ParameterValidation extends ValidationResult {
  clampedValues?: Array<{
    path: string;
    original: any;
    clamped: any;
  }>;
  missingMetadata?: string[];
}
```

## Constants

```typescript
const APP_VERSION = "1.0.0";
const SESSION_VERSION = "1.0.0";
const MAX_RECIPES = 10;             // Reasonable limit for eager compilation
const MAX_EXTENSIONS = 50;          // Sanity check
const DEFAULT_SAMPLE_RATE = 1;      // Samples per frame
const PROGRESS_UPDATE_INTERVAL = 100; // Milliseconds between progress updates
```

## Type Guards

```typescript
// Utility type guards for runtime checking
function isRecipe(obj: any): obj is Recipe {
  return obj && 
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    obj.world && 
    obj.photography;
}

function isParameterMetadata(obj: any): obj is ParameterMetadata {
  return obj &&
    typeof obj.type === 'string' &&
    obj.default !== undefined;
}

function isExtension(obj: any): obj is Extension {
  return obj &&
    typeof obj.name === 'string' &&
    typeof obj.install === 'function';
}

function isValidParameterPath(path: string): boolean {
  // Must be dot-notation: "category.subcategory.parameter"
  return /^[a-z]+(\.[a-z_]+)+$/.test(path);
}
```

## Invariants

1. **Recipe names unique** within a bundle
2. **Extension names unique** within an app instance
3. **Service names unique** within registry
4. **Parameter paths** follow dot notation
5. **Parameter values** match their metadata type
6. **Event names** follow namespace.action pattern
7. **Render modes** mutually exclusive
8. **Session versions** checked on load
