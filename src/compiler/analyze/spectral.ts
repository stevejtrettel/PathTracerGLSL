import { isInstancedObject, isValueParam, type SceneDescription } from '../types.js';
import { MATERIAL_MODELS } from '../../components/materials/index.js';

/** Supported spectral inputs; other binding and transport routes remain explicit diagnostics. */
export function spectralLimitations(scene: SceneDescription): string[] {
    const reasons: string[] = [];
    const constantRGB = (v: unknown, ceiling = Infinity): boolean =>
        typeof v === 'number' ? Number.isFinite(v) && v >= 0 && v <= ceiling
        : Array.isArray(v) && v.length === 3 && v.every(c => typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= ceiling);
    const rgbInput = (v: unknown, ceiling = Infinity): boolean => {
        if (!isValueParam(v)) return constantRGB(v, ceiling);
        // Defaults and declared controls must fit the domain. Live writes carry the same
        // author contract; slider bounds are UI metadata, not runtime clamps.
        return constantRGB(v.default, ceiling)
            && (v.min === undefined || (typeof v.min === 'number' && constantRGB(v.min, ceiling)))
            && (v.max === undefined || (typeof v.max === 'number' && constantRGB(v.max, ceiling)))
            && (v.min === undefined || v.max === undefined || v.min <= v.max);
    };
    if (scene.ambientMedium !== undefined || Object.values(scene.materials).some(m => m.medium !== undefined))
        reasons.push('spectral media are not supported yet');
    for (const [index, object] of scene.objects.entries()) {
        if (!isInstancedObject(object)) continue;
        const material = scene.materials[object.prototype.material];
        const rows = MATERIAL_MODELS[material?.model]?.properties ?? [];
        for (const row of rows) {
            const values = object.attributes?.[row.source];
            if (values === undefined || row.semantic !== 'radiometric') continue;
            const ceiling = row.role === 'reflectance' ? 1 : Infinity;
            // Nested RGB, scalar broadcasts and packed float arrays share this domain.
            for (const value of values) {
                if (constantRGB(value, ceiling)) continue;
                reasons.push(`spectral object ${index} attribute '${row.source}' requires ${ceiling === 1 ? 'RGB in [0,1]' : 'nonnegative RGB'}`);
                break;
            }
        }
    }
    for (const [name, mat] of Object.entries(scene.materials)) {
        for (const row of MATERIAL_MODELS[mat.model]?.properties ?? []) {
            if (row.semantic !== 'radiometric') continue;
            const value = mat[row.source] ?? row.default;
            const ceiling = row.role === 'reflectance' ? 1 : Infinity;
            if (!rgbInput(value, ceiling))
                reasons.push(`spectral material '${name}' property '${row.source}' requires ${ceiling === 1 ? 'RGB in [0,1]' : 'nonnegative RGB'}, including parameter defaults and bounds`);
        }
    }
    if (scene.lights.some(l => !rgbInput(l.emission)))
        reasons.push('spectral lights require nonnegative RGB emission, including parameter defaults and bounds');
    const env = scene.environment;
    if (env?.type === 'constant' && !rgbInput(env.color))
        reasons.push('spectral constant environments require nonnegative RGB, including parameter defaults and bounds');
    return reasons;
}
