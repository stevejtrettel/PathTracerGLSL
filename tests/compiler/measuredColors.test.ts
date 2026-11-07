// Measured reflectances and illuminants as the compiler sees them: what a program links in each
// color model, and how a light-table row carries a measured illuminant under the light tree.

import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { RenderStrategy, SceneDescription, MeasuredValue } from '../../src/compiler/types.js';
import { packLightTable, lightTableLayout } from '../../src/components/lights/table.js';
import { measuredNames, measuredEmission, measuredKind } from '../../src/components/color/spectra/measured/measured.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

const compiler = new Compiler();
const m = (table: string, scale?: number): MeasuredValue => ({ measured: scale === undefined ? { table } : { table, scale } });

function strategy(color: 'rgb' | 'spectral', lightSelection: 'power' | 'bvh' = 'power'): RenderStrategy {
    return { ...minimalStrategy, id: `${color}-${lightSelection}`,
        measurement: { ...minimalStrategy.measurement, color },
        estimator: { ...minimalStrategy.estimator, lightSelection } };
}
const main = (s: SceneDescription, st: RenderStrategy) => {
    const compiled = compiler.compile(s, st);
    return { id: `${compiled.id}-main`, fragment: compiled.shaders.get(`${compiled.id}-main`)!.fragment };
};

// A ColorChecker sphere under a D65 sky, lit by two quad lights (FL11 and LED-B3).
const scene: SceneDescription = {
    ...minimalScene, id: 'measured-colors',
    materials: { ...minimalScene.materials, sphere: { model: 'lambert', albedo: m('colorchecker-orange') } },
    lights: [
        { kind: 'quad', corner: [-1.5, 3, -0.5], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: m('illuminant-FL11', 4) },
        { kind: 'quad', corner: [0.5, 3, -0.5], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: m('illuminant-LED-B3', 2) },
    ],
    environment: { type: 'constant', color: m('illuminant-D65', 0.2) },
};
const helpers = (fragment: string) => [...fragment.matchAll(/^Spectrum (measured_\w+)\(Wavelengths wl\)/gm)].map(x => x[1]);

describe('measured reflectances and illuminants', () => {
    it('spectral: links one helper per table in use, and reads the illuminants at unit luminance times scale', () => {
        const { id, fragment } = main(scene, strategy('spectral'));
        expect(helpers(fragment)).toEqual(['measured_colorchecker_orange', 'measured_illuminant_D65', 'measured_illuminant_FL11', 'measured_illuminant_LED_B3']);
        expect(fragment).toContain('measured_colorchecker_orange(wl)');
        expect(fragment).toMatch(/\(4\.0 \* [0-9.e-]+ \* measured_illuminant_FL11\(wl\)\)/);
        glslangCheck(fragment, 'frag', id);
    }, 30000);

    it('RGB: every measured value is its stand-in; no helper is linked', () => {
        const { id, fragment } = main(scene, strategy('rgb'));
        expect(helpers(fragment)).toEqual([]);
        expect(fragment).not.toContain('measured_');
        glslangCheck(fragment, 'frag', id);
    }, 30000);

    it('light tree, spectral: a row tagged 2 reads its illuminant from the header; only the illuminants in light rows and the sky are among the arms', () => {
        const { id, fragment } = main(scene, strategy('spectral', 'bvh'));
        const fl11 = measuredNames.indexOf('illuminant-FL11'), d65 = measuredNames.indexOf('illuminant-D65');
        expect(fragment).toContain(`(int(emissionHeader.y) == 2 ? (emissionHeader.w * (int(emissionHeader.z) == ${d65} ? measured_illuminant_D65(wl) : (int(emissionHeader.z) == ${fl11} ? measured_illuminant_FL11(wl) : measured_illuminant_LED_B3(wl)))) : `);
        glslangCheck(fragment, 'frag', id);
    }, 30000);

    it('light tree, spectral, no measured illuminant in the program: no measured arm', () => {
        const plain: SceneDescription = { ...scene, lights: minimalScene.lights, environment: minimalScene.environment };
        const { fragment } = main(plain, strategy('spectral', 'bvh'));
        expect(helpers(fragment)).toEqual(['measured_colorchecker_orange']);
        expect(fragment).not.toContain('emissionHeader');
    });

    it('packs the measured tag, the table index and scale × normalization beside the RGB payload', () => {
        const values = { position: [1, 2, 3], intensity: [4, 5, 6] };
        const table = packLightTable([
            { kind: 'point', values },
            { kind: 'point', values, emission: m('illuminant-A', 3) },
        ], lightTableLayout(['point']));
        expect(Array.from(table.slice(12, 14))).toEqual([0, 2]);
        expect(measuredNames[table[14]]).toBe('illuminant-A');
        expect(table[15]).toBeCloseTo(3 * measuredEmission('illuminant-A').normalization, 6);
        expect(Array.from(table.slice(16, 22))).toEqual([1, 2, 3, 4, 5, 6]);
        expect(measuredKind.packed!.code).toBe(2);
    });
});
