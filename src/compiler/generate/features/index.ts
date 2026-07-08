// compiler/generate/features/index.ts
// Collect and merge all feature contributions for a renderer (contracts §2.10).

import type { RenderPlan } from '../../plan/types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { mergeContributions, type MergedContributions } from './merge.js';

import { contributeCore } from './core.js';
import { contributeIntersection } from './intersection.js';
import { contributeMaterials } from './materials.js';
import { contributeLighting } from './lighting.js';
import { contributeCamera } from './camera.js';
import { contributeEnvironment } from './environment.js';
import { contributeTransport } from './transport.js';
import { contributeAccumulation } from './accumulation.js';

export type { FeatureContribution, PlannedTexture } from './types.js';
export type { MergedContributions } from './merge.js';

/**
 * Collect every feature's contribution to the main (pathtracer) shader, IN ORDER.
 *
 * The array order is the fragment-shader section order — GLSL requires
 * declare-before-use, so this ordering is load-bearing (core → intersection →
 * materials → lighting → camera → environment → transport → accumulation).
 * `environment` must precede `transport` (path_trace calls `environment_radiance`).
 * The display shader is assembled separately (ShaderBuilder), so `display` is not
 * collected here.
 */
export function collectFeatures(plan: RenderPlan, bag: DiagnosticBag): MergedContributions {
    return mergeContributions(
        [
            contributeCore(plan),
            contributeIntersection(plan),
            contributeMaterials(plan),
            contributeLighting(plan),
            contributeCamera(plan, bag),
            contributeEnvironment(plan, bag),
            contributeTransport(plan),
            contributeAccumulation(plan, bag),
        ],
        bag,
    );
}
