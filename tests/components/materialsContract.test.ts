// The materials-registry contract (materials-§7): schema rows ARE the property
// vocabulary, so the registry must uphold the structural rules compiler policy
// leans on — no row source may collide with a material's meta-keys, the
// transmission capability implies a region-table row (ior_of finds it structurally,
// never by name), and emissive capability implies a row at EMISSION_KEY (the one
// name policy reads, paired with the capability).

import { describe, it, expect } from 'vitest';
import { MATERIAL_MODELS, EMISSION_KEY } from '../../src/components/materials/index.js';
import { PHASE_MODELS } from '../../src/components/volume_scattering/index.js';
import { CAMERA_MODELS } from '../../src/components/camera/index.js';
import { LIGHT_KINDS } from '../../src/components/lights/index.js';

/** SceneMaterial keys that are NOT properties — a row source colliding with one
 *  would make the authored record ambiguous. */
const RESERVED_KEYS = new Set(['model', 'medium', 'sampleAsLight']);

describe('material model descriptors (schema-vocabulary contract)', () => {
    for (const [id, d] of Object.entries(MATERIAL_MODELS)) {
        if (d === undefined) continue;
        describe(id, () => {
            it('registry key matches descriptor id', () => {
                expect(d.id).toBe(id);
            });

            it('row sources avoid the reserved meta-keys and are unique', () => {
                const sources = d.properties.map((f) => f.source as string);
                for (const s of sources) expect(RESERVED_KEYS.has(s), `source '${s}'`).toBe(false);
                expect(new Set(sources).size).toBe(sources.length);
            });

            it('defaults are finite numbers (GLSL default strings are derived, never authored)', () => {
                for (const f of d.properties) {
                    expect(typeof f.default, `${id}.${f.name}`).toBe('number');
                    expect(Number.isFinite(f.default)).toBe(true);
                }
            });

            it('transmission capability ⇒ a region-table row (ior_of finds it structurally)', () => {
                if (d.capabilities.transmission) {
                    expect(d.properties.some((f) => f.storage === 'region-table')).toBe(true);
                }
            });

            it(`emissive capability ⇒ a row at EMISSION_KEY (the capability's paired value)`, () => {
                if (d.capabilities.emissive) {
                    expect(d.properties.some((f) => f.source === EMISSION_KEY && f.storage === 'field')).toBe(true);
                }
            });
        });
    }

    it('phase model rows follow the same rules (second schema family)', () => {
        for (const [id, d] of Object.entries(PHASE_MODELS)) {
            if (d === undefined) continue;
            for (const f of d.properties) {
                expect(typeof f.default, `${id}.${f.name}`).toBe('number');
                expect(RESERVED_KEYS.has(f.source as string)).toBe(false);
            }
        }
    });
});

// ============================================================================
// GLSL symbol contracts (naming batch N3 — audit P4 made explicit for the
// remaining families; geometry's contract test is the template). The generated
// dispatches emit `${id}_${op}(...)` literally — a missing/misnamed symbol used
// to surface only as a glslang compile error.
// ============================================================================

describe('material model GLSL symbols (<id>_eval/_sample/_pdf/_emission)', () => {
    for (const [id, d] of Object.entries(MATERIAL_MODELS)) {
        if (d === undefined) continue;
        it(`${id} defines all four interaction ops`, () => {
            expect(new RegExp(`Spectrum\\s+${id}_eval\\s*\\(`).test(d.glsl), `${id}_eval`).toBe(true);
            expect(new RegExp(`InteractionSample\\s+${id}_sample\\s*\\(`).test(d.glsl), `${id}_sample`).toBe(true);
            expect(new RegExp(`float\\s+${id}_pdf\\s*\\(`).test(d.glsl), `${id}_pdf`).toBe(true);
            expect(new RegExp(`Spectrum\\s+${id}_emission\\s*\\(`).test(d.glsl), `${id}_emission`).toBe(true);
        });
    }
});

describe('phase model GLSL symbols (<id>_eval/_sample/_pdf)', () => {
    for (const [id, d] of Object.entries(PHASE_MODELS)) {
        if (d === undefined) continue;
        it(`${id} defines all three ops`, () => {
            expect(new RegExp(`Spectrum\\s+${id}_eval\\s*\\(`).test(d.glsl), `${id}_eval`).toBe(true);
            expect(new RegExp(`InteractionSample\\s+${id}_sample\\s*\\(`).test(d.glsl), `${id}_sample`).toBe(true);
            expect(new RegExp(`float\\s+${id}_pdf\\s*\\(`).test(d.glsl), `${id}_pdf`).toBe(true);
        });
    }
});

describe('camera occupant GLSL symbols (the fixed camera_generateRay seam)', () => {
    for (const [type, d] of Object.entries(CAMERA_MODELS)) {
        if (d === undefined) continue;
        it(`${type} provides camera_generateRay(vec2, vec2)`, () => {
            expect(/Ray\s+camera_generateRay\s*\(\s*vec2\s+\w+\s*,\s*vec2\s+\w+\s*\)/.test(d.glsl)).toBe(true);
        });
    }
});

describe('light kind GLSL contract (struct-alignment batch — the _light_ infix is deliberate)', () => {
    for (const [kind, d] of Object.entries(LIGHT_KINDS)) {
        const sn = kind[0].toUpperCase() + kind.slice(1) + 'Light';
        describe(kind, () => {
            it(`glsl does NOT declare struct ${sn} (generated from the rows — A1)`, () => {
                expect(new RegExp(`struct\\s+${sn}\\s*\\{`).test(d.glsl)).toBe(false);
            });

            it('geometric rows declare a kind (drives the generated typedef + future Value<T> rules)', () => {
                for (const p of d.params) {
                    if (p.semantic === 'geometric') expect(p.kind, `${kind}.${p.name}`).toBeDefined();
                }
            });

            it('derivedFields declarations match derivedCtorFields output (count + shapes)', () => {
                const resolved = Object.fromEntries(d.params.map((p) => [p.name, p.shape === 'vec3' ? [1, 0, 0] : 1]));
                const values = d.derivedCtorFields?.(resolved) ?? [];
                const specs = d.derivedFields ?? [];
                expect(values.length, 'derivedFields ↔ derivedCtorFields length').toBe(specs.length);
                values.forEach((v, j) => {
                    expect(Array.isArray(v) ? 'vec3' : 'number', `derived '${specs[j].name}'`).toBe(specs[j].shape);
                });
            });

            it(`provides LightSample ${kind}_light_sample(${sn}, Point, vec2)`, () => {
                expect(new RegExp(`LightSample\\s+${kind}_light_sample\\s*\\(\\s*${sn}\\b`).test(d.glsl)).toBe(true);
            });

            it(`provides float ${kind}_light_pdf(${sn}, ...) iff hittable (the adjacent §6.1 mirror)`, () => {
                expect(new RegExp(`float\\s+${kind}_light_pdf\\s*\\(\\s*${sn}\\b`).test(d.glsl)).toBe(!d.delta);
            });
        });
    }
});
