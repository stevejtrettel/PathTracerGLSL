// components/sensor/index.ts
// Measurement response, evaluated by the colour model's film projection.
// The ideal RGB sensor is the only implemented occupant.

import idealGLSL from './ideal/ideal.glsl?raw';

export interface SensorDescriptor {
    id: string;
    /** ?raw source providing `Spectrum sensor_response(vec2 film, Direction ray_dir)`. */
    glsl: string;
}

export const SENSORS: Record<string, SensorDescriptor> = {
    ideal: { id: 'ideal', glsl: idealGLSL },
};
