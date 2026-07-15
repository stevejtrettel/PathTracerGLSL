// compiler/generate/features/merge.ts
//
// Concatenate feature contributions into one flat bundle (contracts §2.10). The
// result is the single source of truth the Generator emits from — every uniform
// declaration, every define, every block, in one place — which is what makes
// declared-vs-wired validation structural rather than a pile of ad-hoc checks.

import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import type { ShaderBlock } from '../ShaderIR.js';
import type { PlannedUniform } from '../../plan/types.js';
import type { ParameterMetadata } from '../../types.js';
import type { FeatureContribution, PlannedTexture } from './types.js';

export interface MergedContributions {
    blocks: ShaderBlock[];
    defines: Record<string, string>;
    uniforms: PlannedUniform[];
    parameters: Record<string, ParameterMetadata>;
    textures: PlannedTexture[];
}

/**
 * Merge contributions in order. Blocks/defines/parameters concatenate; uniforms and
 * textures dedupe by name — identical duplicates merge silently (e.g. two materials
 * sharing one `{param}`-driven uniform), conflicting duplicates (same name, different
 * type/path/source) are a compile error.
 */
export function mergeContributions(
    contributions: FeatureContribution[],
    bag: DiagnosticBag,
): MergedContributions {
    const blocks: ShaderBlock[] = [];
    const defines: Record<string, string> = {};
    const parameters: Record<string, ParameterMetadata> = {};

    const uniforms: PlannedUniform[] = [];
    const uniformsByName = new Map<string, PlannedUniform>();

    const textures: PlannedTexture[] = [];
    const texturesByName = new Map<string, PlannedTexture>();

    // T4 structural link check: every provided seam is unique; every required seam is
    // provided by SOME feature. This replaces ordering discipline held by comments —
    // a missing definition is a named compile-time diagnostic, not a GLSL error later.
    const providedBy = new Map<string, string>();
    for (const c of contributions) {
        for (const p of c.provides) {
            const prior = providedBy.get(p.name);
            if (prior !== undefined) {
                bag.addError(
                    'seam-conflict',
                    `Seam '${p.name}' provided by both '${prior}' and '${c.feature}' — one definition per seam`,
                );
                continue;
            }
            providedBy.set(p.name, c.feature);
        }
    }
    const required = new Set<string>();
    for (const c of contributions) {
        for (const r of c.requires) {
            required.add(r);
            if (!providedBy.has(r)) {
                bag.addError(
                    'seam-missing',
                    `Feature '${c.feature}' requires seam '${r}' but no feature provides it`,
                );
            }
        }
    }

    // seam-unused — the dual link check (impl-plan-exact-linkage): a provided seam no
    // contribution requires is dead generated code, which the exact-linkage rule forbids.
    // The enforcement that keeps the emitted program equal to its own link map: features
    // gate emission on the Planner's seam decisions, and this check catches any gate that
    // drifts. Component-scoped provides are exempt — they ride inside whole self-authored
    // component files (the pinned wholesale-inclusion cost), so their presence is not
    // individually gated. Roots (main's calls) are ordinary requires: the accumulation
    // feature emits main() and requires pixel_sample/camera_generateRay/transport_trace.
    for (const c of contributions) {
        for (const p of c.provides) {
            if (!p.componentScoped && !required.has(p.name)) {
                bag.addWarning(
                    'seam-unused',
                    `Feature '${c.feature}' provides seam '${p.name}' but nothing requires it — dead generated code (gate its emission on the Planner decision that links it)`,
                );
            }
        }
    }

    for (const c of contributions) {
        blocks.push(...c.blocks);
        Object.assign(defines, c.defines);
        Object.assign(parameters, c.parameters);

        for (const u of c.uniforms) {
            const existing = uniformsByName.get(u.name);
            if (existing) {
                if (existing.type !== u.type || existing.parameterPath !== u.parameterPath) {
                    bag.addError(
                        'uniform-conflict',
                        `Conflicting uniform '${u.name}': ${existing.type} ${existing.parameterPath} ` +
                        `vs ${u.type} ${u.parameterPath}`,
                    );
                }
                continue; // identical → already present
            }
            uniformsByName.set(u.name, u);
            uniforms.push(u);
        }

        for (const t of c.textures) {
            const existing = texturesByName.get(t.name);
            if (existing) {
                if (existing.source !== t.source) {
                    bag.addError(
                        'texture-conflict',
                        `Conflicting texture '${t.name}': ${existing.source} vs ${t.source}`,
                    );
                }
                continue;
            }
            texturesByName.set(t.name, t);
            textures.push(t);
        }
    }

    return { blocks, defines, uniforms, parameters, textures };
}
