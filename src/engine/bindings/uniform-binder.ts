// src/engine/bindings/uniform-binder.ts
/**
 * uniform-binder.ts — v2 (Parameter* types)
 * ------------------------------------------------------------
 * PURPOSE
 *   Bind logical parameter values to GPU uniforms using the compiled
 *   UniformManifest (logical → namespaced). Caches uniform locations and
 *   dispatches to the correct gl.uniform* based on ParameterKind.
 *
 * SCOPE
 *   - No runtime branching in shaders — this is purely a CPU-side binder.
 *   - No textures/samplers here (handled by ResourceBinder).
 *
 * SAFETY
 *   - If manifest lacks a logical uniform (e.g., pruned by linker),
 *     binding is skipped (false, or recorded in `skipped`).
 *   - If a uniform location is null (optimized out), binding is a no-op (false).
 */

import type { UniformManifest } from "../shaders/shader-compiler";
import type { ParameterKind, ParameterValue } from "../parameters/parameter-store";

export interface ProgramLike {
    getUniformLocation(name: string): WebGLUniformLocation | null;
}

export interface SetManyItem {
    logical: string;
    value: ParameterValue;
    kind?: ParameterKind;
}

export interface SetManyResult {
    bound: number;
    skipped: string[]; // logical names that couldn't be bound
}

export default class UniformBinder {
    private gl: WebGL2RenderingContext;
    private program: ProgramLike;
    private manifest: UniformManifest;
    private locCache = new Map<string, WebGLUniformLocation | null>(); // namespaced → location

    constructor(gl: WebGL2RenderingContext, program: ProgramLike, manifest: UniformManifest) {
        this.gl = gl;
        this.program = program;
        this.manifest = manifest;
    }

    /** Bind a single logical uniform; returns true if bound. */
    set(logical: string, value: ParameterValue, kind?: ParameterKind): boolean {
        const ns = this.manifest.byLogical[logical];
        if (!ns) return false; // not active / pruned
        const loc = this.loc(ns);
        if (!loc) return false; // optimized out

        const k = kind ?? inferKind(value);
        switch (k) {
            case "float":
                this.gl.uniform1f(loc, toNumber(value));
                return true;
            case "int":
                this.gl.uniform1i(loc, toInt(value));
                return true;
            case "boolean":
                this.gl.uniform1i(loc, toBoolInt(value));
                return true;
            case "vec2": {
                const v = toArray(value, 2);
                this.gl.uniform2f(loc, v[0], v[1]);
                return true;
            }
            case "vec3": {
                const v = toArray(value, 3);
                this.gl.uniform3f(loc, v[0], v[1], v[2]);
                return true;
            }
            case "vec4": {
                const v = toArray(value, 4);
                this.gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
                return true;
            }
            case "mat3": {
                const a = toMatrix(value, 9);
                this.gl.uniformMatrix3fv(loc, false, a);
                return true;
            }
            case "mat4": {
                const a = toMatrix(value, 16);
                this.gl.uniformMatrix4fv(loc, false, a);
                return true;
            }
            default:
                return false;
        }
    }

    /** Bind many logical uniforms at once. */
    setMany(items: SetManyItem[]): SetManyResult {
        let bound = 0;
        const skipped: string[] = [];
        for (const it of items) {
            if (this.set(it.logical, it.value, it.kind)) bound++;
            else skipped.push(it.logical);
        }
        return { bound, skipped };
    }

    /** Clear internal location cache (useful if a program is re-linked but binder kept). */
    clearCache(): void {
        this.locCache.clear();
    }

    // ---------- internals ----------

    private loc(nsName: string): WebGLUniformLocation | null {
        if (this.locCache.has(nsName)) return this.locCache.get(nsName)!;
        const L = this.program.getUniformLocation(nsName);
        this.locCache.set(nsName, L);
        return L;
    }
}

// ---------- helpers (type normalization / inference) ----------

function inferKind(v: ParameterValue): ParameterKind {
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "number")  return "float";
    if (Array.isArray(v)) {
        if (v.length === 2)  return "vec2";
        if (v.length === 3)  return "vec3";
        if (v.length === 4)  return "vec4";
        if (v.length === 9)  return "mat3";
        if (v.length === 16) return "mat4";
    } else if (v instanceof Float32Array) {
        if (v.length === 9)  return "mat3";
        if (v.length === 16) return "mat4";
    }
    // Fallback to float; caller can pass explicit kind to override.
    return "float";
}

function toNumber(v: ParameterValue): number {
    if (typeof v === "number") return v;
    throw new Error(`UniformBinder: expected number, got ${typeof v}`);
}

function toInt(v: ParameterValue): number {
    if (typeof v === "number") return v | 0;
    throw new Error(`UniformBinder: expected int/number, got ${typeof v}`);
}

function toBoolInt(v: ParameterValue): number {
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "number")  return v ? 1 : 0; // permissive
    throw new Error(`UniformBinder: expected boolean/number for boolean, got ${typeof v}`);
}

function toArray(
    v: ParameterValue,
    n: 2 | 3 | 4
): [number, number] | [number, number, number] | [number, number, number, number] {
    if (Array.isArray(v) && v.length === n) return v as any;
    throw new Error(`UniformBinder: expected vec${n} array length ${n}`);
}

function toMatrix(v: ParameterValue, n: 9 | 16): Float32Array {
    if (v instanceof Float32Array && v.length === n) return v;
    if (Array.isArray(v) && v.length === n) return new Float32Array(v);
    throw new Error(`UniformBinder: expected mat${n === 9 ? 3 : 4} array length ${n}`);
}
