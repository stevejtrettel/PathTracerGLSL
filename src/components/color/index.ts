import { rgb } from './rgb/rgb.js';

export interface ColorModelDescriptor {
    id: string;
    /** Spectrum and camera-sample types, included before the core structs. */
    typesGLSL: string;
    /** Wavelength sampling and projection to linear-sRGB film values. */
    glsl: string;
}

export const COLOR_MODELS: Record<string, ColorModelDescriptor> = { rgb };
