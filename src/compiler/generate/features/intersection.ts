// compiler/generate/features/intersection.ts
// Geometry backends + the generated scene_intersect dispatcher.
//
// A scene may use the SDF backend (marching), the analytic backend (closed-form), or both.
// scene_intersect / scene_intersect_any are GENERATED to combine only the backends present —
// so "swapping the details of intersect" is exactly what the codegen does. Region ids are
// globally unique across both backends (§2.3), so material_of() spans them.

import type { RenderPlan, PlannedSDFObject, PlannedAnalyticObject } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import type { ShaderBlock } from '../ShaderIR.js';
import { formatFloat, formatVec3 } from './glsl-format.js';

import sdfPrimitivesGLSL from '../glsl/sdf_primitives.glsl?raw';
import raymarchGLSL from '../glsl/raymarch.glsl?raw';
import analyticPrimitivesGLSL from '../glsl/analytic_primitives.glsl?raw';

export function contributeIntersection(plan: RenderPlan): FeatureContribution {
    if (plan.program.intersection.method !== 'raymarch') {
        return emptyContribution();
    }

    const hasSDF = plan.objects.length > 0;
    const hasAnalytic = plan.analyticObjects.length > 0;
    const blocks: ShaderBlock[] = [];

    // SDF backend: primitives + per-scene scene_sdf dispatch + the marcher (sdf_intersect*).
    if (hasSDF) {
        blocks.push({ origin: 'glsl/sdf_primitives.glsl', source: sdfPrimitivesGLSL });
        blocks.push({ origin: 'generated:sdf-dispatch', source: generateSDFDispatch(plan.objects) });
        blocks.push({ origin: 'glsl/raymarch.glsl', source: raymarchGLSL });
    }

    // Analytic backend: closed-form primitives + per-scene analytic_intersect* dispatch.
    if (hasAnalytic) {
        blocks.push({ origin: 'glsl/analytic_primitives.glsl', source: analyticPrimitivesGLSL });
        blocks.push({ origin: 'generated:analytic-dispatch', source: generateAnalyticDispatch(plan.analyticObjects) });
    }

    // region → material table spans BOTH backends (regions are globally unique).
    blocks.push({ origin: 'generated:material-of', source: generateMaterialOf(plan.objects, plan.analyticObjects) });

    // The top-level dispatcher, combining only the backends present (declared after both).
    blocks.push({ origin: 'generated:scene-intersect', source: generateSceneIntersect(hasSDF, hasAnalytic) });

    return { ...emptyContribution(), blocks };
}

// ============================================================================
// SDF backend dispatch (per-scene)
// ============================================================================

function generateSDFDispatch(objects: PlannedSDFObject[]): string {
    const lines: string[] = [];
    lines.push('// Generated SDF dispatch');

    for (const obj of objects) {
        lines.push(`float sdf_object_${obj.index}(vec3 p) {`);
        if (obj.translation) {
            lines.push(`    p = p - ${formatVec3(obj.translation)};`);
        }
        lines.push(`    return ${generateSDFCall(obj)};`);
        lines.push(`}`);
        lines.push('');
    }

    // scene_sdf — returns the OWNER region (object index), not a material id (§2.3).
    lines.push('float scene_sdf(vec3 p, out int region) {');
    lines.push(`    float d = 1e20;`);
    lines.push(`    float d_obj;`);
    lines.push(`    region = -1;`);
    for (const obj of objects) {
        lines.push(`    d_obj = sdf_object_${obj.index}(p);`);
        lines.push(`    if (d_obj < d) { d = d_obj; region = ${obj.index}; }`);
    }
    lines.push(`    return d;`);
    lines.push(`}`);
    lines.push('');

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

// ============================================================================
// Analytic backend dispatch (per-scene)
// ============================================================================
// Nearest-hit over the analytic objects, and a first-blocker any-hit. p and the shading frame
// come from ambient_geodesic/ambient_frame so they agree with the SDF path (cross-method match).

function generateAnalyticDispatch(objects: PlannedAnalyticObject[]): string {
    const lines: string[] = ['// Generated analytic dispatch'];

    // Nearest-hit bounded by the incoming hit.t (the running nearest — set by the caller / a prior
    // backend). Fills the whole hit and shrinks hit.t on a closer object; leaves hit untouched otherwise.
    lines.push('bool analytic_intersect(Ray ray, inout Hit hit) {');
    lines.push('    bool found = false;');
    lines.push('    float t;');
    for (const obj of objects) {
        const test = analyticTest(obj);
        const normal = analyticNormal(obj); // GLSL expr for the surface normal at hit.p
        lines.push(`    if (${test} && t < hit.t) {`);
        lines.push(`        hit.t = t; found = true;`);
        lines.push(`        hit.p = ambient_geodesic(ray.origin, ray.direction, t);`);
        lines.push(`        hit.frame = ambient_frame(hit.p, ${normal});`);
        lines.push(`        hit.region_to = ${obj.index}; hit.region_from = -1;`);
        lines.push(`        hit.uv = vec2(hit.p.x * 0.1, hit.p.z * 0.1);`);
        lines.push(`    }`);
    }
    lines.push('    return found;');
    lines.push('}');
    lines.push('');

    lines.push('bool analytic_intersect_any(Ray ray, float maxDist) {');
    lines.push('    float t;');
    for (const obj of objects) {
        lines.push(`    if (${analyticTest(obj)} && t < maxDist) return true;`);
    }
    lines.push('    return false;');
    lines.push('}');

    return lines.join('\n');
}

/** GLSL boolean test call that writes `t` for object `obj`. */
function analyticTest(obj: PlannedAnalyticObject): string {
    const p = obj.parameters;
    switch (obj.shapeType) {
        case 'sphere': {
            const center = formatVec3(p.center as number[] ?? [0, 0, 0]);
            const radius = formatFloat(p.radius as number ?? 1.0);
            return `ray_sphere(ray, ${center}, ${radius}, t)`;
        }
        case 'plane': {
            const normal = formatVec3(p.normal as number[] ?? [0, 1, 0]);
            const offset = formatFloat(p.offset as number ?? 0.0);
            return `ray_plane(ray, ${normal}, ${offset}, t)`;
        }
        default:
            throw new Error(`intersection: unsupported analytic type '${obj.shapeType}'`);
    }
}

/** GLSL expr for the outward surface normal at `hit.p` (matches the SDF gradient's orientation). */
function analyticNormal(obj: PlannedAnalyticObject): string {
    const p = obj.parameters;
    switch (obj.shapeType) {
        case 'sphere':
            return `normalize(hit.p - ${formatVec3(p.center as number[] ?? [0, 0, 0])})`;
        case 'plane':
            return formatVec3(p.normal as number[] ?? [0, 1, 0]);
        default:
            throw new Error(`intersection: unsupported analytic type '${obj.shapeType}'`);
    }
}

// ============================================================================
// region → material table (both backends)
// ============================================================================

function generateMaterialOf(sdf: PlannedSDFObject[], analytic: PlannedAnalyticObject[]): string {
    const lines: string[] = ['// Generated region -> material table (§2.3), across both backends'];
    lines.push('int material_of(int region) {');
    for (const obj of [...sdf, ...analytic].sort((a, b) => a.index - b.index)) {
        lines.push(`    if (region == ${obj.index}) return ${obj.materialId};`);
    }
    lines.push('    return -1;'); // ambient / no region = vacuum
    lines.push('}');
    return lines.join('\n');
}

// ============================================================================
// Combined scene_intersect / scene_intersect_any dispatcher
// ============================================================================
// Emitted for exactly the backends present. The running nearest lives on hit.t (initialized to the
// far clip); each backend takes (Ray, inout Hit) and updates hit only if it finds something closer,
// so nearest-hit + bound-shrinking fall out with the Ray read-only (multi-tracing.md §5). Occlusion
// takes an explicit maxDist. See docs/trace-loop-contract.md.

function generateSceneIntersect(hasSDF: boolean, hasAnalytic: boolean): string {
    const lines: string[] = ['// Generated scene_intersect dispatcher'];

    // scene_intersect — hit.t is the running nearest (a Hit is valid only when this returns true).
    lines.push('bool scene_intersect(Ray ray, out Hit hit) {');
    lines.push('    hit.t = MAX_DIST;   // running nearest = far clip; rest of hit undefined until a backend fills it');
    lines.push('    bool found = false;');
    if (hasAnalytic) lines.push('    if (analytic_intersect(ray, hit)) found = true;');
    if (hasSDF) lines.push('    if (sdf_intersect(ray, hit)) found = true;');   // bounded by hit.t → only closer
    lines.push('    return found;');
    lines.push('}');
    lines.push('');

    // scene_intersect_any — occlusion within maxDist
    lines.push('bool scene_intersect_any(Ray ray, float maxDist) {');
    if (hasAnalytic) lines.push('    if (analytic_intersect_any(ray, maxDist)) return true;');
    if (hasSDF) lines.push('    if (sdf_intersect_any(ray, maxDist)) return true;');
    lines.push('    return false;');
    lines.push('}');

    return lines.join('\n');
}
