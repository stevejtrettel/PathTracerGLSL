import type { ColorModelDescriptor } from '../../../src/components/color/index.js';
import typesGLSL from './types.glsl?raw';
import glsl from './rgCanary.glsl?raw';

export const rgCanary: ColorModelDescriptor = { id: 'rg-canary', defaultSensor: 'ideal', typesGLSL, glsl };
