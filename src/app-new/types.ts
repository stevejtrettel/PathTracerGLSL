// app-new/types.ts
// Type definitions for FlexibleApp

import type { RenderStrategy, SceneDescription, CompiledRenderer } from '../compiler/types.js';

/**
 * Configuration for initializing FlexibleApp
 */
export interface FlexibleAppConfig {
    /** The scene to render */
    scene: SceneDescription;

    /** Available render strategies (will be compiled at initialization) */
    strategies: RenderStrategy[];

    /** Optional HDR environment map URL */
    environmentHDR?: string;

    /** Initial parameter values */
    initialParameters?: Record<string, any>;
}

/**
 * Strategy preset for common rendering configurations
 */
export interface StrategyPreset {
    id: string;
    name: string;
    description?: string;
    strategy: RenderStrategy;
}

/**
 * Built-in strategy presets
 */
export const STRATEGY_PRESETS: Record<string, StrategyPreset> = {
    debug: {
        id: 'debug',
        name: 'Debug',
        description: 'UV visualization for debugging',
        strategy: { id: 'debug', settings: { debugOutput: 'uv' } }
    },
    pathtracer: {
        id: 'pathtracer',
        name: 'Path Tracer',
        description: 'Progressive path tracing',
        strategy: { id: 'pathtracer' }
    },
    'pathtracer-aovs': {
        id: 'pathtracer-aovs',
        name: 'Path Tracer + AOVs',
        description: 'Path tracing with AOV outputs (albedo, normal)',
        strategy: { id: 'pathtracer-aovs' }
    }
};

/**
 * Render progress information
 */
export interface RenderProgress {
    /** Current sample count */
    samples: number;

    /** Frames per second */
    fps: number;

    /** Elapsed time in milliseconds */
    elapsedTime: number;

    /** Current render mode */
    mode: 'interactive' | 'production';

    /** Current render state */
    state: 'rendering' | 'paused' | 'complete' | 'stopped';

    /** Target samples (production mode only) */
    targetSamples?: number;

    /** Percent complete (production mode only) */
    percentComplete?: number;
}

/**
 * Export format specification
 */
export interface ExportFormat {
    /** Export name (e.g., 'hdr', 'ldr', 'albedo') */
    name: string;

    /** File extension */
    extension: string;

    /** MIME type */
    mimeType: string;

    /** Data type returned by readExport */
    dataType: 'float' | 'byte';
}

/**
 * Re-export types from compiler for convenience
 */
export type { RenderStrategy, SceneDescription, CompiledRenderer };
