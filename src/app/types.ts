// app/types.ts
import type { TileJob } from './TiledRenderer';

// Re-export compiler types that are used by app consumers
export type {
    RenderStrategy,
    SceneDescription,
    CompiledRenderer
} from '../compiler/types.js';

import type { RenderStrategy, SceneDescription } from '../compiler/types.js';

/**
 * Strategy preset - maps strategy ID to strategy configuration
 */
export interface StrategyPreset {
    name: string;
    description: string;
    strategy: RenderStrategy;
}

/**
 * Configuration for FlexibleApp initialization
 */
export interface FlexibleAppConfig {
    scene: SceneDescription;
    strategies: RenderStrategy[];
    initialParameters?: Record<string, any>;
}

/**
 * Render progress information
 */
export interface RenderProgress {
    samples: number;
    targetSamples?: number;
    elapsedTime: number;
    fps: number;
    mode: 'interactive' | 'production';
    state: 'rendering' | 'paused' | 'complete' | 'stopped';
    percentComplete?: number;
}

/**
 * Built-in strategy presets
 */
export const STRATEGY_PRESETS: Record<string, StrategyPreset> = {
    'pathtracer': {
        name: 'Path Tracer',
        description: 'Full path tracing with global illumination',
        strategy: {
            id: 'pathtracer',
            settings: {
                maxBounces: 8,
                samplesPerFrame: 1
            }
        }
    },
    'pathtracer-aovs': {
        name: 'Path Tracer + AOVs',
        description: 'Path tracing with Arbitrary Output Variables',
        strategy: {
            id: 'pathtracer-aovs',
            settings: {
                maxBounces: 8,
                samplesPerFrame: 1
            }
        }
    },
    'debug': {
        name: 'Debug',
        description: 'Debug visualization mode',
        strategy: {
            id: 'debug',
            settings: {
                debugOutput: 'normal'
            }
        }
    },
    'pathtracer-full': {
        name: 'Full Path Tracer',
        description: 'Multi-bounce path tracing with Cornell box scene',
        strategy: {
            id: 'pathtracer-full',
            settings: {
                maxBounces: 8,
                samplesPerFrame: 1
            }
        }
    },
    'debug-aovs': {
        name: 'Debug AOVs',
        description: 'Debug visualization with albedo, distance, and march steps',
        strategy: {
            id: 'debug-aovs',
            settings: {
                defaultOutput: 'albedo'
            }
        }
    }
};

/**
 * Single parameter change
 */
export interface ParameterChange {
    path: string;
    oldValue: any;
    newValue: any;
}

/**
 * Batch of parameter changes
 */
export interface ParameterChanges {
    changes: ParameterChange[];
}

// Re-export ParameterMetadata from engine (single source of truth)
export type { ParameterMetadata } from '../engine/types.js';

/**
 * Extension interface for adding features to the app
 *
 * Extensions can add UI, modify rendering behavior, provide new services,
 * and save/restore state with sessions.
 */
export interface Extension {
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
export type EventHandler = (data?: any) => void;

/**
 * Complete session data for save/restore
 *
 * Captures all state needed to recreate a rendering session:
 * active recipe, parameters, camera, accumulation, and tile jobs.
 */
export interface SessionData {
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
