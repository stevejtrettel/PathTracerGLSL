// src/tracer/VariantManager.ts
import type { Plugin, Role } from "../core/types";
import type { CompiledPipeline, VariantRecord } from "./types";

export default class VariantManager {
    private variants = new Map<string, VariantRecord>();
    private activeVariantName: string | null = null;

    /** Register or replace a named variant with role overrides (any subset of roles). */
    addVariant(name: string, overrides: { [R in Role]?: Plugin }): void {
        const map = new Map<Role, Plugin>();
        let controls: Plugin | undefined;

        for (const role of Object.keys(overrides) as Role[]) {
            const p = overrides[role]!;
            map.set(role, p);
            if (role === "controls") controls = p;
        }

        this.variants.set(name, { name, overrides: map, controls });
    }

    /** Build/compile all variants against the current base plugin set. */
    buildAllVariants(
        basePlugins: Plugin[],
        buildForPlugins: (plugins: Plugin[]) => CompiledPipeline
    ): void {
        for (const [name, v] of this.variants.entries()) {
            const resolved = this.resolveVariantPlugins(v, basePlugins);
            v.compiled = buildForPlugins(resolved);
            // Lightweight diagnostics for dev:
            // eslint-disable-next-line no-console
            console.log(
                `[VariantManager] Built variant "${name}" with overrides: ${
                    Array.from(v.overrides.keys()).join(", ") || "none"
                }`
            );
        }
    }

    /** Select an active variant by name; pass null to revert to base. */
    useVariant(name: string | null): void {
        if (name === null) {
            this.activeVariantName = null;
            return;
        }
        if (!this.variants.has(name)) {
            // eslint-disable-next-line no-console
            console.warn(`[VariantManager] Variant "${name}" is not defined.`);
            return;
        }
        const v = this.variants.get(name)!;
        if (!v.compiled) {
            // eslint-disable-next-line no-console
            console.warn(`[VariantManager] Variant "${name}" has not been built yet.`);
            return;
        }
        this.activeVariantName = name;
    }

    /** Return the compiled pipeline for the active selection (variant or base). */
    getActiveCompiled(baseCompiled?: CompiledPipeline): CompiledPipeline | undefined {
        if (this.activeVariantName === null) return baseCompiled;
        const v = this.variants.get(this.activeVariantName);
        return v?.compiled ?? baseCompiled;
    }

    /** Return the active controls plugin (variant override takes precedence over base). */
    getActiveControls(baseControls?: Plugin): Plugin | undefined {
        if (this.activeVariantName !== null) {
            const v = this.variants.get(this.activeVariantName);
            if (v?.controls) return v.controls;
        }
        return baseControls;
    }

    /** For UI or debugging. */
    listVariantNames(): string[] {
        return Array.from(this.variants.keys());
    }

    /** Helper: merge base with overrides (excluding controls for shader compilation). */
    private resolveVariantPlugins(v: VariantRecord, basePlugins: Plugin[]): Plugin[] {
        const byRole = new Map<Role, Plugin>();
        for (const p of basePlugins) byRole.set(p.role, p);
        for (const [role, plugin] of v.overrides) {
            if (role === "controls") continue; // controls are CPU-side; not part of shader program
            byRole.set(role, plugin);
        }
        return Array.from(byRole.values());
    }


    /** Dispose all compiled variant programs (does NOT touch the base program). */
    disposeAllPrograms(): void {
        for (const v of this.variants.values()) {
            if (v.compiled) {
                v.compiled.program.delete();
                v.compiled = undefined;
            }
        }
        this.activeVariantName = null;
    }
}
