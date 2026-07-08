// compiler/generate/features/intersection.ts
// Geometry: fixed SDF primitives + raymarch loop, and the per-scene scene_sdf dispatch.

import type { RenderPlan, PlannedSDFObject } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import { formatFloat, formatVec3 } from './glsl-format.js';

import sdfPrimitivesGLSL from '../glsl/sdf_primitives.glsl?raw';
import raymarchGLSL from '../glsl/raymarch.glsl?raw';

export function contributeIntersection(plan: RenderPlan): FeatureContribution {
    if (plan.program.intersection.method !== 'raymarch') {
        return emptyContribution();
    }
    return {
        ...emptyContribution(),
        blocks: [
            { origin: 'glsl/sdf_primitives.glsl', source: sdfPrimitivesGLSL },
            { origin: 'generated:sdf-dispatch', source: generateSDFDispatch(plan.objects) },
            { origin: 'glsl/raymarch.glsl', source: raymarchGLSL },
        ],
    };
}

// ============================================================================
// Generated SDF dispatch (per-scene codegen)
// ============================================================================

function generateSDFDispatch(objects: PlannedSDFObject[]): string {
    const lines: string[] = [];
    lines.push('// Generated SDF dispatch');

    // Per-object wrapper functions
    for (const obj of objects) {
        lines.push(`float sdf_object_${obj.index}(vec3 p) {`);
        if (obj.translation) {
            lines.push(`    p = p - ${formatVec3(obj.translation)};`);
        }
        lines.push(`    return ${generateSDFCall(obj)};`);
        lines.push(`}`);
        lines.push('');
    }

    // scene_sdf dispatch
    lines.push('float scene_sdf(vec3 p, out int material) {');
    lines.push(`    float d = 1e20;`);
    lines.push(`    float d_obj;`);
    lines.push(`    material = 0;`);

    for (const obj of objects) {
        lines.push(`    d_obj = sdf_object_${obj.index}(p);`);
        lines.push(`    if (d_obj < d) { d = d_obj; material = ${obj.materialId}; }`);
    }

    lines.push(`    return d;`);
    lines.push(`}`);
    lines.push('');

    // Distance-only variant for normal estimation and shadow rays
    lines.push('float scene_sdf_dist(vec3 p) {');
    lines.push('    float d = 1e20;');

    for (const obj of objects) {
        lines.push(`    d = min(d, sdf_object_${obj.index}(p));`);
    }

    lines.push('    return d;');
    lines.push('}');

    return lines.join('\n');
}

function generateSDFCall(obj: PlannedSDFObject): string {
    const p = obj.parameters;
    switch (obj.sdfType) {
        case 'sphere': {
            const center = formatVec3(p.center as number[] ?? [0, 0, 0]);
            const radius = formatFloat(p.radius as number ?? 1.0);
            return `sdf_sphere(p, ${center}, ${radius})`;
        }
        case 'plane': {
            const normal = formatVec3(p.normal as number[] ?? [0, 1, 0]);
            const offset = formatFloat(p.offset as number ?? 0.0);
            return `sdf_plane(p, ${normal}, ${offset})`;
        }
        case 'box': {
            const center = formatVec3(p.center as number[] ?? [0, 0, 0]);
            const halfSize = formatVec3(p.halfSize as number[] ?? [1, 1, 1]);
            return `sdf_box(p, ${center}, ${halfSize})`;
        }
        default:
            throw new Error(`intersection: unsupported SDF type '${obj.sdfType}'`);
    }
}
