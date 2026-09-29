// compiler/generate/schema.ts
// Schema-driven struct generation (§3.4 made literal, impl-plan-descriptor-reorg R2):
// the properties structs are the UNION of fields declared by the models PRESENT — a
// program contains no field nothing reads. The union scales with scene diversity (a
// handful of models), never with library size; a single-model scene's struct IS that
// model's struct (module-anatomy §1's degeneracy, where the numeric witnesses live).

import { isRadiometric, type PropertySchema, type ParamKind, type RadiometricRole } from '../../components/descriptors.js';
import { emitColor } from './color.js';
import { formatFloat } from '../../components/glsl-format.js';

/** A struct-emittable row (A1): geometry PrimitiveParamSpec, LightParamSpec, and
 *  DerivedFieldSpec all satisfy this. */
export interface StructRow {
    name: string;
    shape: 'number' | 'vec3';
    kind?: ParamKind;
    /** An emission row's role; absent for geometry. */
    role?: RadiometricRole;
}

/** The row's GLSL type — typedef-disciplined (curved-space prep): radiometric →
 *  Spectrum; point → Point; direction → Direction; plain vectors → vec3;
 *  scalars → float. */
export function rowGlslType(row: StructRow): string {
    if (isRadiometric(row.role)) return 'Spectrum';
    if (row.shape === 'number') return 'float';
    if (row.kind === 'point') return 'Point';
    if (row.kind === 'direction') return 'Direction';
    return 'vec3';
}

/** GENERATED struct from rows (A1: one declaration — the occupant's .glsl declares
 *  only functions; the row is the single source for struct, ctor, resolution, and
 *  validation, so the field-order/name/type drift class is structurally dead). */
export function structFromRows(structName: string, rows: StructRow[]): string {
    return [
        `struct ${structName} {`,
        ...rows.map((r) => `    ${rowGlslType(r)} ${r.name};`),
        '};',
    ].join('\n');
}

/** Resolve the row's authored grey default at the current wavelengths. */
export function defaultExpr(f: PropertySchema<string>, wl: string): string {
    return isRadiometric(f.role)
        ? emitColor(`vec3(${formatFloat(f.default)})`, f.role, wl)
        : formatFloat(f.default);
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

/** Common wavelength carrier plus the fields read by this scene's models. */
export function buildPropertiesStruct<S extends string>(structName: string, fields: PropertySchema<S>[], baseFields: string[] = []): string {
    const lines = [`// Generated ${structName} — the union of fields the models PRESENT read (§3.4)`];
    lines.push(`struct ${structName} {`);
    lines.push('    Wavelengths wl;');
    for (const b of baseFields) lines.push(`    ${b}`);
    for (const f of fields) {
        lines.push(`    ${f.glslType} ${f.name};`);
    }
    lines.push('};');
    return lines.join('\n');
}
