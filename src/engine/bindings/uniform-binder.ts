// src/engine/bindings/uniform-binder.ts
/**
 * uniform-binder.ts — v2.2 (manifest-aware defaults + sampler support)
 * ------------------------------------------------------------
 * PURPOSE
 *   Bind logical parameter values to GPU uniforms using the compiled
 *   UniformManifest. Caches uniform locations and dispatches to the correct
 *   gl.uniform* based on ParameterKind, preferring GLSL-declared types when
 *   the caller does not specify a kind.
 *
 * NOTES
 *   - Handles *sampler* uniforms too (looked up from manifest.samplers),
 *     so ResourceBinder can call binder.setMany([...{kind:"int"}...]) and
 *     get correct locations even though samplers are not in byLogical.
 *   - Never throws from setMany; bad shapes/types are skipped.
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

    // Cache: namespaced → location
    private locCache = new Map<string, WebGLUniformLocation | null>();

    // Lookup helpers built once
    private typeByLogical = new Map<string, string | undefined>();     // declared GLSL type (if known)
    private samplerNsByLogical = new Map<string, string>();            // logical → namespaced for samplers

    constructor(gl: WebGL2RenderingContext, program: ProgramLike, manifest: UniformManifest) {
        this.gl = gl;
        this.program = program;
        this.manifest = manifest;

        // Precompute declared types for defaults
        for (const e of manifest.entries) {
            this.typeByLogical.set(e.logicalName, e.type);
        }
        // Precompute sampler namespaced lookups (manifest.samplers may be empty)
        if (Array.isArray(manifest.samplers)) {
            for (const s of manifest.samplers) {
                this.samplerNsByLogical.set(s.logical, s.namespaced);
            }
        }
    }

    /** Bind a single logical uniform; returns true if bound. */
    set(logical: string, value: ParameterValue, kind?: ParameterKind): boolean {
        const ns = this.resolveNamespaced(logical, kind);
        if (!ns) return false; // not active / unknown

        const loc = this.loc(ns);
        if (!loc) return false; // optimized out

        const k = kind ?? this.defaultKindFromManifest(logical, value);

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

    /** Bind many logical uniforms at once. Never throws; accumulates skips. */
    setMany(items: SetManyItem[]): SetManyResult {
        let bound = 0;
        const skipped: string[] = [];
        for (const it of items) {
            try {
                if (this.set(it.logical, it.value, it.kind)) bound++;
                else skipped.push(it.logical);
            } catch {
                // Bad type/shape; skip instead of crashing the frame.
                skipped.push(it.logical);
            }
        }
        return { bound, skipped };
    }

    /** Clear internal location cache (useful if a program is re-linked but binder kept). */
    clearCache(): void {
        this.locCache.clear();
    }

    // ---------- internals ----------

    /** Resolve namespaced uniform name for either a non-sampler or sampler logical. */
    private resolveNamespaced(logical: string, kind?: ParameterKind): string | null {
        // Non-samplers live here
        const ns = this.manifest.byLogical[logical];
        if (ns) return ns;

        // Samplers are excluded from byLogical; look in sampler map.
        // We don’t require kind === "int" here to be resilient; if there’s a sampler
        // with that logical name, prefer it.
        const sns = this.samplerNsByLogical.get(logical);
        return sns ?? null;
    }

    /** Prefer GLSL-declared type when available; otherwise infer from value. */
    private defaultKindFromManifest(logical: string, value: ParameterValue): ParameterKind {
        const t = this.typeByLogical.get(logical);
        if (t) {
            const k = mapDeclaredTypeToKind(t);
            if (k) return k;
        }
        return inferKind(value);
    }

    private loc(nsName: string): WebGLUniformLocation | null {
        if (this.locCache.has(nsName)) return this.locCache.get(nsName)!;
        const L = this.program.getUniformLocation(nsName);
        this.locCache.set(nsName, L);
        return L;
    }
}

// ---------- helpers (type normalization / inference) ----------

function mapDeclaredTypeToKind(t: string): ParameterKind | null {
    // normalize
    const s = t.trim();
    if (s === "float") return "float";
    if (s === "int") return "int";
    if (s === "bool" || s === "boolean") return "boolean";
    if (s === "vec2") return "vec2";
    if (s === "vec3") return "vec3";
    if (s === "vec4") return "vec4";
    if (s === "mat3") return "mat3";
    if (s === "mat4") return "mat4";
    // Note: int/bool vector uniforms (ivecN/bvecN) are not currently supported
    // by ParameterKind; if you add them later, extend this mapping.
    // Samplers are handled separately by ResourceBinder and are passed as kind:"int".
    return null;
}

function inferKind(v: ParameterValue): ParameterKind {
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "number") return "float";
    if (Array.isArray(v)) {
        if (v.length === 2) return "vec2";
        if (v.length === 3) return "vec3";
        if (v.length === 4) return "vec4";
        if (v.length === 9) return "mat3";
        if (v.length === 16) return "mat4";
    } else if (v instanceof Float32Array) {
        if (v.length === 2) return "vec2";
        if (v.length === 3) return "vec3";
        if (v.length === 4) return "vec4";
        if (v.length === 9) return "mat3";
        if (v.length === 16) return "mat4";
    }
    return "float";
}

function toNumber(v: ParameterValue): number {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    throw new Error(`UniformBinder: expected number`);
}

function toInt(v: ParameterValue): number {
    if (typeof v === "number" && Number.isFinite(v)) return v | 0;
    throw new Error(`UniformBinder: expected int/number`);
}

function toBoolInt(v: ParameterValue): number {
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "number") return v ? 1 : 0; // permissive
    throw new Error(`UniformBinder: expected boolean/number for boolean`);
}

function toArray(
    v: ParameterValue,
    n: 2 | 3 | 4
): [number, number] | [number, number, number] | [number, number, number, number] {
    if (Array.isArray(v) && v.length === n) return v as any;
    if (v instanceof Float32Array && v.length === n) return (v as any);
    throw new Error(`UniformBinder: expected vec${n} (array or Float32Array length ${n})`);
}

function toMatrix(v: ParameterValue, n: 9 | 16): Float32Array {
    if (v instanceof Float32Array && v.length === n) return v;
    if (Array.isArray(v) && v.length === n) return new Float32Array(v);
    throw new Error(`UniformBinder: expected mat${n === 9 ? 3 : 4} array length ${n}`);
}
