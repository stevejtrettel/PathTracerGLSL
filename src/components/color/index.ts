import type { PlannedTexture } from '../../compiler/generate/features/types.js';
import { spectral } from './spectral/spectral.js';
import { rgb } from './rgb/rgb.js';

export interface ColorModelDescriptor {
    id: string;
    defaultSensor: string;
    /** RGB extinction ceiling and a sampling rate bounding its reconstructed spectrum. */
    mediumBound(ceiling: number): { ceiling: number; majorant: number };
    version?: string;
    /** Helpers required before the sensor response is defined. */
    supportGLSL?: string;
    textures?: PlannedTexture[];
    wavelengthSamplers?: Record<string, string>;
    defaultWavelengthSampler?: string;
    /** Spectrum and camera-sample types, included before the core structs. */
    typesGLSL: string;
    /** Wavelength sampling and projection to linear-sRGB film values. */
    glsl: string;
}

export const COLOR_MODELS: Record<string, ColorModelDescriptor> = { rgb, spectral };

/** Sampling is an estimator choice; representation and sensor remain measurement choices. */
export function resolveWavelengthSampler(model: ColorModelDescriptor, requested?: string): string | undefined {
    return model.wavelengthSamplers ? requested ?? model.defaultWavelengthSampler : undefined;
}
