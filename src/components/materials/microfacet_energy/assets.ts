// The microfacet energy table as a built-in texture (components/assets.ts): the compiler
// declares it as `extern:<id>`, and the App uploads it after checking its hash.

import energyURL from './data/energy.bin?url';
import { microfacetEnergyData } from './data.js';

export const microfacetEnergyAsset = {
    id: microfacetEnergyData.version,
    url: energyURL,
    width: microfacetEnergyData.width,
    height: microfacetEnergyData.height,
    sha256: microfacetEnergyData.sha256,
};
