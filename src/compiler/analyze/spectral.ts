import { isGlslExpression, isHeterogeneousMedium, isInstancedObject, isValueParam, isEmissiveMedium, mediumMayScatter, mediumIsDeflecting, type SceneDescription } from '../types.js';
import { spectralCeilingRange } from '../../components/color/spectral/majorant.js';
import { namedKindOf } from '../../components/color/spectra/index.js';
import { MATERIAL_MODELS } from '../../components/materials/index.js';

/** Where the spectral model narrows a role's domain. Every spectrum slot is already checked
 *  against its role's domain in both colour models (propertyValidation.ts); the spectral lift
 *  adds two limits on plain values: reflectance at most 1 (the bounded lift), and the media
 *  ceilings its tracking bound is certified for (spectral README, "Tracking bound"). Named
 *  kinds check their own numbers. */
export function spectralLimitations(scene: SceneDescription): string[] {
    const reasons: string[] = [];
    // Every component of a plain constant, a slider default and both slider bounds is at most
    // `ceiling`. Values of any other shape are reported by the shared checker.
    const atMost = (v: unknown, ceiling: number): boolean => {
        const components = (x: unknown): number[] => typeof x === 'number' ? [x]
            : Array.isArray(x) ? x.filter((c): c is number => typeof c === 'number') : [];
        const values = isValueParam(v as never) ? [(v as { default?: unknown }).default, (v as { min?: unknown }).min, (v as { max?: unknown }).max] : [v];
        return values.every(x => components(x).every(c => c <= ceiling));
    };
    for (const [index, object] of scene.objects.entries()) {
        if (!isInstancedObject(object)) continue;
        const material = scene.materials[object.prototype.material];
        for (const row of MATERIAL_MODELS[material?.model]?.properties ?? []) {
            const values = object.attributes?.[row.source];
            if (values === undefined || row.semantic !== 'radiometric' || row.role !== 'reflectance') continue;
            // Nested RGB, scalar broadcasts and packed float arrays share this bound.
            if (!Array.from(values as ArrayLike<number | number[]>).every(v => atMost(v, 1)))
                reasons.push(`spectral object ${index} attribute '${row.source}' requires RGB in [0,1]`);
        }
    }
    for (const [name, mat] of Object.entries(scene.materials)) {
        const med = mat.medium;
        if (med !== undefined) {
            const deflecting = mediumIsDeflecting(med);
            const heterogeneous = !deflecting && isHeterogeneousMedium(med);
            if (heterogeneous && !(typeof med.majorant === 'number' && Number.isFinite(med.majorant)
                && med.majorant >= spectralCeilingRange[0] && med.majorant <= spectralCeilingRange[1]))
                reasons.push(`spectral medium '${name}' requires a density ceiling in [2^-60, 2^18]`);
            const derivedTracking = !deflecting && !heterogeneous && isEmissiveMedium(med) && mediumMayScatter(med);
            const ceiling = heterogeneous ? 2 ** 60 : derivedTracking ? spectralCeilingRange[1] / 2 : Infinity;
            for (const field of ['sigma_a', 'sigma_s'] as const) {
                if (Number.isFinite(ceiling) && !isGlslExpression(med[field]) && !atMost(med[field] ?? 0, ceiling))
                    reasons.push(`spectral medium '${name}' property '${field}' must be at most ${ceiling}, including parameter defaults and bounds`);
            }
        }
        for (const row of MATERIAL_MODELS[mat.model]?.properties ?? []) {
            if (row.semantic !== 'radiometric' || row.role !== 'reflectance') continue;
            const value = mat[row.source] ?? row.default;
            // Expressions author RGB in [0,1] at every evaluated point; their source and live
            // controls cannot establish that statically.
            if (isGlslExpression(value) || namedKindOf(value)) continue;
            if (!atMost(value, 1))
                reasons.push(`spectral material '${name}' property '${row.source}' requires RGB in [0,1], including parameter defaults and bounds`);
        }
    }
    return reasons;
}
