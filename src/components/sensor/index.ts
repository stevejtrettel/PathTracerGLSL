// components/sensor/index.ts
// Measurement response, evaluated by the colour model's film projection.
// Ideal RGB and the CIE 1931 observer have distinct, colour-compatible interfaces.

import { cie1931 } from './cie1931/cie1931.js';
import idealGLSL from './ideal/ideal.glsl?raw';

export interface SensorDescriptor {
    id: string;
    colorModels: string[];
    /** Response function for the declared colour models (see README.md). */
    glsl: string;
}

export const SENSORS: Record<string, SensorDescriptor> = {
    cie1931,
    ideal: { id: 'ideal', colorModels: ['rgb'], glsl: idealGLSL },
};
