import type { ModuleDescriptor } from "../../../engine/types";
import geoFunctions from "./geometric-functions.glsl"

/**
 * Euclidean ambient space module
 * Provides fundamental geometric operations for flat 3D space
 * Pure mathematics with no rendering dependencies
 */
const euclideanAmbient: ModuleDescriptor = {
    id: {
        kind: 'ambient',
        name: 'euclidean',
        version: '1.0.0'
    },

    fragment: {
        functions: geoFunctions
    },

    // exports: [  // Disabled: using GLSL compiler validation instead
    //     'ambient_geodesic',
    //     'ambient_frame',
    //     'ambient_dot',
    //     'ambient_parallel_transport'
    // ]
};

export { euclideanAmbient };
