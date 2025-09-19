// tests/unit/engine/execution/render-engine.test.ts
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
    // No GL calls required for these tests
}

class MockProgram implements ProgramLike {
    use(): void {}
    getUniformLocation(_name: string): WebGLUniformLocation | null {
        return {} as any;
    }
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
    public swaps = 0;
    ensureSize(w: number, h: number): void {
        this.ensured.push([w, h]);
    }
    pair() {
        return { readTex: ({} as any), writeFbo: ({} as any) };
    }
    swap(): void {
        this.swaps++;
    }
    clear(): void {
        this.clears++;
    }
}

class MockPipeline implements RenderPipelineLike {
    public renders: Array<[number, number]> = [];
    public setFrames: number[] = [];
    public setSamples: number[] = [];
    constructor(_gl: any, _prog: ProgramLike, _pool: FramebufferPoolLike, _manifest: any) {}
    setFrameIndex(i: number): void {
        this.setFrames.push(i);
    }
    setSampleCount(n: number): void {
        this.setSamples.push(n);
    }
    render(w: number, h: number): void {
        this.renders.push([w, h]);
    }
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

describe("RenderEngine", () => {
    let gl: WebGL2RenderingContext;
    let cache: MockCache;
    let pool: MockPool;

    beforeEach(() => {
        gl = new MockGL() as any;
        cache = new MockCache();
        pool = new MockPool();
    });

    it("compiles program on first render, creates pipeline, renders, and increments counters", () => {
        const tracer = mod("Tracer", "Flat", {
            provides: ["integrateSample"],
            functions: `vec3 integrateSample(vec2 frag){ return vec3(1.0); }`,
        });
        const film = mod("Film", "RA", {
            provides: ["shadePixel"],
            requires: ["integrateSample"],
            entrypoints: { fragmentMain: "shadePixel" },
            functions: `vec3 shadePixel(vec2 frag){ return integrateSample(frag); }`,
        });
        const rec = recipe([film, tracer], "shadePixel");

        const { factory, created } = makeFactory();
        const engine = new RenderEngine(gl, cache, pool, factory);

        const r1 = engine.render(640, 360, rec);
        expect(r1.recompiled).toBe(true);
        expect(created.length).toBe(1);
        expect(created[0].renders).toEqual([[640, 360]]);
        // counters applied to this draw (0,0) then incremented to (1,1)
        expect(created[0].setFrames[0]).toBe(0);
        expect(created[0].setSamples[0]).toBe(0);
        expect(r1.frameIndex).toBe(1);
        expect(r1.sampleCount).toBe(1);

        const r2 = engine.render(640, 360, rec);
        expect(r2.recompiled).toBe(false);
        expect(created[0].renders.length).toBe(2);
        // next frame saw counters 1 and 1
        expect(created[0].setFrames[1]).toBe(1);
        expect(created[0].setSamples[1]).toBe(1);
    });

    it("hot-swaps pipeline and resets accumulation when ProgramKey changes", () => {
        const tracerV1 = mod("Tracer", "Flat", {
            provides: ["integrateSample"],
            functions: `vec3 integrateSample(vec2 frag){ return vec3(1.0); }`,
        });
        const film = mod("Film", "RA", {
            provides: ["shadePixel"],
            requires: ["integrateSample"],
            entrypoints: { fragmentMain: "shadePixel" },
            functions: `vec3 shadePixel(vec2 frag){ return integrateSample(frag); }`,
        });

        const { factory, created } = makeFactory();
        const engine = new RenderEngine(gl, cache, pool, factory);

        const rec1 = recipe([film, tracerV1], "shadePixel");
        engine.render(320, 200, rec1);
        expect(created.length).toBe(1);
        expect(pool.clears).toBe(1); // reset due to first compile

        // Change tracer version → new ProgramKey expected
        const tracerV2: ShaderModuleDescriptor = { ...tracerV1, id: { ...tracerV1.id, version: "1.0.1" } };
        const rec2 = recipe([film, tracerV2], "shadePixel");

        const r2 = engine.render(320, 200, rec2);
        expect(r2.recompiled).toBe(true);
        expect(created.length).toBe(2);
        // accumulation was reset before the draw: first setSampleCount of new pipe is 0
        expect(created[1].setSamples[0]).toBe(0);
        expect(pool.clears).toBe(2);
    });

    it("manual resetAccumulation clears film and zeros counters for next frame", () => {
        const tracer = mod("Tracer", "Flat", {
            provides: ["integrateSample"],
            functions: `vec3 integrateSample(vec2 frag){ return vec3(1.0); }`,
        });
        const film = mod("Film", "RA", {
            provides: ["shadePixel"],
            requires: ["integrateSample"],
            entrypoints: { fragmentMain: "shadePixel" },
            functions: `vec3 shadePixel(vec2 frag){ return integrateSample(frag); }`,
        });
        const rec = recipe([film, tracer], "shadePixel");

        const { factory, created } = makeFactory();
        const engine = new RenderEngine(gl, cache, pool, factory);

        engine.render(100, 100, rec); // increments to (1,1)
        engine.resetAccumulation();
        const r2 = engine.render(100, 100, rec);
        // after reset, the next draw sees counters 0,0 again
        expect(created[0].setFrames[1]).toBe(0);
        expect(created[0].setSamples[1]).toBe(0);
        expect(pool.clears).toBe(2); // first compile + manual reset
        expect(r2.frameIndex).toBe(1);
        expect(r2.sampleCount).toBe(1);
    });

    it("auto-registers module parameter schemas on first compile", () => {
        const tracer = mod("Tracer", "Flat", {
            provides: ["integrateSample"],
            functions: `vec3 integrateSample(vec2 frag){ return vec3(1.0); }`,
        });

        // Film module with parameter schema
        const film = {
            ...mod("Film", "RA", {
                provides: ["shadePixel"],
                requires: ["integrateSample"],
                entrypoints: { fragmentMain: "shadePixel" },
                functions: `vec3 shadePixel(vec2 frag){ return integrateSample(frag); }`,
            }),
            parameters: [
                { name: "exposure", kind: "float",   default: 1.25 },           // store default resetPolicy = accumulation
                { name: "enabled",  kind: "boolean", default: true, resetPolicy: "none" },
            ],
        } as ShaderModuleDescriptor;

        const rec = recipe([film, tracer], "shadePixel");

        const { factory } = makeFactory();
        const engine = new RenderEngine(gl, cache, pool, factory);

        // First render triggers compile + auto-registration
        engine.render(320, 200, rec);

        const store = engine.getParameterStore();
        const scope = formatComponentScope(film.id);

        // Descriptors registered with defaults
        const descs = store.list(scope);
        const names = descs.map((d) => d.logical).sort();
        expect(names).toEqual(["enabled", "exposure"].sort());

        const exposure = descs.find((d) => d.logical === "exposure")!;
        expect(exposure.kind).toBe("float");
        expect(exposure.resetPolicy).toBe("accumulation"); // store default applied
        expect(store.get(scope, "exposure")).toBe(1.25);

        const enabled = descs.find((d) => d.logical === "enabled")!;
        expect(enabled.kind).toBe("boolean");
        expect(enabled.resetPolicy).toBe("none");
        expect(store.get(scope, "enabled")).toBe(true);

        // Nothing is dirty right after registration
        expect(store.collectDirty().length).toBe(0);
    });
});
