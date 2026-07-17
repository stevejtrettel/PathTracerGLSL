// compiler/generate/schema.ts
// Schema-driven struct generation (§3.4 made literal, impl-plan-descriptor-reorg R2):
// the properties structs are the UNION of fields declared by the models PRESENT — a
// program contains no field nothing reads. The union scales with scene diversity (a
// handful of models), never with library size; a single-model scene's struct IS that
// model's struct (module-anatomy §1's degeneracy, where the numeric witnesses live).

import type { PropertySchema } from '../../components/descriptors.js';
import { formatFloat } from '../../components/glsl-format.js';

/** GLSL default expression DERIVED from the row's numeric default (materials-§7:
 *  defaults live once, as numbers). Spectrum rows broadcast through the §2.5
 *  constants/constructor; float rows format directly. */
export function defaultExpr(f: PropertySchema<string>): string {
    if (f.glslType === 'Spectrum') {
        if (f.default === 0) return 'SPECTRUM_ZERO';
        if (f.default === 1) return 'SPECTRUM_ONE';
        return `Spectrum(${formatFloat(f.default)})`;
    }
    return formatFloat(f.default);
}

/**
 * Union of 'field'-storage schemas across the models present, deduped by name in
 * first-appearance order. Same name + same glslType share one field (deliberate —
 * GGX and rough-dielectric will share `roughness`); same name + different type is a
 * bug the Validator catches — this throw is the unreachable backstop.
 */
export function unionFields<S extends string>(schemaSets: PropertySchema<S>[][]): PropertySchema<S>[] {
    const byName = new Map<string, PropertySchema<S>>();
    for (const set of schemaSets) {
        for (const s of set) {
            if (s.storage !== 'field') continue;   // region-table fields live in generated tables, not the struct
            const prior = byName.get(s.name);
            if (prior === undefined) {
                byName.set(s.name, s);
            } else if (prior.glslType !== s.glslType) {
                throw new Error(`schema: field '${s.name}' declared as ${prior.glslType} and ${s.glslType} (Validator should have rejected)`);
            }
        }
    }
    return [...byName.values()];
}

/**
 * The generated struct text. `emission` carries its paired `emission_strength`
 * (the fixed-struct split the §3.4 note defers merging — lambert_emission reads both).
 */
export function buildPropertiesStruct<S extends string>(structName: string, fields: PropertySchema<S>[], baseFields: string[] = []): string {
    const lines = [`// Generated ${structName} — the union of fields the models PRESENT read (§3.4)`];
    lines.push(`struct ${structName} {`);
    for (const b of baseFields) lines.push(`    ${b}`);
    for (const f of fields) {
        lines.push(`    ${f.glslType} ${f.name};`);
        if (f.name === 'emission') lines.push('    float emission_strength;');
    }
    lines.push('};');
    return lines.join('\n');
}
