import type { SceneDescription, Vec3 } from '../types.js';
import { namedKindOf } from '../../components/color/spectra/index.js';
import { MATERIAL_MODELS } from '../../components/materials/index.js';

/** Where an RGB program cannot show a named spectrum exactly: a reflectance whose RGB stand-in
 *  lies outside [0, 1] is clipped there (a saturated Gaussian band, for example). Spectral
 *  programs evaluate the spectrum itself. */
export function rgbPreviewWarnings(scene: SceneDescription): string[] {
    const warnings: string[] = [];
    for (const [name, mat] of Object.entries(scene.materials)) {
        for (const row of MATERIAL_MODELS[mat.model]?.properties ?? []) {
            if (row.semantic !== 'radiometric' || row.role !== 'reflectance') continue;
            const value = (mat as unknown as Record<string, unknown>)[row.source];
            const kind = namedKindOf(value);
            if (kind === undefined || !kind.roles.includes('reflectance')) continue;
            // An invalid value gets its own error; only valid ones are previewed.
            let invalid = false;
            kind.validate?.(value, '', () => { invalid = true; });
            if (invalid) continue;
            const rgb = kind.toRGB(value, 'reflectance', {}) as Vec3;
            if (rgb.some((c) => c < 0 || c > 1)) {
                warnings.push(`Material '${name}': ${row.source}: its RGB stand-in (${rgb.map((c) => c.toFixed(3)).join(', ')}) lies outside [0, 1]; RGB renders clip it, spectral renders are exact`);
            }
        }
    }
    return warnings;
}
