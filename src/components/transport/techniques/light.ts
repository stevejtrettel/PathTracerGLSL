// components/transport/techniques/light.ts
// T2 — LIGHT SAMPLING / NEE: the descriptor/glue side (fable-transport-glsl-target.md).
// The MATH lives in light.glsl / light_medium.glsl (static, conditionally included);
// T2 samples and scores at the same vertex (both edge endpoints known immediately), so
// it carries no state — this file declares only the inclusions and seams. A placement
// variant (equiangular medium NEE) is a second occupant: one new .glsl beside these.

import type { ShaderBlock } from '../../../compiler/generate/ShaderIR.js';
import type { Flags } from '../flags.js';
import lightGLSL from './light.glsl?raw';
import lightMediumGLSL from './light_medium.glsl?raw';

/** T2's static math files, included per program shape. */
export function lightBlocks(f: Flags): ShaderBlock[] {
    if (!f.nee) return [];
    const blocks: ShaderBlock[] = [
        { origin: 'components/transport/techniques/light.glsl', source: lightGLSL },
    ];
    if (f.scattering) {
        blocks.push({ origin: 'components/transport/techniques/light_medium.glsl', source: lightMediumGLSL });
    }
    return blocks;
}

/** The seams T2's emitted code calls under these flags. */
export function lightRequires(f: Flags): string[] {
    if (!f.nee) return [];
    const req = ['lighting_sample', 'shadow_transmittance', 'material_has_nondelta_lobes', 'interaction_surface_eval'];
    if (f.mis) req.push('interaction_surface_pdf');
    if (f.scattering) {
        req.push('hg_eval');
        if (f.mis) req.push('hg_pdf');
    }
    return req;
}
