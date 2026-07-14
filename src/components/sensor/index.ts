// components/sensor/index.ts
// Sensor registry (measurement pick-one family — the importance We factor of the pixel
// measurement `I_j = ∫ h_j · We · L`). We is the adjoint of a light's Le; this family is
// the measurement functional `sensor ∘ camera ∘ pixel` made explicit. An occupant provides
//   Spectrum sensor_response(vec2 film, Direction ray_dir);
// and the accumulator main() applies it: `color = sensor_response(film, ray.direction) *
// transport_trace(ray)`.
//
// Sole occupant today (`ideal`, We ≡ 1 — the seam is inert by design). No strategy field
// yet (the "no field until a second occupant" rule); the knob arrives with the first real
// sensor (exposure / vignette / spectral). Included by core.ts, like the sampler.

import idealGLSL from './ideal/ideal.glsl?raw';

export interface SensorDescriptor {
    id: string;
    /** ?raw source providing `Spectrum sensor_response(vec2 film, Direction ray_dir)`. */
    glsl: string;
}

export const SENSORS: Record<string, SensorDescriptor> = {
    ideal: { id: 'ideal', glsl: idealGLSL },
};
