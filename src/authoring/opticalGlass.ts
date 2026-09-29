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

/** SCHOTT N-SF11, a dense flint (lead-free): n_d = 1.78472, Abbe number V_d = 25.68, so its
 * index spreads about four times as much across the visible as N-BK7's. Nominal relative index
 * at room temperature; no absorption model. Source: SCHOTT Zemax catalog 2017-01-20b, as
 * published at https://refractiveindex.info/?shelf=specs&book=SCHOTT-optical&page=N-SF11 ;
 * the data covers 370–2500 nm, so 360–370 nm is an extrapolation.
 * B is dimensionless; C is in micrometres². */
export const N_SF11: SellmeierIndex = {
    sellmeier: {
        B: [1.73759695, 0.313747346, 1.89878101],
        C: [0.013188707, 0.0623068142, 155.23629],
    },
};
