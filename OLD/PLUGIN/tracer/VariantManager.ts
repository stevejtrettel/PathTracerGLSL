// src/tracer/VariantManager.ts
import type { Plugin, Role } from "../core/types";
import type { CompiledPipeline, VariantRecord } from "./types";

export default class VariantManager {
    private variants = new Map<string, VariantRecord>();
    private activeVariantName: string | null = null;

    /** Register or replace a named variant with role overrides (any subset of roles). */
    addVariant(name: string, overrides: { [R in Role]?: Plugin }): void {
        const map = new Map<Role, Plugin>();
        for (const role of Object.keys(overrides) as Role[]) {
            map.set(role, overrides[role]!);
        }
        this.variants.set(name, { name, overrides: map });
    }

    /** Build/compile all variants against the current base shader plugin set. */
    buildAllVariants(
        basePlugins: Plugin[],
        buildForPlugins: (plugins: Plugin[]) => CompiledPipeline,
        filterShaderParticipant?: (p: Plugin) => boolean, // optional capability filter
    ): void {
        for (const [name, v] of this.variants.entries()) {
            const resolved = this.resolveVariantPlugins(v, basePlugins);
            const filtered = filterShaderParticipant ? resolved.filter(filterShaderParticipant) : resolved;
            v.compiled = buildForPlugins(filtered);

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
        const v = this.variants.get(name);
        if (!v) {
            console.warn(`[VariantManager] Variant "${name}" is not defined.`);
            return;
        }
        if (!v.compiled) {
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

    /** For UI or debugging. */
    listVariantNames(): string[] {
        return Array.from(this.variants.keys());
    }

    /** Helper: merge base with overrides (role-based, for shader participants). */
    private resolveVariantPlugins(v: VariantRecord, basePlugins: Plugin[]): Plugin[] {
        const byRole = new Map<Role, Plugin>();
        for (const p of basePlugins) byRole.set(p.role, p);
        for (const [role, plugin] of v.overrides) byRole.set(role as Role, plugin);
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
