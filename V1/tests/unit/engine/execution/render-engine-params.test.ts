// tests/unit/engine/execution/render-engine-params.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import RenderEngine, {
    ProgramLike,
    ProgramCacheLike,
    FramebufferPoolLike,
    RenderPipelineLike,
    RenderPipelineFactory,
} from "../../../../src/engine/execution/render-engine";

import type { ComponentID } from "../../../../src/core/ids";
import type { ShaderFragment, ShaderModuleDescriptor } from "../../../../src/core/shader-fragment";
import type { AssemblyRecipe } from "../../../../src/engine/shaders/assembly-recipe";
import { formatComponentScope } from "../../../../src/engine/parameters/register-module-params";

function id(kind: ComponentID["kind"], name: string, version = "1.0.0"): ComponentID {
    return { kind, name, version };
}
function mod(
    kind: ComponentID["kind"],
    name: string,
    f: Partial<ShaderFragment> & { functions?: string }
): ShaderModuleDescriptor {
    return {
        id: id(kind, name),
        fragment: {
            uniforms: f.uniforms ?? "",
            functions: f.functions ?? "",
            mainCode: f.mainCode ?? "",
            provides: f.provides ?? [],
            requires: f.requires ?? [],
            entrypoints: f.entrypoints,
        },
    };
}
function recipe(mods: ShaderModuleDescriptor[], entry: string, constants = {}): AssemblyRecipe {
    return { modules: mods, entry: { name: entry }, constants };
}

// ---- Mocks ----

class MockGL implements Partial<WebGL2RenderingContext> {
    public calls: Record<string, number> = {};
    private bump(name: string) { this.calls[name] = (this.calls[name] ?? 0) + 1; }

    uniform1f(): void { this.bump("uniform1f"); }
    uniform1i(): void { this.bump("uniform1i"); }
    uniform2f(): void { this.bump("uniform2f"); }
    uniform3f(): void { this.bump("uniform3f"); }
    uniform4f(): void { this.bump("uniform4f"); }
    uniformMatrix3fv(): void { this.bump("uniformMatrix3fv"); }
    uniformMatrix4fv(): void { this.bump("uniformMatrix4fv"); }
}

class MockProgram implements ProgramLike {
    getUniformLocation(_name: string): WebGLUniformLocation | null { return {} as any; }
}

class MockCache implements ProgramCacheLike {
    public keys: string[] = [];
    getOrCreate(key: string, _v: string, _f: string): ProgramLike {
        this.keys.push(key);
        return new MockProgram();
    }
}

class MockPool implements FramebufferPoolLike {
    public ensured: Array<[number, number]> = [];
    public clears = 0;
    ensureSize(w: number, h: number): void { this.ensured.push([w, h]); }
    pair() { return { readTex: ({} as any), writeFbo: ({} as any) }; }
    swap(): void {}
    clear(): void { this.clears++; }
}

class MockPipeline implements RenderPipelineLike {
    public renders: Array<[number, number]> = [];
    public setFrames: number[] = [];
    public setSamples: number[] = [];
    constructor(_gl: any, _prog: ProgramLike, _pool: FramebufferPoolLike, _manifest: any) {}
    setFrameIndex(i: number): void { this.setFrames.push(i); }
    setSampleCount(n: number): void { this.setSamples.push(n); }
    render(w: number, h: number): void { this.renders.push([w, h]); }
    dispose(): void {}
}

function makeFactory(): { factory: RenderPipelineFactory; created: MockPipeline[] } {
    const created: MockPipeline[] = [];
    const factory: RenderPipelineFactory = (gl, prog, pool, manifest) => {
        const p = new MockPipeline(gl, prog, pool, manifest);
        created.push(p);
        return p;
    };
    return { factory, created };
}

describe("RenderEngine params integration", () => {
    let gl: WebGL2RenderingContext & MockGL;
    let cache: MockCache;
    let pool: MockPool;

    beforeEach(() => {
        gl = new MockGL() as any;
        cache = new MockCache();
        pool = new MockPool();
    });

    it("accumulation param change: no recompile, film cleared, uniform bound", () => {
        const tracer = mod("Tracer", "Flat", {
            provides: ["integrateSample"],
            functions: `vec3 integrateSample(vec2 frag){ return vec3(1.0); }`,
        });

        const film = {
            ...mod("Film", "RA", {
                uniforms: `uniform float exposure;`,
                provides: ["shadePixel"],
                requires: ["integrateSample"],
                entrypoints: { fragmentMain: "shadePixel" },
                functions: `
          vec3 shadePixel(vec2 frag){
            return integrateSample(frag) * exposure;
          }
        `,
            }),
            parameters: [
                { name: "exposure", kind: "float", default: 1.0, resetPolicy: "accumulation" },
            ],
        } as ShaderModuleDescriptor;

        const rec = recipe([film, tracer], "shadePixel");

        const { factory, created } = makeFactory();
        const engine = new RenderEngine(gl, cache, pool, factory);

        let lastStats: any = null;
        engine.onRenderStats = (s) => (lastStats = s);

        engine.render(320, 200, rec);
        expect(created.length).toBe(1);
        expect(pool.clears).toBe(1);

        const scope = formatComponentScope(film.id);
        const store = engine.getParameterStore();
        store.set(scope, "exposure", 1.5);

        const r2 = engine.render(320, 200, rec);
        expect(r2.recompiled).toBe(false);
        expect(pool.clears).toBe(2); // accumulation reset
        expect(lastStats.boundUniforms).toBe(1);
        // changed: engine reports `skippedUniforms`
        expect(Array.isArray(lastStats.skippedUniforms)).toBe(true); // <-- changed
    });

    it("program param change: recompile, film cleared, uniform bound", () => {
        const tracer = mod("Tracer", "Flat", {
            provides: ["integrateSample"],
            functions: `vec3 integrateSample(vec2 frag){ return vec3(1.0); }`,
        });

        const film = {
            ...mod("Film", "RA", {
                uniforms: `uniform bool useTonemap;`,
                provides: ["shadePixel"],
                requires: ["integrateSample"],
                entrypoints: { fragmentMain: "shadePixel" },
                functions: `
          vec3 shadePixel(vec2 frag){
            vec3 c = integrateSample(frag);
            return useTonemap ? c / (1.0 + c) : c;
          }
        `,
            }),
            parameters: [
                { name: "useTonemap", kind: "boolean", default: true, resetPolicy: "program" },
            ],
        } as ShaderModuleDescriptor;

        const rec = recipe([film, tracer], "shadePixel");

        const { factory, created } = makeFactory();
        const engine = new RenderEngine(gl, cache, pool, factory);

        let lastStats: any = null;
        engine.onRenderStats = (s) => (lastStats = s);

        engine.render(128, 128, rec);
        expect(created.length).toBe(1);
        expect(pool.clears).toBe(1);

        const scope = formatComponentScope(film.id);
        engine.getParameterStore().set(scope, "useTonemap", false);

        const r2 = engine.render(128, 128, rec);
        expect(r2.recompiled).toBe(true);
        expect(created.length).toBe(2);
        expect(pool.clears).toBe(2);
        expect(lastStats.boundUniforms).toBe(1);
    });

    it("missing uniform is skipped and parameter marked clean", () => {
        const tracer = mod("Tracer", "Flat", {
            provides: ["integrateSample"],
            functions: `vec3 integrateSample(vec2 frag){ return vec3(1.0); }`,
        });

        const film = {
            ...mod("Film", "RA", {
                uniforms: `uniform float exposure;`,
                provides: ["shadePixel"],
                requires: ["integrateSample"],
                entrypoints: { fragmentMain: "shadePixel" },
                functions: `vec3 shadePixel(vec2 frag){ return integrateSample(frag) * exposure; }`,
            }),
            parameters: [
                { name: "exposure", kind: "float", default: 1.0, resetPolicy: "none" },
                { name: "ghost",    kind: "int",   default: 7,   resetPolicy: "accumulation" }, // not in shader
            ],
        } as ShaderModuleDescriptor;

        const rec = recipe([film, tracer], "shadePixel");

        const { factory } = makeFactory();
        const engine = new RenderEngine(gl, cache, pool, factory);

        let lastStats: any = null;
        engine.onRenderStats = (s) => (lastStats = s);

        engine.render(64, 64, rec);

        const scope = formatComponentScope(film.id);
        const store = engine.getParameterStore();

        store.set(scope, "ghost", 11);

        engine.render(64, 64, rec);

        expect(lastStats.boundUniforms).toBe(0);
        // changed: engine reports `skippedUniforms`
        expect(lastStats.skippedUniforms).toContain("ghost"); // <-- changed

        expect(store.collectDirty().length).toBe(0);
    });
});
