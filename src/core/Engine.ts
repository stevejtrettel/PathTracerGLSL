/**
 * Minimal engine skeleton: holds the active plugin for each role.
 * No rendering/assembly yet — this is the registry we’ll grow.
 */

import type { Plugin, Role } from "./types";

export default class Engine {
    /** Active plugin per role (exactly one provider for each role). */
    private active = new Map<Role, Plugin>();

    /** Register/replace the plugin for its role. Returns `this` for chaining. */
    use(plugin: Plugin): this {
        this.active.set(plugin.role, plugin);
        return this;
    }

    /** Remove the plugin for a given role (if any). */
    clear(role: Role): void {
        this.active.delete(role);
    }

    /** Get the plugin for a role, if present. */
    get<T extends Plugin = Plugin>(role: Role): T | undefined {
        return this.active.get(role) as T | undefined;
    }

    /** Snapshot of all active plugins (helpful for assembly & debugging). */
    list(): Plugin[] {
        return Array.from(this.active.values());
    }

    // ---- assembly hooks to be implemented next ----

    /**
     * Placeholder: return ordered GLSL chunks from active plugins.
     * Next step: collect chunks(), topo-sort by deps, and hand off to a builder.
     */
    collectChunks() {
        return this.list().flatMap(p => p.chunks());
    }

    /**
     * Placeholder: return uniform declarations from active plugins.
     * Next step: engine will prefix by namespace/role and bind locations.
     */
    collectUniforms() {
        return this.list().flatMap(p => p.uniforms());
    }
}
