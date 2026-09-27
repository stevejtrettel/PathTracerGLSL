import coefficientURL from './data/coefficients.bin?url';
import curveURL from './data/curves.bin?url';
import { spectralData } from './data.js';

export const spectralAssets = [
    { id: `${spectralData.version}-coefficients`, url: coefficientURL, width: spectralData.atlasWidth, height: spectralData.atlasHeight, sha256: spectralData.sha256['coefficients.bin'] },
    { id: `${spectralData.version}-curves`, url: curveURL, width: spectralData.curveWidth, height: spectralData.curveHeight, sha256: spectralData.sha256['curves.bin'] },
];
