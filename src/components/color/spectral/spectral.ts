import type { ColorModelDescriptor } from '../index.js';
import { spectralData } from './data.js';
import { spectralMediumBound } from './majorant.js';
import { spectralAssets } from './assets.js';
import typesGLSL from './types.glsl?raw';
import glsl from './spectral.glsl?raw';
import supportGLSL from './lookup.glsl?raw';
import uniform from './uniform.glsl?raw';
import visible from './visible.glsl?raw';

export const spectral: ColorModelDescriptor = {
    id: 'spectral', version: spectralData.version, defaultSensor: 'cie1931',
    typesGLSL, glsl, supportGLSL, mediumBound: spectralMediumBound,
    wavelengthSamplers: { uniform, visible }, defaultWavelengthSampler: 'visible',
    textures: ['u_spectralCoefficients', 'u_spectralCurves'].map((name, i) => ({ name, source: `extern:${spectralAssets[i].id}`, precision: 'highp' })),
};
