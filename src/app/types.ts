// app/types.ts

import type { TileJob } from './TiledRenderer.js';

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
 * Configuration for App initialization
 */
export interface AppConfig {
    scene: SceneDescription;
    strategies: RenderStrategy[];
    initialParameters?: Record<string, any>;
    environmentHDR?: string;
}

/**
 * Options for App.create() factory method
 */
export interface CreateAppOptions {
    /** Layout mode (default: 'fullscreen') */
    layout?: 'fullscreen' | 'centered' | 'editor' | 'split';
    /** CSS variables for layout customization */
    layoutVariables?: Record<string, string>;
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

    install(app: import('./App.js').App, bus: import('./EventBus.js').EventBus): void;
    uninstall?(): void;

    saveState?(): unknown;
    restoreState?(state: unknown): void;
}

/**
 * Event handler type for EventBus
 */
export type EventHandler = (data?: any) => void;

/**
 * Session data structure
 *
 * Captures enough state to re-queue work on restore:
 * - Parameters + renderer: restore the scene setup
 * - productionGoal: re-start a production render
 * - tileJob: resume a tiled render (skip completed tiles)
 *
 * Does NOT capture GPU state (accumulation buffers, sample counts).
 * Restoring always re-renders from scratch, but tiled jobs skip
 * tiles whose output was already saved to disk.
 */
export interface SessionData {
    version: string;
    timestamp: number;

    // Core (always present)
    parameters: Record<string, any>;
    rendererId: string | null;
    extensions: Record<string, any>;

    // Production job (if one was active)
    productionGoal?: { targetSamples: number };

    // Tiled job (if one was active)
    tileJob?: TileJob;
}

export const SESSION_VERSION = '1.0.0';
