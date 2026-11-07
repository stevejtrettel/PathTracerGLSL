// White balance (view.tonemap.whiteBalance): the von Kries adaptation in Bradford's cone space
// that maps the white of a Planck source at `kelvin` to the display white, D65. Both programs
// (RGB and spectral) produce linear sRGB with a D65 white, so one 3×3 matrix on linear sRGB
// serves both:
//
//     M = RGB←XYZ · XYZ←LMS · diag(LMS(D65) / LMS(src)) · LMS←XYZ · XYZ←RGB,
//
// with src the XYZ of the blackbody at `kelvin` and both whites at Y = 1, so the blackbody's
// color maps to (1, 1, 1). This is pbrt-v4's WhiteBalance (util/color.h) conjugated into linear
// sRGB. The source white is Planck at every temperature (pbrt uses the CIE daylight locus above
// 4000 K), so a scene lit by `blackbody(T)` lights renders neutral at whiteBalance T. White
// balance is a view: a fixed linear map of each converged pixel, which commutes with the mean.

import { blackbodyColor } from '../color/spectra/blackbody/blackbody.js';
import { spectralData } from '../color/spectral/data.js';

type Matrix3 = readonly (readonly number[])[];

/** Bradford's cone response (pbrt-v4 util/color.h), rows. */
export const LMS_FROM_XYZ: Matrix3 = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
];
/** Its inverse as pbrt-v4 tabulates it (to 1e-6). */
export const XYZ_FROM_LMS: Matrix3 = [
    [0.986993, -0.147054, 0.159963],
    [0.432305, 0.51836, 0.0492912],
    [-0.00852866, 0.0400428, 0.968487],
];

const multiply = (a: Matrix3, b: Matrix3): number[][] =>
    a.map((row) => b[0].map((_, j) => row.reduce((sum, v, k) => sum + v * b[k][j], 0)));
const apply = (a: Matrix3, v: readonly number[]): number[] =>
    a.map((row) => row.reduce((sum, m, k) => sum + m * v[k], 0));

/** The white-balance matrix on linear sRGB, as rows (out = M · in). */
export function whiteBalanceMatrix(kelvin: number): number[][] {
    const source = apply(LMS_FROM_XYZ, blackbodyColor(kelvin).xyz);
    const target = apply(LMS_FROM_XYZ, spectralData.white);
    const adapt = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? target[i] / source[i] : 0)));
    return multiply(spectralData.xyzToRGB,
        multiply(XYZ_FROM_LMS, multiply(adapt, multiply(LMS_FROM_XYZ, spectralData.rgbToXYZ))));
}
