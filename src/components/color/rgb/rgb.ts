import type { ColorModelDescriptor } from '../index.js';
import typesGLSL from './types.glsl?raw';
import glsl from './rgb.glsl?raw';

export const rgb: ColorModelDescriptor = { id: 'rgb', typesGLSL, glsl };
