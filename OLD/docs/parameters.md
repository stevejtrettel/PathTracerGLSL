# Parameter System Design Documentation

## Overview

The parameter system provides a clean abstraction layer between user-facing controls (UI sliders, keyboard inputs) and the underlying shader uniforms. It enables runtime adjustment of values with rich metadata for UI generation, validation, and persistence.

## Core Design Principles

1. **Separation of Concerns**: Parameters are distinct from uniforms. Parameters carry user-facing metadata (ranges, units, UI hints) while uniforms are just GPU bindings.

2. **Opt-in Simplicity**: Plugins work exactly as before if they don't declare parameters. When they do need parameters, it's a simple addition.

3. **Clean Data Flow**:
   ```
   User Input → Parameters → Plugin State → Uniforms → GPU
   ```

4. **Type Safety**: The system validates parameter types and ranges at runtime.

5. **Minimal Intrusion**: The existing codebase requires minimal changes to support parameters.

## Architecture Components

### 1. Type Definitions (additions to core/types.ts)

```typescript
// Rich semantic types for parameters
export type ParameterType = 
    | 'float' 
    | 'int'
    | 'angle'      // Shown in degrees in UI, but can be radians internally
    | 'color'      // vec3 representing RGB
    | 'vec2' 
    | 'vec3'
    | 'boolean';

// Describes a user-facing parameter
export interface ParameterDescriptor {
    name: string;                    // Local name (e.g., 'fov')
    displayName?: string;            // UI postprocess name (e.g., 'Field of View')
    type: ParameterType;            
    default: any;                    // Default value
    
    // Constraints
    min?: number;                    // For numeric types
    max?: number;
    step?: number;                   // For discrete increments
    options?: any[];                 // For discrete choices (e.g., f-stops)
    
    // UI hints
    unit?: string;                   // Display unit (e.g., 'degrees', 'mm')
    uiHint?: 'slider' | 'input' | 'dropdown' | 'color-picker' | 'hidden';
    group?: string;                  // For UI organization (e.g., 'Lens', 'Exposure')
    
    // Behavior
    persistent?: boolean;            // Should this be saved/restored?
    resetAccumulation?: boolean;     // Should changes reset accumulation buffer?
}

// Read-only view of parameters for a specific namespace
export interface ParameterView {
    get(name: string): any;
    has(name: string): boolean;
    onChange(name: string, callback: (value: any, old: any) => void): void;
    offChange(name: string, callback: (value: any, old: any) => void): void;
}

// Extended Plugin interface
export interface Plugin {
    // Existing methods
    readonly role: Role;
    readonly namespace: string;
    uniforms(): UniformDecl[];
    chunks(): GLSLChunk[];
    applyUniforms?(view: UniformManager, ctx?: PipelineContext): void;
    
    // New parameter system methods
    parameters?(): ParameterDescriptor[];
    applyParameters?(params: ParameterView, ctx?: PipelineContext): void;
    
    // For controls plugins
    update?(ctx: PipelineContext, dt: number): void;
}
```

### 2. ParameterManager Class

The central registry for all parameters in the system. It stores parameter descriptors and values, provides scoped views for plugins, handles change notifications, and validates values.

```typescript
// src/systems/ParameterManager.ts

interface ParameterEntry {
    descriptor: ParameterDescriptor;
    value: any;
    listeners: Set<(value: any, old: any) => void>;
}

export default class ParameterManager {
    // Hierarchical storage: namespace -> parameter name -> entry
    private parameters = new Map<string, Map<string, ParameterEntry>>();
    
    // Global change listeners (e.g., for accumulation reset)
    private globalListeners = new Set<(namespace: string, name: string, value: any, old: any) => void>();
    
    /**
     * Register parameters for a plugin
     */
    registerParameters(namespace: string, descriptors: ParameterDescriptor[]): void {
        if (!this.parameters.has(namespace)) {
            this.parameters.set(namespace, new Map());
        }
        
        const nsParams = this.parameters.get(namespace)!;
        
        for (const desc of descriptors) {
            // Initialize with default value if not already set
            if (!nsParams.has(desc.name)) {
                nsParams.set(desc.name, {
                    descriptor: desc,
                    value: desc.default,
                    listeners: new Set()
                });
            } else {
                // Update descriptor but preserve current value
                const entry = nsParams.get(desc.name)!;
                entry.descriptor = desc;
            }
        }
    }
    
    /**
     * Get a scoped view for a specific namespace
     */
    getView(namespace: string): ParameterView {
        return new ParameterViewImpl(this, namespace);
    }
    
    /**
     * Set a parameter value
     */
    set(namespace: string, name: string, value: any): void {
        const nsParams = this.parameters.get(namespace);
        if (!nsParams) {
            console.warn(`ParameterManager: namespace "${namespace}" not found`);
            return;
        }
        
        const entry = nsParams.get(name);
        if (!entry) {
            console.warn(`ParameterManager: parameter "${namespace}.${name}" not found`);
            return;
        }
        
        const old = entry.value;
        if (old === value) return; // No change
        
        // Validate against constraints
        if (this.validateValue(entry.descriptor, value)) {
            entry.value = value;
            
            // Notify parameter-specific listeners
            for (const listener of entry.listeners) {
                listener(value, old);
            }
            
            // Notify global listeners
            for (const listener of this.globalListeners) {
                listener(namespace, name, value, old);
            }
        }
    }
    
    /**
     * Get a parameter value
     */
    get(namespace: string, name: string): any {
        const nsParams = this.parameters.get(namespace);
        if (!nsParams) return undefined;
        
        const entry = nsParams.get(name);
        return entry?.value;
    }
    
    // ... additional methods for listeners, serialization, validation, etc.
}
```

### 3. Integration with Tracer

The Tracer needs minimal modifications to support parameters:

1. **During plugin registration (`use()` method)**:
    - If plugin has `parameters()` method, register them with ParameterManager
    - Call `applyParameters()` once to set initial state

2. **During frame rendering (`frame()` method)**:
    - Before applying uniforms, call `applyParameters()` on each plugin
    - This updates plugin internal state based on current parameter values
    - Then `applyUniforms()` uses that updated state

3. **New methods on Tracer**:
    - `setParameter(namespace, name, value)` - programmatic parameter control
    - `getParameterManager()` - for UI generation
    - `saveParameters()` / `loadParameters()` - persistence

## Usage Examples

### Simple Camera with One Parameter

```typescript
// In PinholeCameraPlugin.ts

export interface PinholeOptions {
    fovDegrees?: number;
    parameters?: string[] | boolean;  // Which parameters to expose
}

export default class PinholeCameraPlugin implements Plugin {
    private fovRadians: number;
    private exposedParams: Set<string>;
    
    constructor(opts: PinholeOptions = {}) {
        this.fovRadians = (opts.fovDegrees ?? 60) * Math.PI / 180;
        
        // Parse which parameters to expose
        if (opts.parameters === true) {
            this.exposedParams = new Set(['fov']);
        } else if (Array.isArray(opts.parameters)) {
            this.exposedParams = new Set(opts.parameters);
        } else {
            this.exposedParams = new Set();
        }
    }
    
    parameters(): ParameterDescriptor[] {
        if (!this.exposedParams.has('fov')) return [];
        
        return [{
            name: 'fov',
            displayName: 'Field of View',
            type: 'angle',
            default: 60,
            min: 10,
            max: 120,
            unit: 'degrees',
            uiHint: 'slider',
            resetAccumulation: true
        }];
    }
    
    applyParameters(params: ParameterView): void {
        if (this.exposedParams.has('fov')) {
            const fovDeg = params.get('fov');
            this.fovRadians = fovDeg * Math.PI / 180;
        }
    }
    
    applyUniforms(view: UniformManager, ctx?: PipelineContext): void {
        // Use the potentially updated fovRadians
        view.set1f("cam_fovY", this.fovRadians);
        // ... set other uniforms
    }
}
```

### Usage in Application

```typescript
// main.ts

// Camera with no parameters (works as before)
tracer.use(new PinholeCameraPlugin({ fovDegrees: 45 }));

// Camera with FOV exposed as parameter
tracer.use(new PinholeCameraPlugin({ 
    fovDegrees: 60,
    parameters: ['fov']
}));

// Programmatic parameter control
tracer.setParameter('cam.pinhole', 'fov', 75);

// Generate UI
const paramManager = tracer.getParameterManager();
for (const namespace of paramManager.getNamespaces()) {
    const params = paramManager.getNamespaceParameters(namespace);
    // Generate UI controls based on parameter descriptors
}
```

### Complex Camera with Multiple Parameters

```typescript
// Thin lens camera with selective parameter exposure
tracer.use(new ThinLensCameraPlugin({
    focalLengthMM: 50,
    fStop: 2.8,
    focusDistance: 5,
    parameters: ['fStop', 'focusDistance']  // Only expose DOF controls
}));
```

## Future Scene System Integration

When the scene system is built, objects can use a simple helper function:

```typescript
// Future scene description API (conceptual)
sphere({
    radius: 1.0,                        // Fixed value
    material: {
        roughness: param('rough', 0.5),  // Parameterized
        ior: 1.5                        // Fixed value
    }
})

// The param() helper would:
// 1. Register the parameter if not fixed
// 2. Return a marker for the scene compiler
// 3. Generate uniform vs constant in GLSL accordingly
```

## Key Benefits

1. **Clean Separation**: Parameters handle user interaction, uniforms handle GPU state
2. **Progressive Enhancement**: Existing plugins work unchanged
3. **Rich Metadata**: Everything needed for UI generation is declarative
4. **Type Safety**: Runtime validation prevents invalid states
5. **Persistence**: Easy serialization of all parameter state
6. **Scalable**: Works for 0 to 1000+ parameters without architectural changes

## Implementation Order

1. Add parameter types to `core/types.ts` (extending Plugin interface)
2. Add `ParameterManager.ts` to `systems/`
3. Modify `Tracer.ts` to:
    - Create ParameterManager instance
    - Call parameter methods during use() and frame()
    - Expose parameter control methods
4. Update individual plugins to expose parameters as needed
5. Create UI generation utilities (can be done separately)

## Design Decisions

- **Parameters are separate from uniforms**: They serve different purposes with different metadata needs
- **Opt-in pattern**: Plugins declare which values should be parameters via constructor options
- **Two-phase update**: Parameters update plugin state, then uniforms are set from that state
- **Namespace-based**: Each plugin's parameters are isolated by namespace
- **Validation at set-time**: Invalid values are rejected when set, not when applied

This design maintains the elegant simplicity of the existing tracer system while adding a powerful parameter layer that can grow with the project's needs.
