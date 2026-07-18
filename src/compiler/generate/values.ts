// compiler/generate/values.ts
// THE ONE PLACE the SCENE_VALUE constant/driven split is decided (Model B, owner-locked Jul 18 2026).
//
//   CONSTANT value  → baked inline as a literal.
//   DRIVEN {param}  → a `u_`-prefixed uniform read. The `u_` prefix is the "this is LIVE"
//                     marker — a specializing compiler shows what it baked vs parameterized,
//                     so the distinction stays visible at every use site.
//
// ── The decision procedure (which mechanism does a quantity use?) ──────────────────────────
// "constant vs uniform" is not one decision; it is a classification over categories, each with
// ONE canonical mechanism. Classify any quantity the shader needs, in order:
//   1. Changes the SHAPE of the computation (which objects/models/loop/projection)? → STRUCTURAL
//      (codegen literals / #define selector — recompile to change).
//   2. A coordinate FRAME on the geometry query?                                    → FRAME_PLACEMENT
//      (fold when constant / rigid-frame uniform pair when driven — Planner).
//   3. A camera control (the measuring instrument)?                                 → INSTRUMENT
//      (always a uniform — features/camera.ts).
//   4. Engine plumbing (RNG / sample count / resolution / image size)?              → ENGINE_BUILTIN
//      (always a uniform).
//   5. DERIVED from other params once per frame (CDF, camera basis, cos/sin, aspect)? → DERIVED
//      (a CPU `compute` closure → uniform / float[] — NEVER recomputed per-thread on the GPU).
//   6. Otherwise an authored SCENE value (albedo, emission, ior, sky color)          → SCENE_VALUE
//      (THIS file — emitValue / mintValueUniform).
//
// Every family that emits a SCENE_VALUE (materials, media, lights, the constant-env color, the
// region-indexed ior) routes its use sites through emitValue and its declarations through
// mintValueUniform — enforced by tests/compiler/valuesSplitPoint.test.ts. One DERIVED exception
// keeps its own idiom because it is not a name swap: the light selection CDF (a float[] fed by
// computeSelectPdf). The environment's intensity/rotation are the deliberate always-live controls.

import { isValueParam, isGlslExpression, type Vec3, type ValueParam, type GlslExpression, type ParameterMetadata } from '../types.js';
import type { PlannedUniform } from '../plan/types.js';
import { paramToUniform } from '../../components/glsl-format.js';

/** A parameter-surface value: constant, driven ({param}), or a spatial expression
 *  (heterogeneous media only — the third axis, orthogonal to the constant/driven split). */
export type ParamValue = Vec3 | number | GlslExpression | ValueParam<Vec3 | number>;

/**
 * USE SITE. What the emitted GLSL reads for a value:
 *   driven  → its `u_` uniform name (live),
 *   expr    → `exprFormat(e)` (default: the raw source; media coefficients override it to
 *             clamp; media phase params override it to throw — expressions are Validator-rejected there),
 *   const   → the baked literal via `format`.
 */
export function emitValue(
    v: ParamValue,
    format: (x: never) => string,
    exprFormat: (e: GlslExpression) => string = (e) => e.source,
): string {
    if (isValueParam(v)) return paramToUniform(v.param);
    if (isGlslExpression(v)) return exprFormat(v);
    return format(v as never);
}

/**
 * DECLARATION + slider. Mint the uniform and ParameterMetadata for a DRIVEN value (or the
 * declared params of an EXPRESSION); a no-op for a constant. `seen` dedups a param path shared
 * across materials/lights (§2.8) — the merge also dedups by name, so a hittable light's
 * material-declared emission uniform and the light feature's are one and the same.
 */
export function mintValueUniform(
    prop: ParamValue,
    glslType: 'vec3' | 'float',
    metaType: 'color' | 'float',
    uniforms: PlannedUniform[],
    parameters: Record<string, ParameterMetadata>,
    seen: Set<string>,
): void {
    // Expression-declared params (heterogeneous D4): each declared slider becomes a live FLOAT
    // uniform named from its path, exactly like a ValueParam — the expression source references
    // the derived name (u_fog_gain).
    if (isGlslExpression(prop)) {
        for (const p of prop.params ?? []) {
            if (seen.has(p.param)) continue;   // expressions may share one driven parameter
            seen.add(p.param);
            uniforms.push({ name: paramToUniform(p.param), type: 'float', parameterPath: p.param, default: p.default });
            const seg = p.param.split('.');
            parameters[p.param] = {
                type: 'float', default: p.default, name: capitalize(seg[seg.length - 1]),
                group: seg.length > 1 ? seg[0] : undefined, triggersReset: true,
                ...(p.min !== undefined && p.max !== undefined ? { range: [p.min, p.max] } : {}),
            };
        }
        return;
    }
    if (!isValueParam(prop)) return;
    const path = prop.param;
    if (seen.has(path)) return;   // materials/lights may share one driven parameter (§2.8)
    seen.add(path);

    uniforms.push({
        name: paramToUniform(path),
        type: glslType,
        parameterPath: path,
        default: prop.default as number | number[] | undefined,
        // Spectrum properties broadcast an achromatic scalar parameter — preserve that for
        // live updates, not only the planned default.
        ...(glslType === 'vec3' ? {
            compute: (params: Record<string, unknown>) => {
                const value = params[path] ?? prop.default;
                return typeof value === 'number' ? [value, value, value] : value as number[];
            },
        } : {}),
    });

    const seg = path.split('.');
    parameters[path] = {
        type: metaType,
        default: prop.default,
        name: capitalize(seg[seg.length - 1]),
        group: seg.length > 1 ? seg[0] : undefined,
        triggersReset: true,
        ...(prop.min !== undefined && prop.max !== undefined ? { range: [prop.min, prop.max] } : {}),
    };
}

function capitalize(s: string): string {
    return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
