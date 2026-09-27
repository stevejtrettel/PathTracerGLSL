import type { SensorDescriptor } from '../index.js';
import { spectralData } from '../../color/spectral/data.js';
import source from './cie1931.glsl?raw';

const m = spectralData.xyzToRGB;
const columns = [0, 1, 2].flatMap(j => m.map(row => row[j]));
export const cie1931: SensorDescriptor = {
    id: 'cie1931', colorModels: ['spectral'],
    glsl: `const mat3 CIE_XYZ_TO_RGB = mat3(${columns.join(', ')});\nconst float CIE_Y_INTEGRAL = ${spectralData.cieYIntegral};\n${source}`,
};
