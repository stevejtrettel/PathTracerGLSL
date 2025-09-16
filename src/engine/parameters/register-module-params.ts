// src/engine/parameters/register-module-params.ts
/**
 * register-module-params.ts — v2 (clean API)
 * ------------------------------------------------------------
 * PURPOSE
 *   Convenience helper to register a module's parameters into the global
 *   ParameterStore under a canonical scope label, with validation and a
 *   small scoped API (get/set/onChange) for callers.
 *
 *   Scope format: "<Kind>/<Name>@<Version>" (e.g., "Material/Lambert@1.0.0")
 *
 * NOTES
 *   - Uses the new Parameter* types (no Param* aliases).
 *   - If resetPolicy is omitted in the schema, the store's default
 *     (currently "accumulation") will apply.
 */

import type { ComponentID } from "../../core/ids";
import type {
    ParameterKind,
    ParameterValue,
    ResetPolicy,
    ParameterDescriptor,
} from "./parameter-store";

// Only the methods we need from the real store.
export interface ParameterStoreReg {
    register(scope: string, descriptors: ParameterDescriptor[]): void;
    set(scope: string, logical: string, value: ParameterValue): void;
    get(scope: string, logical: string): ParameterValue | undefined;
    onChange?(
        scope: string,
        logical: string,
        cb: (val: ParameterValue, old: ParameterValue | undefined) => void
    ): void;
}

/** Canonical scope label used everywhere in the engine. */
export function formatComponentScope(id: ComponentID): string {
    return `${id.kind}/${id.name}@${id.version}`;
}

/** Minimal spec for a single parameter provided by a module. */
export interface ModuleParamSpec {
    name: string;
    kind: ParameterKind;
    default: ParameterValue;
    /** When changed, how should the engine react? (omit to use store default) */
    resetPolicy?: ResetPolicy;
    /** Optional numeric UI hints. */
    min?: number;
    max?: number;
    step?: number;
    /** Persist across sessions (default: true). */
    persistent?: boolean;
    /** Optional help text. */
    description?: string;
    /** Optional UI category/label (forwarded as hints). */
    label?: string;
    category?: string;
}

/** Schema = simple array of specs (explicit > magic). */
export type ModuleParamSchema = ModuleParamSpec[];

/** Return type of registerModuleParams — a tiny scoped API for the caller. */
export interface ModuleParamView {
    scope: string;
    names: string[]; // in registration order
    get(name: string): ParameterValue | undefined;
    set(name: string, value: ParameterValue): void;
    onChange(name: string, cb: (val: ParameterValue, old: ParameterValue | undefined) => void): void;
}

/**
 * Register all module parameters into the store under a canonical scope,
 * validating uniqueness and constructing full descriptors from the simple schema.
 */
export function registerModuleParams(
    store: ParameterStoreReg,
    id: ComponentID,
    schema: ModuleParamSchema
): ModuleParamView {
    const scope = formatComponentScope(id);

    // Validate uniqueness
    const seen = new Set<string>();
    for (const s of schema) {
        if (seen.has(s.name)) {
            throw new Error(`registerModuleParams: duplicate parameter "${s.name}" in scope "${scope}"`);
        }
        seen.add(s.name);
    }

    // Normalize to ParameterDescriptor[] (let store fill defaults where omitted)
    const descriptors: ParameterDescriptor[] = schema.map((s) => ({
        logical: s.name,
        kind: s.kind,
        default: s.default,
        resetPolicy: s.resetPolicy,            // if undefined, store uses its default ("accumulation")
        min: s.min,
        max: s.max,
        step: s.step,
        persistent: s.persistent !== false,    // default true
        description: s.description,
        label: s.label ?? s.name,
        category: s.category ?? "General",
    }));

    // Register with the store
    store.register(scope, descriptors);

    // Tiny scoped view for ergonomics
    const view: ModuleParamView = {
        scope,
        names: descriptors.map((d) => d.logical),
        get: (name) => store.get(scope, name),
        set: (name, value) => store.set(scope, name, value),
        onChange: (name, cb) => {
            if (typeof store.onChange === "function") store.onChange(scope, name, cb);
        },
    };

    return view;
}
