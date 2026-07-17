// The materials-registry contract (materials-§7): schema rows ARE the property
// vocabulary, so the registry must uphold the structural rules compiler policy
// leans on — no row source may collide with a material's meta-keys, the
// transmission capability implies a region-table row (ior_of finds it structurally,
// never by name), and emissive capability implies a row at EMISSION_KEY (the one
// name policy reads, paired with the capability).

import { describe, it, expect } from 'vitest';
import { MATERIAL_MODELS, EMISSION_KEY } from '../../src/components/materials/index.js';
import { PHASE_MODELS } from '../../src/components/volume_scattering/index.js';

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
