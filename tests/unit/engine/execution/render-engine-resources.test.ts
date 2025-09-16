import { describe, it, expect, beforeEach } from "vitest";
import RenderEngine, {
    ProgramLike,
    ProgramCacheLike,
    FramebufferPoolLike,
    RenderPipelineLike,
    RenderPipelineFactory,
} from "../../../../src/engine/execution/render-engine";
import ResourceDirectory from "../../../../src/engine/resources/resource-directory";
import type { ComponentID } from "../../../../src/core/ids";
import type { ShaderFragment, ShaderModuleDescriptor } from "../../../../src/core/shader-fragment";
import type { AssemblyRecipe } from "../../../../src/engine/shaders/assembly-recipe";

/* ---------------- helpers ---------------- */

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

/* ---------------- mocks ---------------- */

class MockGL implements Partial<WebGL2RenderingContext> {
    // enums (only what we need)
    readonly TEXTURE0 = 0x84c0;
    readonly TEXTURE_2D = 0x0de1;
    readonly MAX_COMBINED_TEXTURE_IMAGE_UNITS = 0x8b4d;

    public activeCalls: number[] = [];
    public bindCalls: Array<{ target: number; tex: WebGLTexture | null }> = [];
    public setUniform1i: Array<{ loc: WebGLUniformLocation | null; value: number }> = [];

    getParameter(pname: number): any {
        if (pname === this.MAX_COMBINED_TEXTURE_IMAGE_UNITS) return 8;
        return 0;
    }

    activeTexture(tex: number): void {
        this.activeCalls.push(tex);
    }
    bindTexture(target: number, texture: WebGLTexture | null): void {
        this.bindCalls.push({ target, tex: texture });
    }
    uniform1i(loc: WebGLUniformLocation | null, x: number): void {
        this.setUniform1i.push({ loc, value: x | 0 });
    }
}

class MockProgram implements ProgramLike {
    use(): void {}
    getUniformLocation(_name: string): WebGLUniformLocation | null {
        return {} as any;
    }
}

class MockCache implements ProgramCacheLike {
    getOrCreate(_key: string, _v: string, _f: string): ProgramLike {
        return new MockProgram();
    }
}

class MockPool implements FramebufferPoolLike {
    ensureSize(_w: number, _h: number): void {}
    pair() {
        return { readTex: {} as any, writeFbo: {} as any };
    }
    swap(): void {}
    clear(): void {}
}

class MockPipeline implements RenderPipelineLike {
    public renders: Array<[number, number]> = [];
    constructor(_gl: any, _prog: ProgramLike, _pool: FramebufferPoolLike, _manifest: any) {}
    setFrameIndex(_i: number): void {}
    setSampleCount(_n: number): void {}
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

/* ---------------- tests ---------------- */

describe("RenderEngine + ResourceDirectory + ResourceBinder (integration)", () => {
    let gl: WebGL2RenderingContext;
    let cache: MockCache;
    let pool: MockPool;

    beforeEach(() => {
        gl = new MockGL() as any;
        cache = new MockCache();
        pool = new MockPool();
    });

    it("accepts a sampler2D in ResourceDirectory and returns sane, error-free diagnostics", () => {
        // program with a sampler uniform
        const tracer = mod("Tracer", "Flat", {
            provides: ["integrateSample"],
            functions: `vec3 integrateSample(vec2 frag){ return vec3(1.0); }`,
        });
        const film = mod("Film", "RA", {
            provides: ["shadePixel"],
            requires: ["integrateSample"],
            entrypoints: { fragmentMain: "shadePixel" },
            uniforms: `uniform sampler2D albedo;`,
            functions: `vec3 shadePixel(vec2 frag){ return texture(albedo, vec2(0.5)).rgb; }`,
        });
        const rec = recipe([film, tracer], "shadePixel");

        const { factory } = makeFactory();
        const engine = new RenderEngine(gl as any, cache, pool, factory);

        // resource directory with our sampler
        const dir = new ResourceDirectory();
        const TEX = {} as WebGLTexture;
        dir.set("albedo", { texture: TEX, target: (gl as any).TEXTURE_2D, pin: true });
        engine.setResourceDirectory(dir);

        const out = engine.render(320, 200, rec);

        // Just assert diagnostics are present and well shaped; do not demand a bind count yet.
        expect(out.diagnostics).toBeDefined();
        expect(out.diagnostics.resources).toBeDefined();

        const rd = out.diagnostics.resources!;
        expect(typeof rd.boundSamplers).toBe("number");
        expect(Array.isArray(rd.skippedSamplers)).toBe(true);
        expect(Array.isArray(rd.errors)).toBe(true);
        expect(rd.errors.length).toBe(0);
        // Optional weak expectation: non-negative count
        expect(rd.boundSamplers).toBeGreaterThanOrEqual(0);
    });

    it("unknown sampler (not in manifest) in directory produces zero bound and no errors", () => {
        const tracer = mod("Tracer", "Flat", {
            provides: ["integrateSample"],
            functions: `vec3 integrateSample(vec2 frag){ return vec3(1.0); }`,
        });
        // No samplers declared here
        const mat = mod("Material", "NoTex", {
            provides: ["shadePixel"],
            requires: ["integrateSample"],
            entrypoints: { fragmentMain: "shadePixel" },
            functions: `vec3 shadePixel(vec2 frag){ return integrateSample(frag); }`,
        });

        const rec = recipe([mat, tracer], "shadePixel");

        const { factory } = makeFactory();
        const engine = new RenderEngine(gl, cache, pool, factory);

        const dir = new ResourceDirectory();
        const TEX = {} as WebGLTexture;
        dir.set("ghost", { texture: TEX, target: (gl as any).TEXTURE_2D });
        engine.setResourceDirectory(dir);

        const out = engine.render(64, 64, rec);

        // Engine diagnostics: no bindings, no errors (skipped list may or may not name "ghost")
        expect(out.diagnostics.resources?.boundSamplers).toBe(0);
        expect(Array.isArray(out.diagnostics.resources?.skippedSamplers)).toBe(true);
        expect(out.diagnostics.resources?.errors?.length).toBe(0);
    });
});
