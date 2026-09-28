import type { SellmeierIndex } from '../compiler/types.js';

/** SCHOTT N-BK7, nominal relative index at room temperature; no absorption model.
 * Source: Dec 1, 2023 datasheet, with index data from 312.6 to 2325.4 nm.
 * https://media.schott.com/api/public/content/41e799d0bf874807a0bb8e702fbb75b5?v=54856406
 * B is dimensionless; C is in micrometres². */
export const N_BK7: SellmeierIndex = {
    sellmeier: {
        B: [1.039612120, 0.231792344, 1.010469450],
        C: [0.006000699, 0.0200179144, 103.56065300],
    },
};
