import type { Plugin, Role } from "./types";

export default class Engine {
    private active = new Map<Role, Plugin>();

    use(plugin: Plugin): this {
        this.active.set(plugin.role, plugin);
        return this;
    }
    clear(role: Role): void {
        this.active.delete(role);
    }
    get<T extends Plugin = Plugin>(role: Role): T | undefined {
        return this.active.get(role) as T | undefined;
    }
    list(): Plugin[] {
        return Array.from(this.active.values());
    }

    // Optional helpers you had:
    collectChunks() { return this.list().flatMap(p => p.chunks()); }
    collectUniforms() { return this.list().flatMap(p => p.uniforms()); }
}
