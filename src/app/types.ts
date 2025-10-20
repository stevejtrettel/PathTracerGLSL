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
 * Parameter metadata for validation and UI
 */
interface ParameterMetadata {
    type: 'float' | 'vec3' | 'int' | 'bool';
    default: any;
    min?: number;
    max?: number;
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
    renderMode: 'interactive' | 'progressive' | 'production';
    sampleCount: number;

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
