// Types for the parameter system - Phase 2 minimal but correct

import type { ModuleDescriptor } from '../engine/types';

export interface RenderConfiguration {
    name: string;
    description?: string;

    modules: {
        ambient: ModuleDescriptor;
        scene: ModuleDescriptor;
        environment: ModuleDescriptor;
        lighting: ModuleDescriptor;
        camera: ModuleDescriptor;
        interaction: ModuleDescriptor;
        transport: ModuleDescriptor;
        accumulator: ModuleDescriptor;
        developer: ModuleDescriptor;
    };

    parameters: Record<string, any>;

    environmentMap?: {
        path: string;
        intensity?: number;
        rotation?: number;
    };
}



/**
 * Metadata about a parameter for validation and UI
 */
interface ParameterMetadata {
    type: 'float' | 'vec3' | 'int' | 'bool';
    default: any;
    min?: number;
    max?: number;
}

/**
 * Single parameter change
 */
interface ParameterChange {
    path: string;          // "camera.position"
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
 * Extensions!
 */
interface Extension {
    name: string;
    version?: string;
    description?: string;
    dependencies?: string[];

    install(app: any, bus: any): void;  // app as 'any' to avoid circular import
    uninstall?(): void;

    saveState?(): any;
    restoreState?(state: any): void;
}



/**
 * Event handler type for EventBus
 */
type EventHandler = (data?: any) => void;


import type { TileJob } from './TiledRenderer';  // ADD THIS IMPORT

export interface SessionData {
    // Metadata
    version: string;
    timestamp: number;

    // Core state
    activeRecipe: string;
    parameters: Record<string, any>;

    // Render state
    renderMode: 'interactive' | 'progressive' | 'production';
    sampleCount: number;

    // Camera
    camera: {
        position: [number, number, number];
        target?: [number, number, number];
        frame?: number[];
        fov?: number;
    };

    // Extension states
    extensions: Record<string, any>;

    // Tile job state (ADD THIS)
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
