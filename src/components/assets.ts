// Built-in immutable textures, keyed by the external references declared by components.
import { spectralAssets } from './color/spectral/assets.js';
import { microfacetEnergyAsset } from './materials/microfacet_energy/assets.js';

export interface BuiltinAsset {
    id: string;
    url: string;
    width: number;
    height: number;
    sha256: string;
}
export const BUILTIN_ASSETS: ReadonlyMap<string, BuiltinAsset> = new Map([...spectralAssets, microfacetEnergyAsset].map(a => [a.id, a]));
