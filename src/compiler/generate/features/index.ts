// compiler/generate/features/index.ts
// Collect and merge all feature contributions for a renderer (contracts §2.10).

import type { RenderPlan } from '../../plan/types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { mergeContributions, type MergedContributions } from './merge.js';
import { emptyContribution, type FeatureContribution } from './types.js';

import { contributeCore } from './core.js';
import { contributeIntersection } from './intersection.js';
import { contributeMaterials } from './materials.js';
import { contributeLighting } from './lighting.js';
import { contributeCamera } from './camera.js';
import { contributeEnvironment } from './environment.js';
import { contributeTransport } from '../../../components/transport/pt/transport.js';
import { contributeAccumulation } from './accumulation.js';

export type { FeatureContribution, PlannedTexture } from './types.js';
export type { MergedContributions } from './merge.js';

/**
 * Collect every feature's contribution to the main (pathtracer) shader, IN ORDER.
 *
 * The array order is the fragment-shader section order (core → intersection →
 * materials → lighting → camera → environment → transport → accumulation). Since T4,
 * cross-feature declaration order is NOT load-bearing: the generated interface header
 * (spliced after core, whose structs the prototypes need) forward-declares every
 * provided seam, and merge validates every `requires` against the provides. Definition
 * order still follows this array; only declarations are order-free.
 * The display shader is assembled separately (ShaderBuilder), so `display` is not
 * collected here.
 */
export function collectFeatures(plan: RenderPlan, bag: DiagnosticBag): MergedContributions {
    const features = [
        contributeCore(plan),
        contributeIntersection(plan),
        contributeMaterials(plan),
        contributeLighting(plan),
        contributeCamera(plan, bag),
        contributeEnvironment(plan, bag),
        contributeTransport(plan),
        contributeAccumulation(plan, bag),
    ];
    // Interface header after core (its prototypes reference core's struct types).
    const withHeader = [features[0], interfaceHeader(features), ...features.slice(1)];
    return mergeContributions(withHeader, bag);
}

/**
 * The generated interface header (T4): one forward declaration per provided seam,
 * grouped by feature. Doubles as the emitted program's table of contents — the dump
 * opens with exactly the contract surface THIS program links (nothing else exists).
 */
function interfaceHeader(features: FeatureContribution[]): FeatureContribution {
    const lines: string[] = [
        '// ── Interface header (generated): the seams this program links ──',
    ];
    for (const f of features) {
        if (f.provides.length === 0) continue;
        lines.push(`// ${f.feature}:`);
        for (const p of f.provides) lines.push(`${p.signature};`);
    }
    return {
        ...emptyContribution('interfaces'),
        blocks: [{ origin: 'generated:interfaces', source: lines.join('\n') }],
    };
}
