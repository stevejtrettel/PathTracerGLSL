/**
 * Map module kinds to their function prefixes
 * This is used to determine which module should provide a function
 * based on the function name prefix (e.g., "camera_generateRay" -> camera module)
 */
export const MODULE_PREFIX_MAP: Record<string, string> = {
    ambient: 'ambient',
    environment: 'environment',
    scene: 'scene',
    lighting: 'lighting',
    camera: 'camera',
    interaction: 'interaction',
    transport: 'transport',
    accumulator: 'accumulator',
    developer: 'developer'
};

/**
 * Reverse map: prefix to module kind
 */
export const PREFIX_MODULE_MAP: Record<string, string> =
    Object.fromEntries(
        Object.entries(MODULE_PREFIX_MAP).map(([k, v]) => [v, k])
    );

/**
 * Core functions that must exist for each module kind
 * This helps generate better error messages
 */
export const REQUIRED_FUNCTIONS: Record<string, string[]> = {
    camera: ['camera_generateRay'],
    transport: ['transport_trace'],
    interaction: [
        'interaction_surface_shade',
        'interaction_surface_scatter',
        'interaction_surface_pdf'
    ],
    accumulator: ['accumulator_accumulate'],
    developer: ['developer_develop'],
    // ambient, scene, lighting, environment have context-dependent requirements
};

/**
 * Module categories for system/header sections
 */
export type SystemSection =
    | 'COMMON_STRUCTS'
    | 'ENGINE_UNIFORMS'
    | 'RNG_SYSTEM'
    | 'MAIN_FUNCTION'
    | 'OUTPUT';
