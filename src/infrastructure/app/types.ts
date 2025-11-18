// app/types.ts
import type { TileJob } from './TiledRenderer';

/**
 * Single parameter change
 */
interface ParameterChange {
    path: string;
    oldValue: any;
    newValue: any;
}

/**
 * Batch of parameter changes
 */
interface ParameterChanges {
    changes: ParameterChange[];
}

/**
 * Parameter metadata for validation and UI generation
 *
 * Defines how parameters behave and how they should be displayed in UIs.
 * All fields except type and default are optional.
 */
interface ParameterMetadata {
    // Required
    type: 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'color';
    default: any;

    // For numeric types (float/int)
    range?: [number, number];    // [min, max] - enables slider UI
    step?: number;               // increment (auto-calculated if omitted)
    values?: number[];           // discrete choices for int (renders dropdown)

    // UI hints (all optional)
    name?: string;               // Display name (falls back to parameter path)
    unit?: string;               // 'degrees', 'meters', 'samples', etc.
    group?: string;              // Override auto-inferred group from path prefix
    help?: string;               // Tooltip text (optional, rarely used)

    // Behavior (optional)
    triggersReset?: boolean;     // Override auto-inferred reset behavior
}

/**
 * Extension interface for adding features to the app
 *
 * Extensions can add UI, modify rendering behavior, provide new services,
 * and save/restore state with sessions.
 */
interface Extension {
    name: string;
    version?: string;
    description?: string;
    dependencies?: string[];

    install(app: any, bus: any): void;
    uninstall?(): void;

    saveState?(): any;
    restoreState?(state: any): void;
}

/**
 * Event handler type for EventBus
 */
type EventHandler = (data?: any) => void;

/**
 * Complete session data for save/restore
 *
 * Captures all state needed to recreate a rendering session:
 * active recipe, parameters, camera, accumulation, and tile jobs.
 */
interface SessionData {
    version: string;
    timestamp: number;

    // Core state
    activeRecipe: string;
    parameters: Record<string, any>;

    // Render state
    renderMode: 'interactive' | 'production';
    sampleCount: number;

    // Production mode state (optional)
    productionGoal?: {
        targetSamples: number;
    };

    // Camera state
    camera: {
        position: [number, number, number];
        target?: [number, number, number];
        frame?: number[];
        fov?: number;
    };

    // Extension states
    extensions: Record<string, any>;

    // Tiled rendering state
    tileJob?: TileJob;

    // Optional metadata
    metadata?: {
        title?: string;
        description?: string;
    };
}

export type {
    ParameterMetadata,
    ParameterChange,
    ParameterChanges,
    Extension,
    EventHandler,
    SessionData
};
