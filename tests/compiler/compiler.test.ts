import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { SceneDescription } from '../../src/compiler/types.js';
import { minimalScene, minimalStrategy, directOnlyStrategy } from '../witnesses/scenes/minimalScene.js';
import { analyticMinimal, analyticStrategy } from '../witnesses/scenes/analyticMinimal.js';
import { cornellBox, cornellStrategy } from '../witnesses/scenes/cornellBox.js';

const compiler = new Compiler();

describe('Compiler', () => {
    describe('minimalScene + minimalStrategy', () => {
        const result = compiler.compile(minimalScene, minimalStrategy);

        it('produces correct renderer ID', () => {
            expect(result.id).toBe('pathtracer-minimal');
        });

        it('generates 2 shaders (main, display)', () => {
            expect(result.shaders.size).toBe(2);
            expect(result.shaders.has('pathtracer-minimal-main')).toBe(true);
            expect(result.shaders.has('pathtracer-minimal-display')).toBe(true);
        });

        it('generates non-empty GLSL with version directive', () => {
            for (const [id, shader] of result.shaders) {
                expect(shader.vertex, `${id} vertex`).toContain('#version 300 es');
                expect(shader.fragment, `${id} fragment`).toContain('#version 300 es');
                expect(shader.vertex.length, `${id} vertex length`).toBeGreaterThan(50);
                expect(shader.fragment.length, `${id} fragment length`).toBeGreaterThan(50);
            }
        });

        it('pipeline passes reference existing shaders', () => {
            for (const pass of result.pipeline.passes) {
                expect(result.shaders.has(pass.shader), `shader '${pass.shader}' exists`).toBe(true);
            }
        });

        it('pipeline has correct framebuffers', () => {
            const fbIds = result.pipeline.framebuffers.map(fb => fb.id);
            expect(fbIds).toContain('accumulation');
            expect(fbIds).toContain('screen');

            const accum = result.pipeline.framebuffers.find(fb => fb.id === 'accumulation')!;
            expect(accum.type).toBe('double_buffer');
            expect(accum.format).toBe('rgba32f');
        });

        it('pipeline has postFrame swap for accumulation', () => {
            expect(result.pipeline.postFrame?.swaps).toEqual([
                { type: 'swap', buffers: ['accumulation'] },
            ]);
        });

        it('has uniform bindings including resolution and camera', () => {
            const uniformNames = result.uniforms.map(u => u.uniform);
            expect(uniformNames).toContain('u_resolution');
            expect(uniformNames).toContain('u_cameraPosition');
            // The look-at frame is CPU-computed and shipped as basis uniforms; u_cameraTarget
            // is no longer read by any shader (camera.target feeds the basis closures).
            expect(uniformNames).toContain('u_cameraForward');
            expect(uniformNames).toContain('u_cameraRight');
            expect(uniformNames).toContain('u_cameraUp');
        });

        it('has camera parameter metadata', () => {
            expect(result.parameters).toBeDefined();
            expect(result.parameters!['camera.position']).toBeDefined();
            expect(result.parameters!['camera.target']).toBeDefined();
        });

        it('has export targets', () => {
            expect(result.exportTargets).toBeDefined();
            expect(result.exportTargets!['hdr']).toBeDefined();
        });
    });

    describe('minimalScene + directOnlyStrategy', () => {
        const result = compiler.compile(minimalScene, directOnlyStrategy);

        it('produces correct renderer ID', () => {
            expect(result.id).toBe('direct-minimal');
        });

        it('generates 2 shaders with correct namespacing', () => {
            expect(result.shaders.size).toBe(2);
            expect(result.shaders.has('direct-minimal-main')).toBe(true);
            expect(result.shaders.has('direct-minimal-display')).toBe(true);
        });
    });

    it('broadcasts an achromatic spectrum parameter on default and live updates', () => {
        const scene: SceneDescription = {
            ...minimalScene,
            id: 'scalar-spectrum-param',
            materials: {
                ...minimalScene.materials,
                ground: { model: 'lambert', albedo: { param: 'ground.albedo', default: 0.5 } },
            },
        };
        const result = compiler.compile(scene, minimalStrategy);
        const binding = result.uniforms.find((u) => u.parameters.includes('ground.albedo'))!;
        expect(binding.compute({})).toEqual([0.5, 0.5, 0.5]);
        expect(binding.compute({ 'ground.albedo': 0.25 })).toEqual([0.25, 0.25, 0.25]);
    });

    describe('validation rejects unsupported features', () => {
        it('rejects non-euclidean ambient space', () => {
            const badScene: SceneDescription = {
                ...minimalScene,
                ambientSpace: { type: 'hyperbolic' },
            };
            expect(() => compiler.compile(badScene, minimalStrategy)).toThrow('not yet supported');
        });

        it('compiles a mesh object (impl-plan-meshes)', () => {
            const meshScene: SceneDescription = {
                ...minimalScene,
                objects: [{ kind: 'mesh', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), material: 'ground' }],
            };
            const result = compiler.compile(meshScene, minimalStrategy);
            const frag = result.shaders.get('pathtracer-minimal-main')!.fragment;
            expect(frag).toContain('mesh_intersect');
            expect(frag).toContain('u_mesh_0_position');
        });

        it('rejects directional lights', () => {
            const badScene: SceneDescription = {
                ...minimalScene,
                lights: [{ kind: 'directional', direction: [0, -1, 0], emission: 1.0 }],
            };
            expect(() => compiler.compile(badScene, minimalStrategy)).toThrow('directional lights not yet supported');
        });

        it('rejects unknown material references', () => {
            const badScene: SceneDescription = {
                ...minimalScene,
                objects: [
                    { type: 'sphere', parameters: { radius: 1.0 }, material: 'nonexistent' },
                ],
            };
            expect(() => compiler.compile(badScene, minimalStrategy)).toThrow("unknown material 'nonexistent'");
        });

        it('reports multiple errors at once', () => {
            const badScene: SceneDescription = {
                ...minimalScene,
                ambientSpace: { type: 'spherical' },
                objects: [{ kind: 'mesh', positions: new Float32Array(0), indices: new Uint32Array(0), material: 'ground' }],
            };
            try {
                compiler.compile(badScene, minimalStrategy);
                expect.fail('should have thrown');
            } catch (e: any) {
                expect(e.message).toContain('Ambient space');
                expect(e.message).toMatch(/mesh/i);
            }
        });
    });

    describe('cornellBox scene', () => {
        const result = compiler.compile(cornellBox, cornellStrategy);

        it('produces correct renderer ID', () => {
            expect(result.id).toBe('pathtracer-cornell');
        });

        it('generates 2 shaders with correct namespacing', () => {
            expect(result.shaders.size).toBe(2);
            expect(result.shaders.has('pathtracer-cornell-main')).toBe(true);
            expect(result.shaders.has('pathtracer-cornell-display')).toBe(true);
        });

        it('main shader contains all 8 objects across the RESOLVED backends (B1 auto)', () => {
            const frag = result.shaders.get('pathtracer-cornell-main')!.fragment;
            // Auto: 6 planes + sphere → analytic; box (sdf-only) → the marcher.
            expect(frag).toContain('analytic_intersect');
            expect(frag).toContain('plane_intersect');
            expect(frag).toContain('sphere_intersect');
            expect(frag).toContain('box_sdf');
            for (let i = 0; i < 8; i++) {
                expect(frag, `region ${i}`).toContain(`region == ${i}`);
            }
        });

        it('main shader contains all 3 materials', () => {
            const frag = result.shaders.get('pathtracer-cornell-main')!.fragment;
            expect(frag).toContain('id == 0');
            expect(frag).toContain('id == 1');
            expect(frag).toContain('id == 2');
        });
    });

    describe('source maps', () => {
        const result = compiler.compile(minimalScene, minimalStrategy);

        it('produces source maps for all shaders', () => {
            expect(result.sourceMaps).toBeDefined();
            expect(result.sourceMaps!.size).toBe(2);
            expect(result.sourceMaps!.has('pathtracer-minimal-main')).toBe(true);
            expect(result.sourceMaps!.has('pathtracer-minimal-display')).toBe(true);
        });

        it('source map blocks have no gaps', () => {
            const sm = result.sourceMaps!.get('pathtracer-minimal-main')!;
            expect(sm.blocks.length).toBeGreaterThan(0);
            expect(sm.blocks[0].startLine).toBe(1);

            for (let i = 1; i < sm.blocks.length; i++) {
                expect(sm.blocks[i].startLine).toBe(sm.blocks[i - 1].endLine + 1);
            }
        });

        it('last block endLine matches fragment line count', () => {
            const sm = result.sourceMaps!.get('pathtracer-minimal-main')!;
            const fragment = result.shaders.get('pathtracer-minimal-main')!.fragment;
            const lineCount = fragment.split('\n').length;
            const lastBlock = sm.blocks[sm.blocks.length - 1];
            expect(lastBlock.endLine).toBe(lineCount);
        });

        it('includes expected origin blocks (minimal PINS the marcher — the sdf twin)', () => {
            const sm = result.sourceMaps!.get('pathtracer-minimal-main')!;
            const origins = sm.blocks.map(b => b.origin);
            expect(origins).toContain('glsl/core/structs.glsl');
            expect(origins).toContain('generated:sdf-dispatch');
            expect(origins).toContain('generated:material-lookup');
            expect(origins).toContain('components/intersection/raymarch/raymarch.glsl');
        });

        it('an ALL-analytic scene carries NO marcher at all (B1 auto — backend-level exact linkage)', () => {
            const r = compiler.compile(analyticMinimal, analyticStrategy);
            const sm = r.sourceMaps!.get(`${analyticStrategy.id}-${analyticMinimal.id}-main`)!;
            const origins = sm.blocks.map(b => b.origin);
            expect(origins).toContain('generated:analytic-dispatch');
            expect(origins).not.toContain('generated:sdf-dispatch');
            expect(origins).not.toContain('components/intersection/raymarch/raymarch.glsl');
        });
    });

    describe('two strategies produce independent renderers', () => {
        const pt = compiler.compile(minimalScene, minimalStrategy);
        const direct = compiler.compile(minimalScene, directOnlyStrategy);

        it('different renderer IDs', () => {
            expect(pt.id).not.toBe(direct.id);
        });

        it('no shared shader keys', () => {
            for (const key of pt.shaders.keys()) {
                expect(direct.shaders.has(key)).toBe(false);
            }
        });
    });
});
