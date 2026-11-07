// Witnesses for the conductor materials (conductor, rough_conductor) and the measured kind.
//
// conductor-gold: smooth gold (the pbrt-v4 tables) under a unit white sky, one bounce, seen by
// an orthographic camera looking down −z, so every pixel of a quad has the same incidence:
//   - left quad, normal +z: cos θᵢ = 1;
//   - right quad, normal (sin 70°, 0, cos 70°): cos θᵢ = cos 70°. Its reflected rays leave toward
//     +x and −z, away from the left quad, and reach the sky.
// The spectral sky is D65, so a pixel reads the daylight projection of F(cos θᵢ; η(λ), κ(λ)),
// which is d65StandIn of the conductor Fresnel term of the tables. The RGB program reads F at the
// stand-in η and κ. The 70° arm is the check on conductor_fresnel's angular terms (r_p, s⁴, c²):
// at normal incidence F reduces to ((η−1)² + κ²)/((η+1)² + κ²). Gold's red channel reads above 1
// in the spectral program (outside the sRGB gamut), which also checks that nothing clamps it.
// The expected values come from conductorFresnel (materials/conductor/fresnel.ts), which
// rough_conductor.test.ts checks against pbrt-v4's complex FrComplex.
//
// conductor-perfect ⇄ conductor-perfect-ref: the veach-mis plates and one sphere. The test arm
// uses rough_conductor plates and a conductor sphere with η = 0, κ = 1, where F ≡ 1; the
// reference uses ggx plates and a mirror sphere with f0 = 1, where Schlick's F ≡ 1 too. The two
// draw the same random numbers through the same lobe, so they must agree to float rounding: a
// check of the new models' sample, eval, pdf, MIS weights and NEE guard against two witnessed
// models.
//
// veach-metals: the veach-mis plates as rough gold, copper, aluminium and silver (measured), in
// RGB (pt-mis, pt-nee, pt) and spectral (pt-mis, pt-nee) programs: the estimators agree.

import type { SceneDescription, RenderStrategy, Vec3 } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';
import { d65StandIn } from '../../../src/components/color/spectra/standIn.js';
import { measuredKind, measuredValue } from '../../../src/components/color/spectra/measured/measured.js';
import { conductorFresnel } from '../../../src/components/materials/conductor/fresnel.js';
import { veachMis, veachMisStrategy, veachNeeStrategy, veachPtStrategy } from './ggxScenes.js';

const metal = (m: string) => ({ eta: { measured: `metal-${m}-eta` }, k: { measured: `metal-${m}-k` } });

// ── conductor-gold ─────────────────────────────────────────────────────────────

const TILT = 70 * Math.PI / 180;
const COS_TILT = Math.cos(TILT);

/** The pixel a unit white sky gives at incidence cosine c: spectral and RGB. */
function goldSpectral(c: number): Vec3 {
    return d65StandIn((l) => conductorFresnel(c, measuredValue('metal-Au-eta', l), measuredValue('metal-Au-k', l)));
}
function goldRGB(c: number): Vec3 {
    const eta = measuredKind.toRGB({ measured: 'metal-Au-eta' }, 'optical', {}) as Vec3;
    const k = measuredKind.toRGB({ measured: 'metal-Au-k' }, 'optical', {}) as Vec3;
    return [0, 1, 2].map((ch) => conductorFresnel(c, eta[ch], k[ch])) as Vec3;
}
export const GOLD_EXPECTED = {
    spectral: { normal: goldSpectral(1), tilted: goldSpectral(COS_TILT) },
    rgb: { normal: goldRGB(1), tilted: goldRGB(COS_TILT) },
};

const SLOPE = 0.55 / COS_TILT;   // the tilted quad spans x ∈ [0.05, 0.6] in projection
const goldScene: SceneDescription = {
    id: 'conductor-gold', name: 'Smooth gold at 0° and 70° (orthographic, unit sky)', ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'quad', parameters: { corner: [-0.6, -0.6, 0], edge1: [0.55, 0, 0], edge2: [0, 1.2, 0] }, material: 'gold', name: 'facing' },
        // edge1 runs down the slope; cross(edge1, edge2) = (sin 70°, 0, cos 70°)·|edge1|·1.2.
        { type: 'quad', parameters: { corner: [0.05, -0.6, 0], edge1: [SLOPE * COS_TILT, 0, -SLOPE * Math.sin(TILT)], edge2: [0, 1.2, 0] }, material: 'gold', name: 'tilted' },
    ],
    materials: { gold: { model: 'conductor', ...metal('Au') } },
    lights: [],
    environment: { type: 'constant', color: 1, sampleAsLight: true },
};

const goldStrategy = (id: string, color: 'rgb' | 'spectral', directLighting: 'none' | 'mis'): RenderStrategy => ({
    id,
    measurement: {
        color, camera: { type: 'orthographic', scale: 0.4, position: [0, 0, 2], target: [0, 0, -3] }, maxBounces: 1,
    },
    estimator: { ...(color === 'spectral' ? { wavelengths: 'visible' as const } : {}), directLighting, russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'none' } },
});
const goldStrategies = [
    goldStrategy('spectral-pt', 'spectral', 'none'),
    goldStrategy('spectral-pt-mis', 'spectral', 'mis'),
    goldStrategy('pt-mis', 'rgb', 'mis'),
    goldStrategy('pt', 'rgb', 'none'),
];
/** Frame regions (fractions, origin bottom-left; film ±0.533 × ±0.4), inside each quad. */
const GOLD_REGIONS = { normal: { x: 0.05, y: 0.1, w: 0.35, h: 0.8 }, tilted: { x: 0.6, y: 0.1, w: 0.35, h: 0.8 } };

// ── conductor-perfect ⇄ conductor-perfect-ref ─────────────────────────────────

const sphere = { type: 'sphere' as const, parameters: { center: [1.3, 0, 2.4] as Vec3, radius: 0.3 }, material: 'ball' };
const plates = ['plate1', 'plate2', 'plate3', 'plate4'];
const roughnessOf = (plate: string) => (veachMis.materials[plate] as { roughness: number }).roughness;

const perfect: SceneDescription = {
    ...veachMis, id: 'conductor-perfect', name: 'Veach plates and a ball, rough_conductor and conductor with F ≡ 1',
    objects: [...veachMis.objects, sphere],
    materials: {
        ...veachMis.materials,
        ...Object.fromEntries(plates.map((p) => [p, { model: 'rough_conductor', eta: 0, k: 1, roughness: roughnessOf(p) }])),
        ball: { model: 'conductor', eta: 0, k: 1 },
    },
};
const perfectRef: SceneDescription = {
    ...veachMis, id: 'conductor-perfect-ref', name: 'Veach plates and a ball, ggx and mirror with f0 = 1',
    objects: [...veachMis.objects, sphere],
    materials: {
        ...veachMis.materials,
        ...Object.fromEntries(plates.map((p) => [p, { model: 'ggx', f0: 1, roughness: roughnessOf(p) }])),
        ball: { model: 'mirror', f0: 1 },
    },
};

const VEACH_POSE = { position: [0, 1.3, 5.5] as Vec3, target: [0, 0.55, 0] as Vec3 };
const posed = (s: RenderStrategy, color: 'rgb' | 'spectral' = 'rgb', id = s.id): RenderStrategy => ({
    ...s, id,
    measurement: { ...s.measurement, color, camera: { ...s.measurement.camera, ...VEACH_POSE } as RenderStrategy['measurement']['camera'] },
});
const perfectStrategies = [posed(veachMisStrategy), posed(veachNeeStrategy), posed(veachPtStrategy)];

// ── veach-metals ───────────────────────────────────────────────────────────────

const PLATE_METALS = ['Au', 'Cu', 'Al', 'Ag'];
const metals: SceneDescription = {
    ...veachMis, id: 'veach-metals', name: 'Veach MIS with measured metal plates (Au, Cu, Al, Ag)',
    materials: {
        ...veachMis.materials,
        ...Object.fromEntries(plates.map((p, i) => [p, { model: 'rough_conductor', ...metal(PLATE_METALS[i]), roughness: roughnessOf(p) }])),
    },
};
const metalsStrategies = [
    posed(veachMisStrategy), posed(veachNeeStrategy), posed(veachPtStrategy),
    posed(veachMisStrategy, 'spectral', 'spectral-pt-mis'), posed(veachNeeStrategy, 'spectral', 'spectral-pt-nee'),
];

export const conductorSuite: Record<string, SceneSuiteEntry> = {
    [goldScene.id]: {
        scene: goldScene, strategies: goldStrategies,
        exercises: 'conductor with measured gold: conductor_fresnel at normal incidence and at 70° (the angular terms), per wavelength lane in spectral programs and at the RGB stand-ins; keys 1–4 = spectral pt, spectral pt-mis, pt-mis, pt',
        expected: `left quad (0°) and right quad (70°): spectral (${GOLD_EXPECTED.spectral.normal.map((x) => x.toFixed(4))}) and (${GOLD_EXPECTED.spectral.tilted.map((x) => x.toFixed(4))}); RGB (${GOLD_EXPECTED.rgb.normal.map((x) => x.toFixed(4))}) and (${GOLD_EXPECTED.rgb.tilted.map((x) => x.toFixed(4))})`,
        witness: {
            spp: 256,
            checks: goldStrategies.flatMap((s, strategy) => {
                const expected = s.measurement.color === 'spectral' ? GOLD_EXPECTED.spectral : GOLD_EXPECTED.rgb;
                const source = { tier: 'exact' as const, from: 'conductorFresnel (twin of conductor_fresnel, checked against pbrt-v4 FrComplex in rough_conductor.test.ts) of the pbrt-v4 gold tables' };
                return [
                    { kind: 'mean' as const, strategy, value: expected.normal, tol: 0.006, region: GOLD_REGIONS.normal, source, label: `gold at 0° (key ${strategy + 1})` },
                    { kind: 'mean' as const, strategy, value: expected.tilted, tol: 0.006, region: GOLD_REGIONS.tilted, source, label: `gold at 70° (key ${strategy + 1})` },
                ];
            }),
        },
    },
    [perfectRef.id]: {
        scene: perfectRef, strategies: perfectStrategies,
        exercises: 'reference arm of the conductor-perfect twin: ggx plates and a mirror ball with f0 = 1',
    },
    [perfect.id]: {
        scene: perfect, strategies: perfectStrategies,
        exercises: 'rough_conductor plates and a conductor ball with η = 0, κ = 1 (F ≡ 1) against ggx and mirror with f0 = 1: sample, eval, pdf, MIS and the NEE guard of both new models; keys 1–3 = pt-mis, pt-nee, pt',
        expected: 'pixel-identical to conductor-perfect-ref on every key (the same lobe, the same random numbers, F = 1 in both)',
        witness: {
            spp: 64,
            checks: perfectStrategies.map((_, strategy) => ({
                kind: 'twin' as const, strategy, other: { scene: perfectRef.id, strategy }, meanTol: 0.002, rmse: 0.01,
                label: `F ≡ 1 conductors ≡ ggx/mirror with f0 = 1 (key ${strategy + 1})`,
            })),
        },
    },
    [metals.id]: {
        scene: metals, strategies: metalsStrategies,
        exercises: 'rough_conductor with measured gold, copper, aluminium and silver plates under the Veach MIS lights; keys 1–3 = pt-mis, pt-nee, pt (RGB), keys 4–5 = spectral pt-mis, pt-nee',
        expected: 'within each color model the estimators converge to the same image; the plates show gold, copper, aluminium and silver tints',
        witness: {
            spp: 256,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.03, label: 'metals mis ≡ nee (RGB)' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.03, rmse: 1.2, label: 'metals pt tripwire (RGB)' },
                { kind: 'equality', strategies: [3, 4], meanTol: 0.03, label: 'metals mis ≡ nee (spectral)' },
            ],
        },
    },
};
