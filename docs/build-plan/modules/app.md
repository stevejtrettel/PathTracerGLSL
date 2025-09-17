Here's a detailed breakdown of each file in the App pillar with headers and interfaces:

## app/core/

### ResearchApp.ts
```typescript
/**
 * @file app/core/ResearchApp.ts
 * Main orchestrator that coordinates Engine, World, and Photography pillars.
 * Manages recipes, extensions, and provides the primary API for users.
 * This is the entry point - users create a ResearchApp and everything flows from here.
 */

export class ResearchApp {
  private engine: Engine;
  private parameterStore: ParameterStore;
  private renderCoordinator: RenderCoordinator;
  private sessionManager: SessionManager;
  private serviceRegistry: ServiceRegistry;
  private bus: EventBus;
  private extensions: Map<string, Extension>;
  private recipes: Record<string, Recipe>;
  private activeRecipeName: string;
  
  constructor(canvas: HTMLCanvasElement);
  quickStart(recipeName?: string): void;
  use(extension: Extension): this;  // Chainable
  switchRecipe(name: string): void;
  registerService(name: string, service: any): void;
  getService(name: string): any;
}
```

### ParameterStore.ts
```typescript
/**
 * @file app/core/ParameterStore.ts
 * Central state management for all renderer parameters.
 * Tracks values, metadata, and notifies observers of changes.
 * This is the single source of truth for all mutable state.
 */

export class ParameterStore {
  private parameters: Map<string, any>;
  private metadata: Map<string, ParameterMetadata>;
  onChange?: (changes: ParameterChanges) => void;
  
  set(path: string, value: any): void;
  get(path: string): any;
  batch(updates: Record<string, any>): void;
  getAll(): Record<string, any>;
  registerParameter(path: string, metadata: ParameterMetadata): void;
  getMetadata(path: string): ParameterMetadata | undefined;
  serialize(): string;
  restore(data: Record<string, any>): void;
}

export interface ParameterChanges {
  changes: Array<{
    path: string;
    oldValue: any;
    newValue: any;
    metadata?: ParameterMetadata;
  }>;
}
```

### RenderCoordinator.ts
```typescript
/**
 * @file app/core/RenderCoordinator.ts
 * Controls rendering execution strategy (interactive/progressive/production).
 * Manages accumulation, decides when to reset based on parameter changes,
 * and coordinates render loops without touching WebGL directly.
 */

export class RenderCoordinator {
  private mode: RenderMode;
  private accumulator: Accumulator;
  private animationId?: number;
  private resetPrefixes: Set<string>;
  private noResetPrefixes: Set<string>;
  private engine: Engine;
  
  constructor(engine: Engine);
  setMode(mode: RenderMode): void;
  start(): void;
  stop(): void;
  resetAccumulation(): void;
  handleParameterChange(path: string, oldValue: any, newValue: any): void;
  getAccumulationCount(): number;
  
  onProgress?: (info: ProgressInfo) => void;
  onComplete?: (result: RenderResult) => void;
}

type RenderMode = 'interactive' | 'progressive' | 'production';

interface Accumulator {
  count: number;
  isActive: boolean;
  reset(): void;
  increment(): void;
}
```

### SessionManager.ts
```typescript
/**
 * @file app/core/SessionManager.ts
 * Saves and loads complete application state including recipes, parameters, and camera.
 * Enables reproducible research by persisting entire session configuration.
 * Handles browser download/upload or Node.js file I/O depending on environment.
 */

export class SessionManager {
  constructor(private app: ResearchApp);
  
  async saveSession(filename: string): Promise<void>;
  async loadSession(filename: string): Promise<void>;
  
  private serializeSession(): SessionData;
  private restoreSession(data: SessionData): void;
}

interface SessionData {
  version: string;
  timestamp: number;
  recipeName: string;
  parameters: Record<string, any>;
  camera?: CameraState;
  metadata?: {
    author?: string;
    notes?: string;
  };
}
```

### EventBus.ts
```typescript
/**
 * @file app/core/EventBus.ts
 * Simple event emitter for loose coupling between extensions.
 * Allows extensions to communicate without direct references.
 * Type-safe events with TypeScript generics.
 */

export class EventBus {
  private events: Map<string, Set<EventHandler>>;
  
  on<T = any>(event: string, handler: EventHandler<T>): void;
  off(event: string, handler: EventHandler): void;
  emit<T = any>(event: string, data?: T): void;
  once<T = any>(event: string, handler: EventHandler<T>): void;
  clear(): void;
}

type EventHandler<T = any> = (data: T) => void;
```

### ServiceRegistry.ts
```typescript
/**
 * @file app/core/ServiceRegistry.ts
 * Manages services provided by extensions without polluting app interface.
 * Extensions register themselves here, other extensions can discover them.
 * Type-safe service retrieval with TypeScript.
 */

export class ServiceRegistry {
  private services: Map<string, any>;
  
  register(name: string, service: any): void;
  unregister(name: string): void;
  get<T = any>(name: string): T | undefined;
  has(name: string): boolean;
  list(): string[];
}
```

## app/extensions/

### base/Extension.ts
```typescript
/**
 * @file app/extensions/base/Extension.ts
 * Base interface that all extensions must implement.
 * Defines the contract for installing/uninstalling functionality.
 */

export interface Extension {
  name: string;
  dependencies?: string[];
  install(app: ResearchApp, bus: EventBus): void;
  uninstall?(): void;
}
```

### core/InputController.ts
```typescript
/**
 * @file app/extensions/core/InputController.ts
 * Basic WASD + mouse camera controls for navigation.
 * Updates camera parameters in ParameterStore based on user input.
 * Essential for interactive exploration.
 */

export class InputController implements Extension {
  name = 'input';
  private mode: ControlMode;
  private position: vec3;
  private rotation: vec2;
  private sensitivity: number;
  private speed: number;
  
  install(app: ResearchApp, bus: EventBus): void;
  uninstall(): void;
  
  // Service methods
  setMode(mode: ControlMode): void;
  getCamera(): CameraState;
  setCamera(state: CameraState): void;
}

type ControlMode = 'fly' | 'orbit' | 'locked';

interface CameraState {
  position: vec3;
  rotation?: vec2;
  target?: vec3;
}
```

### core/SimpleUI.ts
```typescript
/**
 * @file app/extensions/core/SimpleUI.ts
 * Minimal parameter display overlay showing current values.
 * Creates a small DOM panel with key parameters for monitoring.
 * Not for editing - just for seeing current state.
 */

export class SimpleUI implements Extension {
  name = 'ui';
  private panel: HTMLElement;
  private watchedParams: string[];
  
  install(app: ResearchApp, bus: EventBus): void;
  uninstall(): void;
  
  // Service methods
  addWatch(paramPath: string): void;
  removeWatch(paramPath: string): void;
  toggle(): void;
}
```

## app/types/

### Recipe.ts
```typescript
/**
 * @file app/types/Recipe.ts
 * Complete render configuration specifying World and Photography modules.
 * This is what gets compiled into a shader program.
 */

export interface Recipe {
  id: string;
  name: string;
  version: string;
  world: WorldConfig;
  photography: PhotoConfig;
  parameters?: Record<string, any>;
}

export interface WorldConfig {
  geometry: string;  // Module name
  material: string;
  scene: string;
  lights: string;
}

export interface PhotoConfig {
  camera: string;
  estimator: string;
  film: string;
  developer: string;
}
```

### Parameter.ts
```typescript
/**
 * @file app/types/Parameter.ts
 * Type definitions for parameter metadata and validation.
 * Used by ParameterStore to validate and describe parameters.
 */

export interface ParameterMetadata {
  type: ParameterType;
  min?: number | number[];
  max?: number | number[];
  default: any;
  uiHint?: UIHint;
  description?: string;
}

export type ParameterType = 
  | 'float' | 'int' 
  | 'vec2' | 'vec3' | 'vec4' 
  | 'bool' | 'enum';

export type UIHint = 
  | 'slider' | 'color' 
  | 'dropdown' | 'hidden';
```

### Session.ts
```typescript
/**
 * @file app/types/Session.ts
 * Types for session serialization format.
 * Defines what gets saved/loaded for reproducibility.
 */

export interface Session {
  version: string;
  timestamp: number;
  recipeName: string;
  parameters: Record<string, any>;
  camera?: CameraState;
  extensions?: string[];  // Active extension names
  metadata?: SessionMetadata;
}

export interface SessionMetadata {
  author?: string;
  title?: string;
  notes?: string;
  renderTime?: number;
  sampleCount?: number;
}
```

### Events.ts
```typescript
/**
 * @file app/types/Events.ts
 * Type definitions for all standard events in the system.
 * Provides type safety for event data payloads.
 */

export interface AppEvents {
  'recipe.switched': { recipeName: string };
  'render.start': void;
  'render.progress': { samples: number };
  'render.complete': { samples: number; time: number };
  'accumulation.reset': void;
  'parameter.changed': { path: string; value: any };
  'camera.moved': CameraState;
  'session.loaded': Session;
  'error': { type: string; message: string };
}

// Helper for type-safe event handling
export type EventData<K extends keyof AppEvents> = AppEvents[K];
```

### Extension.ts
```typescript
/**
 * @file app/types/Extension.ts
 * Extension interface re-export and extension-specific types.
 * Central place for all extension-related type definitions.
 */

export { Extension } from '../extensions/base/Extension';

export interface ExtensionManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  dependencies?: string[];
  provides?: string[];  // Services provided
}
```

## app/utils/

### Validators.ts
```typescript
/**
 * @file app/utils/Validators.ts
 * Parameter validation functions based on metadata.
 * Ensures values are within specified ranges and correct types.
 */

export function validateParameter(
  value: any, 
  metadata: ParameterMetadata
): ValidationResult;

export function validateRecipe(recipe: Recipe): ValidationResult;

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}
```

### FileIO.ts
```typescript
/**
 * @file app/utils/FileIO.ts
 * Abstraction over file operations for browser and Node.js.
 * Handles download/upload in browser, fs operations in Node.
 */

export class FileIO {
  static async save(filename: string, content: string): Promise<void>;
  static async load(filename: string): Promise<string>;
  static async saveBlob(filename: string, blob: Blob): Promise<void>;
  static isBrowser(): boolean;
}
```

### Debounce.ts
```typescript
/**
 * @file app/utils/Debounce.ts
 * Utilities for throttling rapid parameter changes.
 * Prevents overwhelming the GPU during slider drags.
 */

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): T;

export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number
): T;
```

## app/index.ts
```typescript
/**
 * @file app/index.ts
 * Public API exports for the App pillar.
 * This is what other pillars and users import.
 */

export { ResearchApp } from './core/ResearchApp';
export { Extension } from './extensions/base/Extension';
export * from './types/Recipe';
export * from './types/Parameter';
export * from './types/Session';
```

This gives you a complete blueprint for the App pillar with clear responsibilities for each file!
