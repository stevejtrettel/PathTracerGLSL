// tests/compiler/sdfTable.test.ts — boxed-SDF leaves, the plan side
// (impl-plan-sdf-accel T2): eligibility, LEAF_SDF leaves, the shared record region,
// and the rigid-tail record layout — gated BEFORE any GLSL exists.

import { describe, it, expect } from 'vitest';
import { dataTenantsOf, READS_EVERYTHING } from '../../src/compiler/plan/dataTenants.js';
import { LEAF_SDF, ANALYTIC_RECORD_TEXELS } from '../../src/components/intersection/index.js';
import { sdfRecordPack, sdfTailTexel } from '../../src/compiler/generate/records.js';
import { primitive } from '../../src/components/geometry/index.js';
import type { SceneDescription } from '../../src/compiler/types.js';
import { plan as planScene } from '../../src/compiler/plan/Planner.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import { sdfTableTwin, sdfUnrolledStrategy, sdfTableStrategy } from '../witnesses/scenes/sdfTableWitness.js';

const base = (): SceneDescription => ({
    id: 's',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'sphere', parameters: { radius: 1 }, material: 'm' },   // analytic leaf
    ],
    materials: { m: { model: 'lambert' } },
    lights: [{ kind: 'point', position: [0, 5, 0], emission: 10 }],
});

describe('boxed-SDF table plan (fable-sdf-accel T2)', () => {
    it('a pinned ROTATED box becomes a LEAF_SDF entry (rotation allowed, unlike the analytic arm)', () => {
        const s = base();
        s.objects.push({
            type: 'box', parameters: { halfSize: [1, 1, 1] }, material: 'm', backend: 'sdf',
            transform: { position: [2, 1, 0], rotation: { axis: [0, 1, 0], angle: 0.7 } },
        });
        const { tenants, table } = dataTenantsOf(s, READS_EVERYTHING);
        expect(table).not.toBeNull();
        expect(table!.sdf).toEqual([{ sceneIndex: 1, type: 'box', solid: true }]);
        expect(table!.leaves.filter((l) => l.kind === LEAF_SDF)).toEqual([{ kind: LEAF_SDF, ref: 0 }]);
        // The SDF arm's header code is offset past the analytic codes (globally unique).
        expect(table!.sdfKindCodes.get('box')).toBe(table!.kindCodes.size);
        // ONE region, shared stride: analytic + sdf records.
        expect(tenants.sceneTable!.analyticTexels).toBe((table!.analytic.length + 1) * ANALYTIC_RECORD_TEXELS);
    });

    it('a box may be BOTH records in one scene (analytic unrotated + pinned-sdf rotated)', () => {
        const s = base();
        s.objects.push({ type: 'box', parameters: { center: [0, 1, 0], halfSize: [1, 1, 1] }, material: 'm' });
        s.objects.push({
            type: 'box', parameters: { halfSize: [1, 1, 1] }, material: 'm', backend: 'sdf',
            transform: { rotation: { axis: [0, 0, 1], angle: 0.3 } },
        });
        const { table } = dataTenantsOf(s, READS_EVERYTHING);
        expect(table!.analytic.some((a) => a.type === 'box')).toBe(true);
        expect(table!.sdf.some((x) => x.type === 'box')).toBe(true);
        expect(table!.kindCodes.get('box')).not.toBe(table!.sdfKindCodes.get('box'));
    });

    it('driven and unbounded SDF objects stay residual (the analytic rule verbatim)', () => {
        const s = base();
        s.objects.push({
            type: 'box', parameters: { halfSize: [1, 1, 1] }, material: 'm', backend: 'sdf',
            transform: { position: { param: 'slide', default: [0, 0, 0] } },
        });
        s.objects.push({ type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'm', backend: 'sdf' });
        const { table } = dataTenantsOf(s, READS_EVERYTHING);
        expect(table!.sdf.length).toBe(0);
    });

    it('the rigid tail sits TEXEL-ALIGNED after the params floats (the record layout truth)', () => {
        const d = primitive('box');
        expect(sdfTailTexel(d)).toBe(3);   // header + ⌈6/4⌉ params texels → tail at texel 3
        const q: [number, number, number, number] = [0.1, 0.2, 0.3, 0.9];
        const ts: [number, number, number, number] = [4, 5, 6, 1];
        const floats = sdfRecordPack(d, { center: [1, 2, 3], halfSize: [7, 8, 9] }, q, ts);
        expect(floats.length).toBe((ANALYTIC_RECORD_TEXELS - 1) * 4);
        expect(floats.slice(0, 6)).toEqual([1, 2, 3, 7, 8, 9]);
        expect(floats.slice(6, 8)).toEqual([0, 0]);   // align padding
        expect(floats.slice(8, 16)).toEqual([0.1, 0.2, 0.3, 0.9, 4, 5, 6, 1]);
    });
});

// The twin's two arms must actually BE two regimes (impl-plan-sdf-as-shape T6). The
// dispatch default is scene-dependent — many marched objects default to 'table' — so an
// arm that relies on the default silently stops being a control. This happened once:
// the twin passed at 0.00%/0.00% while comparing the table against itself.
describe('the sdf-table-twin arms stay two regimes', () => {
    const dispatchOf = (strategy: typeof sdfTableStrategy) =>
        planScene(analyze(sdfTableTwin), sdfTableTwin, strategy, new DiagnosticBag('test')).program.intersection.objectDispatch;

    it('the unrolled arm really plans unrolled (never inherits the scene-dependent default)', () => {
        expect(dispatchOf(sdfUnrolledStrategy)).toBe('unrolled');
    });

    it('the table arm plans table', () => {
        expect(dispatchOf(sdfTableStrategy)).toBe('table');
    });
});
