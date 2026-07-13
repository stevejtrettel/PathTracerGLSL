// compiler/generate/features/intersection.ts
// Geometry backends + the generated scene_intersect dispatcher.
//
// A scene may use the SDF backend (marching), the analytic backend (closed-form), or both.
// scene_intersect / scene_intersect_any are GENERATED to combine only the backends present —
// so "swapping the details of intersect" is exactly what the codegen does. Region ids are
// globally unique across both backends (§2.3), so material_of() spans them.

import type { RenderPlan, PlannedSDFObject, PlannedAnalyticObject, PlannedMaterial } from '../../plan/types.js';
import { isGlslExpression, isValueParam } from '../../types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import type { ShaderBlock } from '../ShaderIR.js';
import { formatFloat, formatVec3, paramToUniform } from '../../../components/glsl-format.js';
import { modelTransmission } from '../../../components/materials/index.js';
import { quadNormal } from '../../../components/geometry/index.js';

import sdfPrimitivesGLSL from '../../../components/geometry/sdf_primitives.glsl?raw';
import raymarchGLSL from '../../../components/geometry/raymarch.glsl?raw';
import analyticPrimitivesGLSL from '../../../components/geometry/analytic_primitives.glsl?raw';

export function contributeIntersection(plan: RenderPlan): FeatureContribution {
    if (plan.program.intersection.method !== 'raymarch') {
        return emptyContribution('intersection');
    }

    const hasSDF = plan.objects.length > 0;
    const hasAnalytic = plan.analyticObjects.length > 0;
    const blocks: ShaderBlock[] = [];

    // SDF backend: primitives + per-scene march-bound dispatch + the marcher (sdf_intersect*).
    if (hasSDF) {
        blocks.push({ origin: 'components/geometry/sdf_primitives.glsl', source: sdfPrimitivesGLSL });
        blocks.push({ origin: 'generated:sdf-dispatch', source: generateSDFDispatch(plan.objects) });
        blocks.push({ origin: 'components/geometry/raymarch.glsl', source: raymarchGLSL });
    }

    // Analytic backend: closed-form primitives + per-scene analytic_intersect* dispatch.
    if (hasAnalytic) {
        blocks.push({ origin: 'components/geometry/analytic_primitives.glsl', source: analyticPrimitivesGLSL });
        blocks.push({ origin: 'generated:analytic-dispatch', source: generateAnalyticDispatch(plan.analyticObjects) });
    }

    // region → material table spans BOTH backends (regions are globally unique).
    blocks.push({ origin: 'generated:material-of', source: generateMaterialOf(plan.objects, plan.analyticObjects, plan.ambientMedium) });

    // region → IOR table (§2.3 generated-tables family) — only when a transmissive model
    // reads it (capability-driven, R1a — the far side's IOR has no shading point).
    if (plan.materials.some((m) => modelTransmission(m.model))) {
        blocks.push({ origin: 'generated:ior-of', source: generateIorOf(plan.objects, plan.analyticObjects, plan.materials) });
    }

    // Point classification (§2.7 innermost-wins) — consumed by the dispatcher's §4.2 step.
    blocks.push({ origin: 'generated:scene-region-at', source: generateSceneRegionAt(plan.objects, plan.analyticObjects) });

    // The top-level dispatcher, combining only the backends present (declared after both).
    // Zero-thickness regions (analytic quads): their SDF never claims containment, so the
    // dispatcher's owner-covers-own-side shortcut is invalid for them (audit H2).
    const thinRegions = plan.analyticObjects.filter((o) => o.shapeType === 'quad').map((o) => o.index);
    blocks.push({ origin: 'generated:scene-intersect', source: generateSceneIntersect(hasSDF, hasAnalytic, thinRegions) });

    // T4 seams: the geometry/region contract surface (§2.3 tables + the trace-loop queries).
    const provides = [
        { name: 'scene_intersect', signature: 'bool scene_intersect(Ray ray, out Hit hit)' },
        { name: 'scene_intersect_any', signature: 'bool scene_intersect_any(Ray ray, float maxDist)' },
        { name: 'scene_region_at', signature: 'int scene_region_at(vec3 p)' },
        { name: 'material_of', signature: 'int material_of(int region)' },
    ];
    if (plan.materials.some((m) => modelTransmission(m.model))) {
        provides.push({ name: 'ior_of', signature: 'float ior_of(int region)' });
    }

    return { ...emptyContribution('intersection'), blocks, provides };
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

    // scene_march_bound — UNSIGNED nearest-surface bound min|sdf_i| + its owner (§2.3, arg-min).
    // Unsigned (not the signed min) so marching works from object interiors and, inside a big
    // region, steps stay bounded by nested inner surfaces (|signed min| would overshoot them).
    lines.push('float scene_march_bound(vec3 p, out int region) {');
    lines.push(`    float d = 1e20;`);
    lines.push(`    float d_obj;`);
    lines.push(`    region = -1;`);
    for (const obj of objects) {
        lines.push(`    d_obj = abs(sdf_object_${obj.index}(p));`);
        lines.push(`    if (d_obj < d) { d = d_obj; region = ${obj.index}; }`);
    }
    lines.push(`    return d;`);
    lines.push(`}`);
    lines.push('');

    // Per-owner signed SDF — scene_normal takes the gradient of the HIT OBJECT's own field.
    // The global signed min is hijacked by containers: on a nested surface (glass sphere inside
    // a water pool) the pool's deeply-negative sdf wins the min everywhere inside, and its
    // gradient points at the nearest POOL face — cube-quantized normals on the sphere
    // (found by the R-SUBMERGED witness).
    lines.push('float scene_object_sdf(vec3 p, int region) {');
    for (const obj of objects) {
        lines.push(`    if (region == ${obj.index}) return sdf_object_${obj.index}(p);`);
    }
    lines.push('    return 1e20;');
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
    // backend). Fills the hit's GEOMETRY + owner and shrinks hit.t on a closer object; leaves hit
    // untouched otherwise. region_from/to are classified once by the dispatcher (§4.2).
    lines.push('bool analytic_intersect(Ray ray, inout Hit hit) {');
    lines.push('    bool found = false;');
    lines.push('    float t;');
    for (const obj of objects) {
        const test = analyticTest(obj);
        const normal = analyticNormal(obj); // GLSL expr for the OUTWARD surface normal at hit.p
        lines.push(`    if (${test} && t < hit.t) {`);
        lines.push(`        hit.t = t; found = true;`);
        lines.push(`        hit.p = ambient_geodesic(ray.origin, ray.direction, t);`);
        lines.push(`        hit.frame = ambient_frame(hit.p, ${normal});`);
        lines.push(`        hit.region_owner = ${obj.index};`);
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
        case 'quad': {
            const corner = formatVec3(p.corner as number[] ?? [0, 0, 0]);
            const edge1 = p.edge1 as number[] ?? [1, 0, 0];
            const edge2 = p.edge2 as number[] ?? [0, 0, 1];
            return `ray_quad(ray, ${corner}, ${formatVec3(edge1)}, ${formatVec3(edge2)}, ${formatVec3(quadNormal(edge1, edge2))}, t)`;
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
        case 'quad':
            // The emitting side (impl-plan-area-lights: one-sided pin). Back-face hits get the
            // dispatcher's exit flip, which keys emission on the region BEHIND — dark, correct.
            return formatVec3(quadNormal(p.edge1 as number[] ?? [1, 0, 0], p.edge2 as number[] ?? [0, 0, 1]));
        default:
            throw new Error(`intersection: unsupported analytic type '${obj.shapeType}'`);
    }
}

/** GLSL expr for the SIGNED distance to `obj` at point `p` (analytic backend; matches SDF sign). */
function analyticSignedDistance(obj: PlannedAnalyticObject): string {
    const p = obj.parameters;
    switch (obj.shapeType) {
        case 'sphere': {
            const center = formatVec3(p.center as number[] ?? [0, 0, 0]);
            const radius = formatFloat(p.radius as number ?? 1.0);
            return `length(p - ${center}) - ${radius}`;
        }
        case 'plane': {
            const normal = formatVec3(p.normal as number[] ?? [0, 1, 0]);
            const offset = formatFloat(p.offset as number ?? 0.0);
            return `dot(p, ${normal}) + ${offset}`;
        }
        case 'quad':
            // Zero-thickness: never contains a point, so it never claims a region in
            // scene_region_at — which is exactly what makes it one-sided under region_to.
            return '1.0e20';
        default:
            throw new Error(`intersection: unsupported analytic type '${obj.shapeType}'`);
    }
}

// ============================================================================
// Point classification — scene_region_at (§2.7 innermost-wins, §4.2)
// ============================================================================
// Among regions containing p (sdf < 0), the LEAST negative wins (innermost). The bug is one
// flipped inequality away: `d > best` among negatives — deepest-wins made a submerged sphere
// invisible (verification T2 / R-SUBMERGED). Spans both backends.

function generateSceneRegionAt(sdf: PlannedSDFObject[], analytic: PlannedAnalyticObject[]): string {
    const lines: string[] = ['// Generated point classification (§2.7 innermost-wins)'];
    lines.push('int scene_region_at(vec3 p) {');
    lines.push('    int region = -1;');
    lines.push('    float best = -1.0e20;   // best = least-negative inside distance so far');
    lines.push('    float d;');
    for (const obj of sdf) {
        lines.push(`    d = sdf_object_${obj.index}(p);`);
        lines.push(`    if (d < 0.0 && d > best) { best = d; region = ${obj.index}; }`);
    }
    for (const obj of analytic) {
        lines.push(`    d = ${analyticSignedDistance(obj)};`);
        lines.push(`    if (d < 0.0 && d > best) { best = d; region = ${obj.index}; }`);
    }
    lines.push('    return region;');
    lines.push('}');
    return lines.join('\n');
}

// ============================================================================
// region → material table (both backends)
// ============================================================================

function generateMaterialOf(sdf: PlannedSDFObject[], analytic: PlannedAnalyticObject[], ambientMedium: number): string {
    const lines: string[] = ['// Generated region -> material table (§2.3), across both backends'];
    lines.push('int material_of(int region) {');
    for (const obj of [...sdf, ...analytic].sort((a, b) => a.index - b.index)) {
        lines.push(`    if (region == ${obj.index}) return ${obj.materialId};`);
    }
    // Default arm covers region -1: the ambientMedium's material id, or -1 = vacuum (§2.4).
    lines.push(`    return ${ambientMedium};`);
    lines.push('}');
    return lines.join('\n');
}

// region → IOR of the region's interior (reference-implementations §2: dielectrics read the far
// side's IOR without a full material-properties fetch). Non-dielectric materials are 1.0
// (vacuum-like — pinned in the Planner), ior_of(-1) = 1.0 (ambient; ambientMedium is a media-era
// concern, §2.4). Value<T>-driven ior reads its uniform (declared via the materials {param} scan).
function generateIorOf(sdf: PlannedSDFObject[], analytic: PlannedAnalyticObject[], materials: PlannedMaterial[]): string {
    const byId = new Map(materials.map((m) => [m.id, m]));
    const lines: string[] = ['// Generated region -> IOR table (§2.3 family)'];
    lines.push('float ior_of(int region) {');
    for (const obj of [...sdf, ...analytic].sort((a, b) => a.index - b.index)) {
        const mat = byId.get(obj.materialId);
        // Non-transmissive materials are PINNED to 1.0 (fall through to the default), even if the
        // author set an ior on them — an authored lambert ior leaking into the table silently
        // yields η = 1 at adjacent dielectric boundaries (review finding). The Validator warns.
        if (!mat || !modelTransmission(mat.model)) continue;
        let expr: string;
        if (isValueParam(mat.ior)) {
            expr = paramToUniform(mat.ior.param);
        } else if (isGlslExpression(mat.ior)) {
            // Backstop only — the Validator rejects this with a proper diagnostic upstream.
            throw new Error(`intersection: material '${mat.name}': ior cannot be a GLSL expression (ior_of is region-indexed, no shading point)`);
        } else {
            expr = formatFloat(mat.ior);
        }
        lines.push(`    if (region == ${obj.index}) return ${expr};`);
    }
    lines.push('    return 1.0;'); // ambient / vacuum / non-transmissive regions
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
// After the nearest hit is final, the dispatcher classifies the boundary ONCE (§4.2 "never per
// march step"): the owner covers its own side, so a single probe classifies the outside. The probe
// runs along the GEOMETRIC NORMAL, not the ray — the marcher stops MARCH_EPSILON shy of the
// surface, so ray-direction probes fail at grazing incidence; normal probes always clear the
// residual (EPS_INTERFACE = 10× MARCH_EPSILON). Entering ⇒ region_to = owner; exiting ⇒
// region_from = owner and the frame flips so n faces region_from (§4.1).

function generateSceneIntersect(hasSDF: boolean, hasAnalytic: boolean, thinRegions: number[]): string {
    const lines: string[] = ['// Generated scene_intersect dispatcher'];

    // Zero-thickness owners (quads) never claim containment in scene_region_at, so
    // "owner covers its own side" is FALSE for them: a back-face hit must probe the entering
    // side instead of fabricating region_from = owner — the fabricated value feeds the §4.4
    // self-heal and drops one segment of medium attenuation behind the quad (audit H2).
    if (thinRegions.length > 0) {
        lines.push('bool scene_region_thin(int region) {');
        lines.push(`    return ${thinRegions.map((r) => `region == ${r}`).join(' || ')};`);
        lines.push('}');
        lines.push('');
    }

    // scene_intersect — hit.t is the running nearest (a Hit is valid only when this returns true).
    lines.push('bool scene_intersect(Ray ray, out Hit hit) {');
    lines.push('    hit.t = MAX_DIST;   // running nearest = far clip; rest of hit undefined until a backend fills it');
    lines.push('    bool found = false;');
    if (hasAnalytic) lines.push('    if (analytic_intersect(ray, hit)) found = true;');
    if (hasSDF) lines.push('    if (sdf_intersect(ray, hit)) found = true;');   // bounded by hit.t → only closer
    lines.push('    if (found) {');
    lines.push('        // §4.2/§4.3: one outside-probe along the outward normal; owner covers its own side.');
    lines.push('        int outside = scene_region_at(ambient_geodesic(hit.p, hit.frame.n, EPS_INTERFACE));');
    lines.push('        if (ambient_dot(ray.direction, hit.frame.n, hit.p) < 0.0) {');
    lines.push('            hit.region_from = outside;              // entering the owner');
    lines.push('            hit.region_to   = hit.region_owner;');
    lines.push('        } else {');
    if (thinRegions.length > 0) {
        lines.push('            // Back-face hit on a zero-thickness owner: probe the entering (-n) side.');
        lines.push('            hit.region_from = scene_region_thin(hit.region_owner)');
        lines.push('                ? scene_region_at(ambient_geodesic(hit.p, hit.frame.n, -EPS_INTERFACE))');
        lines.push('                : hit.region_owner;             // solid owners cover their own side');
    } else {
        lines.push('            hit.region_from = hit.region_owner;     // exiting the owner');
    }
    lines.push('            hit.region_to   = outside;');
    lines.push('            hit.frame = ambient_frame(hit.p, -hit.frame.n);   // §4.1: n faces region_from');
    lines.push('        }');
    lines.push('    }');
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
