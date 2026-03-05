// app/events.ts
// Centralized event name constants and parameter prefix constants.
// Replaces magic strings throughout the app layer.

/**
 * All event names used by the App event bus.
 */
export const AppEvents = {
    // Render lifecycle
    RENDER_STARTED:     'render.started',
    RENDER_STOPPED:     'render.stopped',
    RENDER_COMPLETE:    'render.complete',
    RENDER_PAUSED:      'render.paused',
    RENDER_RESUMED:     'render.resumed',
    RENDER_PROGRESS:    'render.progress',

    // Accumulation
    ACCUMULATION_RESET: 'accumulation.reset',

    // Parameters
    PARAMETER_CHANGED:  'parameter.changed',

    // Renderer
    RENDERER_SWITCHED:  'renderer.switched',

    // Session
    SESSION_SAVED:      'session.saved',
    SESSION_LOADED:     'session.loaded',

    // Extensions
    EXTENSION_INSTALLED:   'extension.installed',
    EXTENSION_UNINSTALLED: 'extension.uninstalled',

    // Camera (emitted by OrbitControls / KeyboardControls)
    CAMERA_MOVED: 'camera.moved',

    // Tiled rendering
    TILE_START:         'tile.start',
    TILE_COMPLETE:      'tile.complete',
    TILED_JOB_PROGRESS: 'tiledJob.progress',
    TILED_JOB_COMPLETE: 'tiledJob.complete',

    // Cross-extension requests
    PRODUCTION_DIALOG_REQUESTED: 'production.dialogRequested',
} as const;

export type AppEventName = typeof AppEvents[keyof typeof AppEvents];

/**
 * Parameter path prefixes used for accumulation reset decisions.
 */
export const ParamPrefix = {
    CAMERA:    'camera.',
    SCENE:     'scene.',
    MATERIAL:  'material.',
    LIGHT:     'light.',
    DEVELOPER: 'developer.',
    DEBUG:     'debug.',
    RENDERER_DISPLAY_MODE: 'renderer.displayMode',
} as const;

/**
 * Determines whether a parameter change should reset accumulation.
 *
 * Camera, scene, material, and light parameters cause a reset.
 * Developer, debug, and display mode parameters do not.
 * Unknown prefixes reset to be safe.
 */
export function shouldResetAccumulation(path: string): boolean {
    if (path.startsWith(ParamPrefix.DEVELOPER) ||
        path.startsWith(ParamPrefix.DEBUG) ||
        path.startsWith(ParamPrefix.RENDERER_DISPLAY_MODE)) {
        return false;
    }
    if (path.startsWith(ParamPrefix.CAMERA) ||
        path.startsWith(ParamPrefix.SCENE) ||
        path.startsWith(ParamPrefix.MATERIAL) ||
        path.startsWith(ParamPrefix.LIGHT)) {
        return true;
    }
    console.warn(`Unknown parameter prefix: ${path}, resetting accumulation`);
    return true;
}
