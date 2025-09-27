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


        types: `
      #define Point vec3
      #define Direction vec3
    `,

        functions: geoFunctions
    },

    exports: [
        'ambient_geodesic',
        'ambient_frame',
        'ambient_dot',
        'ambient_parallel_transport'
    ]
};

export { euclideanAmbient };
