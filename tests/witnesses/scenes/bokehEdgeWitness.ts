// The thin lens's pupil shape, measured through a defocused edge (camera thinlens: the disk and
// bladed pupils).
//
// A thin lens at the origin looks down −z (right = +x): fov 0.8, aperture R = 0.5, focus
// distance F = 2, 160×120, box pixel filter. One emissive half-plane (Le = 1, black environment,
// maxBounces 0) covers x < −R/2 at depth 2F = 4. A ray from the lens point p through the focus
// point of film offset s (the pixel ray's x on the focus plane) reaches depth 2F at x = 2s − p_x,
// so a pixel reads the fraction of its pupil with p_x > R/2 + 2s, averaged over the pixel.
// Columns 79 and 80 straddle the image center, where s ≈ 0, so their mean is near the fraction
// of the pupil beyond x = R/2: (θ − sin θ cos θ)/π = 0.195501 (cos θ = ½) for the disk and 1/6
// for a hexagon with a vertex on +x (blades 6, bladeRotation 0). The expected values below are
// exact in p and integrate s over the two columns' box footprints; they lie 0.0002 (disk) and
// 0.0004 (hexagon) above those center fractions.
//
// The hexagon checks the n-gon's area but hardly its orientation (a flat side on +x reads 0.1709
// against 0.1670). The triangle arm (blades 3, bladeRotation 0.4) checks the rotation: it reads
// 0.0994, against 0.1116 if the rotation were ignored and 0.0774 if it were off by π/3 (the
// Cycles convention, vertices at rotation ± π/n). A mirror image of the pupil in y reads the same,
// so the sign of the rotation is pinned by the twin test (tests/components/aperturePolygon.test.ts).
//
// One region covers exactly columns 79 and 80: the runner floors x0 = 79.25 and ceils x1 = 80.75.
// Either column alone is about 0.015 off the pooled value, since s cancels only between them.
// Noise: 240 pixels × 1024 spp of a Bernoulli p ≤ 0.2 give a σ of 0.0008 at most for the
// region mean; tol 0.006 is 7.5 σ.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry, WitnessRegion } from '../types.js';
import { regularPolygon, clipHalfPlane, polygonArea } from '../../helpers/convexPolygon.js';

const W = 160, H = 120, FOV = 0.8, R = 0.5, F = 2;

const scene: SceneDescription = {
    id: 'bokeh-edge',
    name: 'Defocused edge through the lens pupil',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // Emitting side cross(edge1, edge2) = +z, toward the camera.
        { type: 'quad', parameters: { corner: [-50, -50, -2 * F], edge1: [50 - R / 2, 0, 0], edge2: [0, 100, 0] }, material: 'panel' },
    ],
    materials: { panel: { model: 'lambert', albedo: 0, emission: 1, sampleAsLight: false } },
    lights: [],
    environment: { type: 'none' },
};

function strategy(id: string, blades: Record<string, number>): RenderStrategy {
    return {
        id,
        measurement: {
            camera: { type: 'thinlens', fov: FOV, aperture: R, focusDistance: F, position: [0, 0, 0], target: [0, 0, -1], ...blades },
            maxBounces: 0,
        },
        estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
        view: { tonemap: { type: 'none' } },
    };
}

/** Fraction of the disk of radius R with x > t. */
function diskBeyond(t: number): number {
    if (t >= R) return 0;
    if (t <= -R) return 1;
    const theta = Math.acos(t / R);
    return (theta - Math.sin(theta) * Math.cos(theta)) / Math.PI;
}

/** Fraction of the regular n-gon (circumradius R, a vertex at `rotation`) with x > t. */
function polygonBeyond(n: number, rotation: number): (t: number) => number {
    const polygon = regularPolygon(n, rotation, R);
    return (t) => polygonArea(clipHalfPlane(polygon, 1, 0, t)) / polygonArea(polygon);
}

/** The mean over columns 79–80: film x uniform on [79, 81], s its focus-plane offset. */
function pooledMean(beyond: (t: number) => number): number {
    const n = 20000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
        const filmX = 79 + 2 * (i + 0.5) / n;
        const s = (2 * filmX / W - 1) * (W / H) * Math.tan(FOV / 2) * F;
        sum += beyond(R / 2 + 2 * s);
    }
    return sum / n;
}

const centerColumns: WitnessRegion = { x: 79.25 / W, w: 1.5 / W, y: 0, h: 1 };
const TRIANGLE_ROTATION = 0.4;
const disk = pooledMean(diskBeyond);
const hexagon = pooledMean(polygonBeyond(6, 0));
const triangle = pooledMean(polygonBeyond(3, TRIANGLE_ROTATION));
const tol = 0.006;

export const bokehEdgeSuite: Record<string, SceneSuiteEntry> = {
    'bokeh-edge': {
        scene,
        strategies: [
            strategy('disk', {}),
            strategy('hexagon', { blades: 6, bladeRotation: 0 }),
            strategy('triangle', { blades: 3, bladeRotation: TRIANGLE_ROTATION }),
        ],
        exercises:
            'the thin-lens pupil: the disk (key 1), a six-bladed iris with a vertex on camera right (key 2) and a three-bladed one rotated by 0.4 rad (key 3), read as the fraction of the pupil that sees a defocused emissive edge at twice the focus distance',
        expected:
            `columns 79–80 read ${disk.toFixed(6)} (disk), ${hexagon.toFixed(6)} (hexagon), ${triangle.toFixed(6)} (triangle)`,
        witness: {
            size: [W, H],
            spp: 1024,
            checks: [
                { kind: 'mean', strategy: 0, region: centerColumns, value: disk, tol, label: 'disk: columns 79–80 = segment fraction beyond R/2' },
                { kind: 'mean', strategy: 1, region: centerColumns, value: hexagon, tol, label: 'hexagon: columns 79–80 = cap fraction beyond R/2' },
                { kind: 'mean', strategy: 2, region: centerColumns, value: triangle, tol, label: 'triangle at 0.4 rad: columns 79–80 = its part beyond R/2' },
            ],
        },
    },
};
