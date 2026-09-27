import { isInstancedObject, type SceneDescription } from '../types.js';
import { MATERIAL_MODELS } from '../../components/materials/index.js';

/** Supported spectral inputs; other binding and transport routes remain explicit diagnostics. */
export function spectralLimitations(scene: SceneDescription): string[] {
    const reasons: string[] = [];
    const constantRGB = (v: unknown, ceiling = Infinity): boolean =>
        typeof v === 'number' ? Number.isFinite(v) && v >= 0 && v <= ceiling
        : Array.isArray(v) && v.length === 3 && v.every(c => typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= ceiling);
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
        if (mat.model !== 'lambert') reasons.push(`spectral material '${name}' requires the verified lambert model`);
        if (mat.albedo !== undefined && !constantRGB(mat.albedo, 1))
            reasons.push(`spectral material '${name}' requires constant RGB albedo in [0,1]`);
        if (mat.emission !== undefined && !constantRGB(mat.emission))
            reasons.push(`spectral material '${name}' requires constant nonnegative RGB emission`);
    }
    if (scene.lights.some(l => !constantRGB(l.emission)))
        reasons.push('spectral lights require constant nonnegative RGB emission');
    const env = scene.environment;
    if (env && env.type !== 'none' && (env.type !== 'constant' || !constantRGB(env.color)))
        reasons.push('spectral environments require a constant nonnegative RGB sky');
    return reasons;
}
