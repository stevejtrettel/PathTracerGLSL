/**
 * ParameterStore — v1.1 (onChange hooks + compat aliases)
 * ------------------------------------------------------------
 * PURPOSE
 *   Central registry for engine parameters with:
 *     - explicit kinds (float/int/boolean/vecN/matN)
 *     - reset policy (none | accumulation | program)
 *     - strict validation + dirty tracking
 *     - scope (string) to group params by component (e.g., "Material/Lambert@1.0.0")
 *     - per-parameter onChange listeners (optional)
 */

export type ResetPolicy = "none" | "accumulation" | "program";

export type ParameterKind =
    | "float" | "int" | "boolean"
    | "vec2"  | "vec3" | "vec4"
    | "mat3"  | "mat4";

export type ParameterValue =
    | number
    | boolean
    | [number, number]
    | [number, number, number]
    | [number, number, number, number]
    | Float32Array
    | number[];

export interface ParameterDescriptor {
    /** Logical uniform/parameter name; should match the shader's logical name. */
    logical: string;
    /** Explicit GL/data shape; if omitted, inferred from `default`. */
    kind?: ParameterKind;
    /** Initial value. */
    default: ParameterValue;

    /** UI / constraints (optional) */
    label?: string;
    category?: string;
    min?: number;
    max?: number;
    step?: number;

    /** Reset strategy on change (default: "accumulation"). */
    resetPolicy?: ResetPolicy;

    /** Include in serialization (default: true). */
    persistent?: boolean;

    /** Optional help text. */
    description?: string;
}

/** Back-compat aliases some tests may import. */
export type ParamDescriptor = ParameterDescriptor;
export type ParamValue = ParameterValue;

export interface DirtyParameter {
    scope: string;
    logical: string;
    value: ParameterValue;
    kind: ParameterKind;
    resetPolicy: ResetPolicy;
}

/** Internal normalized descriptor (keeps optional hints optional). */
type FullDescriptor = {
    logical: string;
    kind: ParameterKind;
    default: ParameterValue;
    label: string;
    category: string;
    min?: number;
    max?: number;
    step?: number;
    resetPolicy: ResetPolicy;
    persistent: boolean;
    description?: string;
};

interface Entry {
    desc: FullDescriptor;
    value: ParameterValue;
    dirty: boolean;
}

function inferKindFromValue(v: ParameterValue): ParameterKind {
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
    // Fallback; caller should provide kind if ambiguous.
    return "float";
}

function sameValue(a: ParameterValue, b: ParameterValue): boolean {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }
    if (a instanceof Float32Array && b instanceof Float32Array && a.length === b.length) {
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }
    return false;
}

function validate(kind: ParameterKind, value: ParameterValue, desc: ParameterDescriptor): string | null {
    const fail = (msg: string) => `ParameterStore: ${desc.logical}: ${msg}`;

    switch (kind) {
        case "float":
            if (typeof value !== "number") return fail(`expected float number, got ${typeof value}`);
            break;
        case "int":
            if (typeof value !== "number" || !Number.isInteger(value)) return fail(`expected int, got ${value}`);
            break;
        case "boolean":
            if (typeof value !== "boolean") return fail(`expected boolean, got ${typeof value}`);
            break;
        case "vec2":
        case "vec3":
        case "vec4": {
            const n = kind === "vec2" ? 2 : kind === "vec3" ? 3 : 4;
            if (!Array.isArray(value) || value.length !== n) return fail(`expected ${kind} (length ${n}) array`);
            if (!value.every((x) => typeof x === "number")) return fail(`expected ${kind} numeric array`);
            break;
        }
        case "mat3":
        case "mat4": {
            const n = kind === "mat3" ? 9 : 16;
            const ok =
                (Array.isArray(value) && value.length === n && value.every((x) => typeof x === "number")) ||
                (value instanceof Float32Array && value.length === n);
            if (!ok) return fail(`expected ${kind} (length ${n}) array/Float32Array`);
            break;
        }
    }

    // Range checks (only for numeric scalars)
    if (typeof value === "number") {
        if (desc.min !== undefined && value < desc.min) return fail(`value ${value} < min ${desc.min}`);
        if (desc.max !== undefined && value > desc.max) return fail(`value ${value} > max ${desc.max}`);
    }

    return null;
}

type Listener = (val: ParameterValue, old: ParameterValue | undefined) => void;

export default class ParameterStore {
    // scope → logical → entry
    private table = new Map<string, Map<string, Entry>>();

    // onChange listeners: scope → logical → Set<listener>
    private listeners = new Map<string, Map<string, Set<Listener>>>();

    /** Register descriptors under a scope. Safe to call multiple times; updates descriptors. */
    register(scope: string, descriptors: ParameterDescriptor[]): void {
        if (!this.table.has(scope)) this.table.set(scope, new Map());
        const bucket = this.table.get(scope)!;

        for (const d of descriptors) {
            const kind: ParameterKind = d.kind ?? inferKindFromValue(d.default);
            const resetPolicy: ResetPolicy = d.resetPolicy ?? "accumulation";
            const persistent = d.persistent ?? true;

            const descFull: FullDescriptor = {
                logical: d.logical,
                kind,
                default: d.default,
                label: d.label ?? d.logical,
                category: d.category ?? "General",
                min: d.min,
                max: d.max,
                step: d.step,
                resetPolicy,
                persistent,
                description: d.description,
            };

            const existing = bucket.get(d.logical);
            if (existing) {
                // update descriptor but preserve current value & dirty flag
                existing.desc = descFull;
            } else {
                bucket.set(d.logical, { desc: descFull, value: d.default, dirty: false });
            }
        }
    }

    /** Returns true if a parameter exists. */
    has(scope: string, logical: string): boolean {
        const b = this.table.get(scope);
        return !!b && b.has(logical);
    }

    /** Get a current value (or undefined). */
    get(scope: string, logical: string): ParameterValue | undefined {
        return this.table.get(scope)?.get(logical)?.value;
    }

    /** Subscribe to changes for one parameter. Safe to call multiple times. */
    onChange(scope: string, logical: string, cb: Listener): void {
        if (!this.listeners.has(scope)) this.listeners.set(scope, new Map());
        const bucket = this.listeners.get(scope)!;
        if (!bucket.has(logical)) bucket.set(logical, new Set());
        bucket.get(logical)!.add(cb);
    }

    /** Set a value; marks dirty on successful validation and change, then notifies listeners. */
    set(scope: string, logical: string, value: ParameterValue): void {
        const bucket = this.table.get(scope);
        if (!bucket) {
            console.warn(`ParameterStore: unknown scope "${scope}"`);
            return;
        }
        const e = bucket.get(logical);
        if (!e) {
            console.warn(`ParameterStore: unknown param "${scope}.${logical}"`);
            return;
        }

        const err = validate(e.desc.kind, value, e.desc);
        if (err) {
            console.warn(err);
            return;
        }
        if (!sameValue(value, e.value)) {
            const old = e.value;
            e.value = value;
            e.dirty = true;
            this.emit(scope, logical, e.value, old);
        }
    }

    /** Mark all or some logicals in a scope as clean. If scope/logicals omitted, mark everything clean. */
    markClean(scope?: string, logicals?: string[]): void {
        if (!scope) {
            for (const [sc] of this.table) this.markClean(sc);
            return;
        }
        const bucket = this.table.get(scope);
        if (!bucket) return;

        if (!logicals) {
            for (const e of bucket.values()) e.dirty = false;
            return;
        }
        for (const name of logicals) {
            const e = bucket.get(name);
            if (e) e.dirty = false;
        }
    }

    /** Collect dirty parameters across all scopes; does NOT clear them. */
    collectDirty(): DirtyParameter[] {
        const out: DirtyParameter[] = [];
        for (const [scope, bucket] of this.table) {
            for (const [logical, e] of bucket) {
                if (!e.dirty) continue;
                out.push({
                    scope,
                    logical,
                    value: e.value,
                    kind: e.desc.kind,
                    resetPolicy: e.desc.resetPolicy,
                });
            }
        }
        return out;
    }

    /** List descriptors for a scope (for UI). */
    list(scope: string): ReadonlyArray<FullDescriptor> {
        const bucket = this.table.get(scope);
        if (!bucket) return [];
        return Array.from(bucket.values()).map((e) => e.desc);
    }

    /** Serialize persistent parameters. */
    serialize(): Record<string, Record<string, ParameterValue>> {
        const result: Record<string, Record<string, ParameterValue>> = {};
        for (const [scope, bucket] of this.table) {
            for (const [logical, e] of bucket) {
                if (!e.desc.persistent) continue;
                if (!result[scope]) result[scope] = {};
                result[scope][logical] = e.value;
            }
        }
        return result;
    }

    /**
     * Restore values from data. By default does NOT mark dirty & does NOT emit listeners (useful on load).
     * If `markDirty` is true, values that differ become dirty (still no emit).
     */
    deserialize(data: Record<string, Record<string, ParameterValue>>, markDirty = false): void {
        for (const [scope, params] of Object.entries(data)) {
            const bucket = this.table.get(scope);
            if (!bucket) continue;
            for (const [logical, value] of Object.entries(params)) {
                const e = bucket.get(logical);
                if (!e) continue;
                const err = validate(e.desc.kind, value, e.desc);
                if (err) {
                    console.warn(err);
                    continue;
                }
                if (markDirty) {
                    if (!sameValue(value, e.value)) {
                        e.value = value;
                        e.dirty = true;
                    }
                } else {
                    e.value = value;
                    e.dirty = false;
                }
            }
        }
    }

    /** Remove a whole scope (e.g., when a component is detached). */
    removeScope(scope: string): void {
        this.table.delete(scope);
        this.listeners.delete(scope);
    }

    /** Clear everything. */
    clear(): void {
        this.table.clear();
        this.listeners.clear();
    }

    // ---------- internals ----------

    private emit(scope: string, logical: string, val: ParameterValue, old: ParameterValue | undefined): void {
        const set = this.listeners.get(scope)?.get(logical);
        if (!set) return;
        for (const cb of set) {
            try { cb(val, old); } catch { /* swallow listener errors */ }
        }
    }
}
