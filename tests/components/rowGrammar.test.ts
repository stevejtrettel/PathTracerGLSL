// The SHARED row grammar (descriptor-unification D1): one vocabulary — shape, kind,
// required XOR default, RowConstraint — across every family's rows. This file owns the
// cross-family checks; per-family structural contracts stay in their own suites.

import { describe, it, expect } from 'vitest';
import { PRIMITIVES } from '../../src/components/geometry/index.js';
import { LIGHT_KINDS } from '../../src/components/lights/index.js';
import { MATERIAL_MODELS } from '../../src/components/materials/index.js';
import { VOLUME_SCATTERING_MODELS } from '../../src/components/volume_scattering/index.js';
import { CAMERA_MODELS } from '../../src/components/camera/index.js';
import { TONEMAP_MODELS } from '../../src/components/tonemap/index.js';
import { PIXEL_MODELS } from '../../src/components/pixel/index.js';
import { SAMPLERS } from '../../src/components/sampler/index.js';
import { SENSORS } from '../../src/components/sensor/index.js';
import type { RowConstraint, ParamKind } from '../../src/components/descriptors.js';

/** Kinds-imply-shapes — ONE table (the geometry rule, applied everywhere a kind appears):
 *  point/vector/direction are vec3; angle/area/scalar are scalars; length is either (halfSize). */
function checkKindShape(label: string, kind: ParamKind | undefined, shape: 'number' | 'vec3'): void {
    if (kind === undefined || kind === 'length') return;
    if (kind === 'angle' || kind === 'area' || kind === 'scalar') {
        expect(shape, `${label} (kind '${kind}')`).toBe('number');
    } else {
        expect(shape, `${label} (kind '${kind}')`).toBe('vec3');
    }
}

function checkConstraintSane(label: string, c: RowConstraint | undefined): void {
    if (c === undefined) return;
    if (c.kind === 'min-length') expect(c.value, `${label} min-length value`).toBeGreaterThan(0);
}

describe('row grammar (D1) — one vocabulary across families', () => {
    describe('light authored rows', () => {
        for (const [kind, d] of Object.entries(LIGHT_KINDS)) {
            it(`${kind}: required XOR default; kinds imply shapes; constraints sane`, () => {
                for (const p of d.authoredParams) {
                    if (p.required) {
                        expect(p.default, `${kind}.${p.name}: a default on a required row is dead code`).toBeUndefined();
                    }
                    checkKindShape(`${kind}.${p.name}`, p.kind, p.shape);
                    checkConstraintSane(`${kind}.${p.name}`, p.constraint);
                }
            });
            it(`${kind}: struct rows + derived fields obey kinds-imply-shapes`, () => {
                for (const p of d.params) checkKindShape(`${kind}.${p.name}`, p.kind, p.shape);
                for (const f of d.derivedFields ?? []) checkKindShape(`${kind}.${f.name} (derived)`, f.kind, f.shape);
            });
        }
    });

    describe('geometry rows', () => {
        for (const [type, d] of Object.entries(PRIMITIVES)) {
            if (d.local === true) continue;   // scene-local defineSDF fields: row rules enforced at definition time
            it(`${type}: required XOR default; constraints sane`, () => {
                for (const p of d.params) {
                    if (p.required) expect(p.default, `${type}.${p.name}`).toBeUndefined();
                    checkConstraintSane(`${type}.${p.name}`, p.constraint);
                }
            });
        }
    });

    describe('registry keys match descriptor ids (D2: every family)', () => {
        it('camera / tonemap / pixel / sampler / sensor', () => {
            for (const [k, d] of Object.entries(CAMERA_MODELS)) expect(d.type, `camera '${k}'`).toBe(k);
            for (const [k, d] of Object.entries(TONEMAP_MODELS)) expect(d.type, `tonemap '${k}'`).toBe(k);
            for (const [k, d] of Object.entries(PIXEL_MODELS)) expect((d as { id: string }).id, `pixel '${k}'`).toBe(k);
            for (const [k, d] of Object.entries(SAMPLERS)) expect((d as { id: string }).id, `sampler '${k}'`).toBe(k);
            for (const [k, d] of Object.entries(SENSORS)) expect((d as { id: string }).id, `sensor '${k}'`).toBe(k);
        });
        it('camera authored rows: required XOR default; enum rows carry values', () => {
            for (const [k, d] of Object.entries(CAMERA_MODELS)) {
                for (const p of d.authoredParams ?? []) {
                    if (p.required) expect(p.default, `${k}.${p.name}`).toBeUndefined();
                    if (p.shape === 'enum') expect(p.values?.length ?? 0, `${k}.${p.name} enum values`).toBeGreaterThan(0);
                    checkConstraintSane(`${k}.${p.name}`, p.constraint);
                }
            }
        });
    });

    describe('material/phase property rows', () => {
        for (const [id, d] of Object.entries({ ...MATERIAL_MODELS, ...VOLUME_SCATTERING_MODELS })) {
            it(`${id}: constraints sane`, () => {
                for (const f of d?.properties ?? []) checkConstraintSane(`${id}.${f.name}`, f.constraint);
            });
        }
    });
});
