// Material-model registry (mix-many family, module-anatomy §5). Feature planners iterate
// the models PRESENT in the plan and look descriptors up here — adding a model is one
// GLSL file + one descriptor + one line below, and NOTHING else (true since the
// July 2026 union→string batch: model ids are strings like every other family;
// this registry + the Validator's unknown-model rejection gatekeep).

import type { MaterialModel } from '../../compiler/types.js';
import type { MaterialDerivedSpec, MaterialModelDescriptor, PropertySchema } from '../descriptors.js';
import { lambertDescriptor } from './lambert/lambert.js';
import { dielectricDescriptor } from './dielectric/dielectric.js';
import { ggxDescriptor } from './ggx/ggx.js';
import { roughDielectricDescriptor } from './rough_dielectric/rough_dielectric.js';
import { mirrorDescriptor } from './mirror/mirror.js';
import { checkerDescriptor } from './checker/checker.js';
import { plasticDescriptor } from './plastic/plastic.js';
import { thinDielectricDescriptor } from './thin_dielectric/thin_dielectric.js';

export const MATERIAL_MODELS: Partial<Record<MaterialModel, MaterialModelDescriptor>> = {
    lambert: lambertDescriptor,
    dielectric: dielectricDescriptor,
    rough_dielectric: roughDielectricDescriptor,
    ggx: ggxDescriptor,
    mirror: mirrorDescriptor,
    checker: checkerDescriptor,
    plastic: plasticDescriptor,
    thin_dielectric: thinDielectricDescriptor,
};

/** The model's STRUCT surface: its rows plus its derived fields as pseudo-rows —
 *  ONE list for the struct union, the lookup's default lines, and the resolver, so a
 *  derived field can never drift from the fields the occupant reads. Derived pseudo-rows
 *  carry the declared colour role, with default 0 outside the model's own arms. */
export function modelStructFields(d: MaterialModelDescriptor): PropertySchema[] {
    return [
        ...d.properties,
        ...(d.derived ?? []).map((s): PropertySchema => ({
            name: s.name,
            ...(s.glslType === 'Spectrum'
                ? { glslType: s.glslType, role: s.role }
                : { glslType: s.glslType }),
            source: s.name, default: 0, storage: 'field',
        })),
    ];
}

/** The derived field without a per-hit form (computed only on the host by `fn`) that the
 *  model's row `source` feeds, if any. Such a value is computed once per material from the
 *  row's numbers, so the row takes only a constant or a {param}, and cannot vary per
 *  instance. A row feeding a field with a per-hit form (`glsl`) takes any value its own
 *  checks allow. */
export function hostDerivedFieldFedBy(id: MaterialModel, source: string): MaterialDerivedSpec | undefined {
    return MATERIAL_MODELS[id]?.derived?.find((d) => d.inputs.includes(source) && !hasPerHitForm(d));
}

/** The derived field can be computed per hit in GLSL (MaterialDerivedSpec.glsl). */
export function hasPerHitForm(d: MaterialDerivedSpec): d is MaterialDerivedSpec & { glsl(fields: Record<string, string>): string } {
    return d.glslType === 'float' && d.glsl !== undefined;
}

/** Lookup that throws on unregistered models — the Validator rejects them upstream
 *  (reject-not-remove), so this is an unreachable backstop, not a diagnostic. */
export function materialModel(id: MaterialModel): MaterialModelDescriptor {
    const d = MATERIAL_MODELS[id];
    if (!d) throw new Error(`material model '${id}' has no descriptor (Validator should have rejected it)`);
    return d;
}

/** Transmission capability, safe over 'none' (a boundary classification, not a model)
 *  and unregistered models — both transmit nothing. */
export function modelTransmission(id: MaterialModel): boolean {
    return id !== 'none' && (MATERIAL_MODELS[id]?.capabilities.transmission ?? false);
}

/** The model passes light to the far side of its surface without crossing the interface: its
 *  support is the sphere but it changes no index (a thin sheet). The walk takes hit.region_to
 *  as the medium behind any transmission, and on a zero-thickness owner's front hit the
 *  dispatcher reports region_to = the owner itself, so in a scene with media such a model
 *  would lose the medium behind the surface for one segment. The Validator rejects the pair. */
export function modelTransmitsWithoutCrossing(id: MaterialModel): boolean {
    const d = id === 'none' ? undefined : MATERIAL_MODELS[id];
    return d !== undefined && d.capabilities.support === 'sphere' && !d.capabilities.transmission;
}

/** THE two-sided-shading predicate (fable-rough-dielectric §3.1) — the one place the
 *  `support` fact is combined with delta-ness, so no consumer re-spells the conjunction:
 *  a receiver can be lit from BELOW its shading normal exactly when its BSDF's support
 *  is the sphere AND NEE actually evaluates it (delta lobes are never NEE-sampled).
 *  Readers: the twoSidedShading decision (Planner) and the generated material_two_sided
 *  predicate. 'none' is a boundary classification, not a surface. FAIL-SAFE on
 *  unregistered models — an unknown model is assumed two-sided, which costs the horizon
 *  cull's variance win and can never introduce bias (the nondelta guard's polarity). */
export function modelTwoSidedShading(id: MaterialModel): boolean {
    if (id === 'none') return false;
    const d = MATERIAL_MODELS[id];
    if (d === undefined) return true;
    return d.capabilities.support === 'sphere' && d.capabilities.nonDeltaLobes;
}

/** The ONE property key compiler POLICY reads by name: emission feeds the light desugar,
 *  the sampleAsLight registry, and the emission gate — a cross-model concept paired with
 *  `capabilities.emissive` (an emissive-capable model declares a row with this source).
 *  Everything else is read only through schema rows; ior is found structurally (the
 *  declaring model's region-table row), never by name. */
export const EMISSION_KEY = 'emission';

/** The schema declares which surface models consume the adjacent regions' index. */
export function modelIndexRow(id: MaterialModel): PropertySchema | undefined {
    return MATERIAL_MODELS[id]?.properties.find(row => row.role === 'index' && row.storage === 'region-table');
}
