// Plain-object fakes for app-manager tests — no DOM, no WebGL.
import { vi } from 'vitest';
import type { CompiledRenderer, ShaderProgram, SceneDescription, RenderStrategy } from '../../src/compiler/types.js';
import type { Engine } from '../../src/engine/Engine.js';

export function makeRenderer(id: string): CompiledRenderer {
    const shaders = new Map<string, ShaderProgram>([[`${id}-main`, { vertex: 'v', fragment: 'f' }]]);
    return {
        id,
        shaders,
        uniforms: [],
        parameters: {},
        pipeline: { framebuffers: [], passes: [{ id: 'p', shader: `${id}-main`, output: 'screen', execution: { type: 'once' } }] },
    };
}

/** A fake Engine exposing exactly the methods the managers call, as spies. */
export function fakeEngine(sampleCount = 1) {
    let samples = sampleCount;
    return {
        loadRenderers: vi.fn(),
        validateRenderers: vi.fn(),
        loadRenderer: vi.fn(),
        selectRenderer: vi.fn(),
        clearAccumulation: vi.fn(() => { samples = 0; }),
        getAvailableRendererIds: vi.fn(() => [] as string[]),
        renderFrame: vi.fn(() => { samples += 1; }),
        getSampleCount: vi.fn(() => samples),
        setSampleCount: (n: number) => { samples = n; },
    };
}

/** A fake compiler that mints a renderer per (scene, strategy) with the pinned id. */
export function fakeCompiler() {
    const compile = vi.fn((scene: SceneDescription, strategy: RenderStrategy) =>
        makeRenderer(`${strategy.id}-${scene.id}`));
    return {
        compile,
        compileScene: vi.fn((scene: SceneDescription, strategies: RenderStrategy[]) => ({
            renderers: strategies.map((s) => compile(scene, s)),
            dataReads: { cwbvh: false, lightTree: false, sceneTable: false },
            sceneData: {
                layout: { totals: { vertices: 0, normals: 0, uvs: 0, indices: 0, nodes: 0, records: 0, nodesq: 0 }, meshes: [], batches: [], meshLights: new Map() },
                geometry: [], meshLights: [], batches: [],
            },
            warnings: [],
        })),
    };
}

export type FakeEngine = ReturnType<typeof fakeEngine>;
export const asEngine = (e: FakeEngine): Engine => e as unknown as Engine;
