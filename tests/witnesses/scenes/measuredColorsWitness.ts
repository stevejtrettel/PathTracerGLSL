// Witnesses for the measured kind's reflectances and illuminants (color/spectra/measured).
//
// spectral-colorchecker-d65: a Lambert plane with the ColorChecker 'orange' patch under a sky of
// the measured CIE D65 table at scale 1 (unit reference Y), one bounce. The spectral pixel is
// M ∫ ρ · E · x̄ dλ / ∫ ȳ dλ with E the normalized table: unitLuminanceStandIn of ρ·D65 (whose
// 0.5 nm Simpson rule is exact for these piecewise-linear products, all knots at multiples of
// 5 nm) rescaled from unit Y to the product's own Y. The RGB program renders the product of the
// two stand-ins: the patch's D65 projection times the sky's unit-luminance RGB, (1, 1, 1) to
// 1e-5. tests/components/measured.test.ts checks the patch stand-ins against colour-science and
// the normalization against an independent quadrature; this fixture cannot read that file,
// since it also runs in the browser gallery.
//
// spectral-measured-lamps: two quad lamps, CIE A and FL11, over a neutral plane. Power selection
// reads each lamp's spectrum from its generated light function, the light tree from the lamp's
// table-row header (the kind's packed form); NEE and MIS under both must agree pixel by pixel.
// A row read with the wrong table or gain would change the lamps' colors.

import type { SceneDescription, RenderStrategy, MeasuredValue, Vec3 } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';
import { measuredKind, measuredValue, measuredEmission } from '../../../src/components/color/spectra/measured/measured.js';
import { unitLuminanceStandIn } from '../../../src/components/color/spectra/standIn.js';

const m = (table: string, scale?: number): MeasuredValue => ({ measured: scale === undefined ? { table } : { table, scale } });
const PATCH = 'colorchecker-orange';

function spectralExpected(): Vec3 {
    const product = unitLuminanceStandIn(l => measuredValue(PATCH, l) * measuredValue('illuminant-D65', l));
    const gain = measuredEmission('illuminant-D65').normalization / product.normalization;
    return product.rgb.map(c => c * gain) as Vec3;
}
function rgbExpected(): Vec3 {
    const patch = measuredKind.toRGB(m(PATCH), 'reflectance', {}) as Vec3;
    const sky = measuredEmission('illuminant-D65').rgb;
    return patch.map((c, i) => Math.min(1, Math.max(0, c)) * sky[i]) as Vec3;
}

function strategy(color: 'rgb' | 'spectral', directLighting: 'none' | 'nee' | 'mis', maxBounces: number): RenderStrategy {
    return {
        id: `${color}-${directLighting}`,
        measurement: { color, camera: { type: 'pinhole', fov: 0.8, position: [0, 0, 0], target: [0, 0, -1] }, maxBounces },
        estimator: { ...(color === 'spectral' ? { wavelengths: 'visible' as const } : {}), directLighting, russianRoulette: null, accumulation: { type: 'average' } },
        view: { tonemap: { type: 'none' } },
    };
}

const plane: SceneDescription = {
    id: 'spectral-colorchecker-d65', name: 'ColorChecker orange under a measured D65 sky', ambientSpace: { type: 'euclidean' },
    objects: [{ type: 'plane', parameters: { normal: [0, 0, 1], offset: 1 }, material: 'plane' }],
    materials: { plane: { model: 'lambert', albedo: m(PATCH) } }, lights: [],
    environment: { type: 'constant', color: m('illuminant-D65'), sampleAsLight: true },
};
const planeStrategies = [strategy('spectral', 'none', 1), strategy('spectral', 'mis', 1), strategy('rgb', 'mis', 1)];
const planeExpected = [spectralExpected(), spectralExpected(), rgbExpected()];

const lamps: SceneDescription = {
    id: 'spectral-measured-lamps', name: 'Measured CIE A and FL11 lamps over a neutral plane', ambientSpace: { type: 'euclidean' },
    objects: [{ type: 'plane', parameters: { normal: [0, 0, 1], offset: 0 }, material: 'plane' }],
    materials: { plane: { model: 'lambert', albedo: m('colorchecker-neutral-8') } },
    lights: [
        // One-sided quads emit along edge1 × edge2 = −z, down onto the plane.
        { kind: 'quad', corner: [-1.2, -0.4, 1], edge1: [0, 0.8, 0], edge2: [0.8, 0, 0], emission: m('illuminant-A', 6) },
        { kind: 'quad', corner: [0.4, -0.4, 1], edge1: [0, 0.8, 0], edge2: [0.8, 0, 0], emission: m('illuminant-FL11', 6) },
    ],
};
const lampStrategies: RenderStrategy[] = (['power', 'bvh'] as const).flatMap(lightSelection => (['nee', 'mis'] as const).map(directLighting => ({
    id: `${lightSelection}-${directLighting}`,
    measurement: { color: 'spectral' as const, maxBounces: 1,
        camera: { type: 'pinhole' as const, fov: 1.2, position: [0, -1.6, 1.4] as Vec3, target: [0, 0, 0] as Vec3 } },
    estimator: { wavelengths: 'visible' as const, directLighting, lightSelection, russianRoulette: null, accumulation: { type: 'average' as const } },
    view: { tonemap: { type: 'none' as const } },
})));

export const measuredColorsSuite: Record<string, SceneSuiteEntry> = {
    [plane.id]: {
        scene: plane, strategies: planeStrategies,
        exercises: 'Measured ColorChecker reflectance under a measured D65 sky: exact spectral evaluation of both tables, and their RGB stand-ins',
        witness: { size: [32, 32], spp: 256, checks: planeStrategies.map((_, strategy) => ({
            kind: 'mean' as const, strategy, value: planeExpected[strategy], tol: 0.006,
            source: { tier: 'exact' as const, from: 'unitLuminanceStandIn of the patch × D65 product (spectral) and the stand-ins (RGB); stand-ins checked against colour-science in tests/components/measured.test.ts' },
            label: strategy < 2 ? 'patch × D65, spectral' : 'stand-ins, RGB' })) },
    },
    [lamps.id]: {
        scene: lamps, strategies: lampStrategies,
        exercises: 'Measured illuminants on quad lamps: power selection (light functions) and the light tree (packed row headers) agree under NEE and MIS',
        witness: { size: [40, 30], spp: 512, checks: [
            { kind: 'equality', strategies: [0, 1, 2, 3], meanTol: 0.02, label: 'power/tree NEE/MIS' },
        ] },
    },
};
