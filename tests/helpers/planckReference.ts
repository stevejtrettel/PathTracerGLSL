// Independent SI Planck quadrature against the serialized GPU observer. Production
// uses a relative spectrum, generated TS curves and a different quadrature grid.
import { readFileSync } from 'node:fs';
import { spectralCurves } from '../../src/components/color/spectral/lookup.js';
import { spectralData } from '../../src/components/color/spectral/data.js';
import type { Vec3 } from '../../src/compiler/types.js';
const bytes = readFileSync(new URL('../../src/components/color/spectral/data/curves.bin', import.meta.url));
const curves = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
export function planckReference(kelvin: number, scale = 1) {
    const raw = (nm: number) => {
        const lambda = nm * 1e-9;
        return 2 * 6.62607015e-34 * 299792458 ** 2
            / (lambda ** 5 * Math.expm1(6.62607015e-34 * 299792458 / (lambda * 1.380649e-23 * kelvin)));
    };
    const xyz = [0, 0, 0];
    for (let i = 0; i <= 1880; i++) {
        const lambda = 360 + 0.25 * i;
        const response = spectralCurves(lambda, curves);
        const weight = 0.25 / 3 * (i === 0 || i === 1880 ? 1 : i % 2 ? 4 : 2);
        for (let c = 0; c < 3; c++) xyz[c] += weight * raw(lambda) * response[c] / spectralData.cieYIntegral;
    }
    const rgb = spectralData.xyzToRGB.map(row => row.reduce((s, v, c) => s + v * xyz[c], 0)) as Vec3;
    const gain = scale / xyz[1];
    return { rgb: rgb.map(v => v * gain) as Vec3, spectrum: (lambda: number) => gain * raw(lambda) };
}

/** Integrate an evaluated spectrum independently of its normalization implementation. */
export function referenceY(spectrum: (lambda: number) => number): number {
    let integral = 0;
    for (let i = 0; i <= 1880; i++) {
        const lambda = 360 + 0.25 * i;
        const weight = 0.25 / 3 * (i === 0 || i === 1880 ? 1 : i % 2 ? 4 : 2);
        integral += weight * spectrum(lambda) * spectralCurves(lambda, curves)[1];
    }
    return integral / spectralData.cieYIntegral;
}
