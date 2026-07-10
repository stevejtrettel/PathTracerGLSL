// compiler/generate/features/environment.ts
// Environment: what a ray sees when it hits nothing (contracts §2.10 / review C3).
//
// Every kind fills the same function — `environment_radiance(vec3 dir) -> vec3` —
// with a different body + resources. ANALYTIC kinds are implemented here:
//   none     → black
//   constant → live u_environment_color * u_environment_intensity
// TABULATED kinds (procedural, image) build an equirect table + CDF and are a
// separate step; they're rejected with a diagnostic until then.

import type { RenderPlan } from '../../plan/types.js';
import type { PlannedUniform } from '../../plan/types.js';
import type { ParameterMetadata } from '../../../engine/types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { emptyContribution, type FeatureContribution } from './types.js';

const ORIGIN = 'generated:environment';

export function contributeEnvironment(plan: RenderPlan, bag: DiagnosticBag): FeatureContribution {
    const env = plan.program.environment;

    if (env.type === 'constant') {
        const intensity = env.intensity ?? 1.0;
        const uniforms: PlannedUniform[] = [
            { name: 'u_environment_color', type: 'vec3', parameterPath: 'environment.color', default: env.color },
            { name: 'u_environment_intensity', type: 'float', parameterPath: 'environment.intensity', default: intensity },
        ];
        const parameters: Record<string, ParameterMetadata> = {
            'environment.color': { type: 'color', default: env.color, name: 'Sky color', group: 'Environment', triggersReset: true },
            'environment.intensity': { type: 'float', default: intensity, range: [0, 5], name: 'Sky intensity', group: 'Environment', triggersReset: true },
        };
        return {
            ...emptyContribution(),
            blocks: [{ origin: ORIGIN, source: radianceFn('return u_environment_color * u_environment_intensity;') }],
            uniforms,
            parameters,
        };
    }

    if (env.type === 'procedural' || env.type === 'image') {
        bag.error(
            'unsupported-environment',
            `Environment type '${env.type}' is not implemented yet (tabulated environments are a separate step). Falling back to none.`,
        ).add();
    }

    // none (and the fallback)
    return {
        ...emptyContribution(),
        blocks: [{ origin: ORIGIN, source: radianceFn('return SPECTRUM_ZERO;') }],  // §2.5: radiometric, not raw vec3
    };
}

function radianceFn(body: string): string {
    return `// Environment radiance\nvec3 environment_radiance(vec3 dir) {\n    ${body}\n}`;
}
