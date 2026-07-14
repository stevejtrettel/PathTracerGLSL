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
 * Strategy preset — maps a name to a strategy configuration. Consumed by
 * App.initializeWithPresets (facade convenience API; the built-in pages use the direct
 * initialize({strategies}) form instead).
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
