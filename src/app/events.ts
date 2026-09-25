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
    /** A frame threw; the loop has stopped. Payload: { error: Error }. */
    RENDER_ERROR:       'render.error',

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
 * Fallback reset heuristic (E4): used ONLY when a parameter carries no compiled
 * ParameterMetadata (App._triggersReset prefers metadata.triggersReset). ONE prefix
 * vocabulary — the compiler's RESERVED_PARAM_PREFIXES — replaces the app's drifted
 * private list (which predated the current architecture: 'developer.'/'scene.'/
 * 'material.'/'light.' matched nothing, and missing 'env.' spammed a bogus warning
 * on every HDR-environment scene load).
 *   debug./renderer. — developer surfaces: never reset.
 *   engine./env.     — compiler-owned plumbing (sizes, table totals): their metadata-less
 *                      members are load-time data; resets ride renderer loads instead.
 *   everything else  — scene-affecting (camera.*, object-named params): reset.
 */
export function shouldResetAccumulation(path: string): boolean {
    if (path.startsWith('debug.') || path.startsWith('renderer.')) return false;
    if (path.startsWith('engine.') || path.startsWith('env.')) return false;
    return true;
}
