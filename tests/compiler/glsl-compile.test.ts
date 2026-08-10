import { describe, it } from 'vitest';
import { glslangCheck as check } from '../helpers/glslangCheck.js';
import { Compiler } from '../../src/compiler/Compiler.js';
import { TONEMAP_MODELS } from '../../src/components/tonemap/index.js';
import { witnessSuite } from '../witnesses/index.js';
import { demoSuite } from '../../demos/index.js';
import { isAsyncSceneEntry, type SceneSuiteEntry } from '../witnesses/types.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';
import type { MeshObject } from '../../src/compiler/types.js';

// Codegen coverage spans BOTH registries: the durable witnesses and the demo layer.
// Data-scene thunk entries fetch untracked .inst files — skipped here; their codegen
// coverage is the committed fixture (tests/authoring/instanceCloud.test.ts).
const sceneSuite = Object.fromEntries(
    Object.entries({ ...witnessSuite, ...demoSuite }).filter(([, e]) => !isAsyncSceneEntry(e)),
) as Record<string, SceneSuiteEntry>;

/**
 * Static compile check for every generated shader (impl-plan-decision-hoist T3).
 *
 * The generated GLSL is otherwise never PARSED by anything in CI — vitest checks
 * structure and snapshots check text, but a missing brace or a mis-declared symbol in a
 * rarely-exercised (scene, strategy) combination only surfaced in a browser (review: the
 * C4 bug class, "the biggest untested surface"). This suite runs every registry pair's
 * assembled vertex + fragment shaders through glslangValidator (ES profile) — no GPU.
 *
 * KNOWN LIMIT — glslang is NOT ANGLE: it accepts constructs ANGLE rejects (notably `?:`
 * on struct operands, the media-build trap). Green here proves parse/type validity, not
 * "compiles in the browser" — ANGLE dialect quirks remain the GPU witnesses' job.
 *
 * §11.5 SLOT: when spectral lands (contracts §8), this harness compiles every pair under
 * BOTH color modes — the enforcement mechanism for the §2.5 spectral discipline.
 */

const compiler = new Compiler();

describe('generated GLSL compiles (glslang static check)', () => {
    for (const [key, entry] of Object.entries(sceneSuite)) {
        for (const strategy of entry.strategies) {
            it(`${key} + ${strategy.id}`, () => {
                const renderer = compiler.compile(entry.scene, strategy);
                for (const [shaderId, prog] of renderer.shaders) {
                    check(prog.vertex, 'vert', `${shaderId} [vertex]`);
                    check(prog.fragment, 'frag', `${shaderId} [fragment]`);
                }
            });
        }
    }
});

// Mesh backend (impl-plan-meshes): meshes are not in a registry, so the kitchen-sink pairs
// above never exercise the triangle engine. Compile a mesh scene through glslang directly —
// flat (geometric normals), smooth+uv (barycentric interpolation), and driven placement
// (ray-into-local via the §6.1 placement helpers). minimalStrategy uses nee → anyQuery, so
// mesh_intersect AND mesh_intersect_any are both emitted and checked.
describe('mesh backend compiles (glslang static check)', () => {
    const quad: MeshObject = {
        kind: 'mesh',
        positions: new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        material: 'ground',
    };
    const smooth: MeshObject = {
        ...quad,
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    };
    const driven: MeshObject = { ...quad, transform: { position: { param: 'mesh.pos', default: [0, 0, 0] } } };
    const cases: Array<[string, MeshObject]> = [['flat', quad], ['smooth+uv', smooth], ['driven', driven]];
    // Both traversal engines (impl-plan-mesh-bvh): brute-force scan AND the BVH walk must compile.
    const engines: Array<'brute' | 'bvh'> = ['brute', 'bvh'];
    for (const [label, mesh] of cases) {
        for (const engine of engines) {
            it(`mesh ${label} (${engine})`, () => {
                const scene: SceneDescription = { ...minimalScene, objects: [mesh] };
                const strategy = { ...minimalStrategy, estimator: { ...minimalStrategy.estimator, meshTraversal: engine } };
                const renderer = compiler.compile(scene, strategy);
                for (const [shaderId, prog] of renderer.shaders) {
                    check(prog.fragment, 'frag', `${shaderId} [mesh ${label} ${engine}]`);
                }
            });
        }
    }
});

// Every tonemap occupant's display shader compiles — the (scene, strategy) pairs above
// only exercise reinhard/none, so the production roster (aces/agx/khronos/hable/gt) is
// otherwise never parsed. One base scene, swap the tonemap type, check the display frag.
describe('every tonemap occupant compiles (glslang static check)', () => {
    const [base] = Object.values(sceneSuite);
    for (const type of Object.keys(TONEMAP_MODELS)) {
        it(`tonemap ${type}`, () => {
            const strategy = { ...base.strategies[0], id: `tonemap-${type}`, view: { tonemap: { type } } } as typeof base.strategies[0];
            const renderer = compiler.compile(base.scene, strategy);
            for (const [shaderId, prog] of renderer.shaders) {
                if (shaderId.endsWith('-display')) check(prog.fragment, 'frag', `${shaderId} [display ${type}]`);
            }
        });
    }
});

// ============================================================================
// Registry kitchen sink (A4): a scene SYNTHESIZED from the registries themselves —
// every primitive (constant AND driven placement), every material model, every
// phase model, every light kind — compiled under pt-mis. Presence-gated inclusion
// means a new occupant's GLSL is otherwise invisible to glslang until some suite
// scene uses it (the cylinder lesson); this test closes that gap the moment the
// registry line lands. Light kinds need a sample authored form (input language is
// per-kind); a registry kind missing one FAILS LOUDLY here instead of silently
// losing coverage.
// ============================================================================

import { PRIMITIVES } from '../../src/components/geometry/index.js';
import { MATERIAL_MODELS } from '../../src/components/materials/index.js';
import { VOLUME_SCATTERING_MODELS } from '../../src/components/volume_scattering/index.js';
import { LIGHT_KINDS } from '../../src/components/lights/index.js';
import type { SceneDescription, RenderStrategy, ObjectDescription, LightDescription, MaterialDescription, MaterialModel } from '../../src/compiler/types.js';

describe('registry kitchen sink compiles (every occupant, glslang static check)', () => {
    it('synthesized all-occupant scene + pt-mis', () => {
        const materials: Record<string, MaterialDescription> = {};
        const surfaceModels = Object.keys(MATERIAL_MODELS) as MaterialModel[];
        for (const id of surfaceModels) {
            materials[`mat_${id}`] = { model: id };
        }
        // Every phase model as an interior medium on a null-interface region.
        for (const id of Object.keys(VOLUME_SCATTERING_MODELS)) {
            materials[`medium_${id}`] = {
                model: 'none',
                medium: { sigma_a: [0.05, 0.05, 0.05], sigma_s: [0.4, 0.4, 0.4], model: id },
            };
        }

        // Every primitive, on every backend it provides, constant AND driven.
        const objects: ObjectDescription[] = [];
        let n = 0;
        // Index-varied dummies: required rows have NO defaults (required XOR default),
        // and identical vec3s would make a quad's edges parallel (Validator-rejected).
        const rowValue = (shape: 'number' | 'vec3', i: number) => (shape === 'vec3' ? [0.4 + i, 0.2 * i, 0.3] : 0.5 + 0.1 * i);
        const surfaceMat = () => `mat_${surfaceModels[n % surfaceModels.length]}`;
        for (const d of Object.values(PRIMITIVES)) {
            const parameters = Object.fromEntries(d.params.map((p, i) => [p.name, p.default ?? rowValue(p.shape, i)]));
            const constant = { transform: { position: [n * 3, 0.5, 0] as [number, number, number] } };
            const driven = {
                transform: {
                    position: { param: `sink.pos${n}`, default: [n * 3, 0.5, 3] as [number, number, number] },
                    rotation: { axis: [0, 1, 0] as [number, number, number], angle: { param: `sink.angle${n}`, default: 0.3 } },
                    scale: { param: `sink.scale${n}`, default: 1.0, min: 0.5, max: 2.0 },
                },
            };
            if (d.provides.sdf) {
                objects.push({ type: d.type, parameters, material: surfaceMat(), backend: 'sdf', ...constant, name: `sink_sdf_${d.type}` });
                n++;
                objects.push({ type: d.type, parameters, material: surfaceMat(), backend: 'sdf', ...driven, name: `sink_sdf_${d.type}_driven` });
                n++;
            }
            if (d.provides.analytic) {
                objects.push({ type: d.type, parameters, material: surfaceMat(), backend: 'analytic', ...constant, name: `sink_ana_${d.type}` });
                n++;
                objects.push({ type: d.type, parameters, material: surfaceMat(), backend: 'analytic', ...driven, name: `sink_ana_${d.type}_driven` });
                n++;
            }
        }
        // One region per phase medium (the dispatch needs every model PRESENT on a region).
        for (const id of Object.keys(VOLUME_SCATTERING_MODELS)) {
            objects.push({
                type: 'sphere', parameters: { center: [n * 3, 0.5, -3], radius: 0.6 },
                material: `medium_${id}`, name: `sink_medium_${id}`,
            });
            n++;
        }

        // Every light kind — sample authored forms; a registry kind without one fails loudly.
        const sampleLights: Record<string, LightDescription> = {
            point: { kind: 'point', position: [0, 6, 0], emission: 20 },
            quad: { kind: 'quad', corner: [-0.5, 5.98, -0.5], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: 10 },
            sphere: { kind: 'sphere', position: [4, 6, 0], radius: 0.3, emission: 10 },
            disk: { kind: 'disk', position: [8, 6, 0], radius: 0.4, normal: [0, -1, 0], emission: 10 },
            spot: { kind: 'spot', position: [12, 6, 0], direction: [0, -1, 0], angle: 0.6, emission: 15 },
            directional: { kind: 'directional', direction: [0.3, -1, 0.2], emission: 2 },
            beam: { kind: 'beam', position: [16, 6, 0], direction: [0, -1, 0], radius: 0.25, emission: 40 },
        };
        const lights: LightDescription[] = [];
        for (const kind of Object.keys(LIGHT_KINDS)) {
            if (LIGHT_KINDS[kind].authoredParams.length === 0) continue;   // sampleAsLight-route-only (mesh) — compile-covered by the mesh-light suite scenes
            const sample = sampleLights[kind];
            if (sample === undefined) {
                throw new Error(`kitchen sink: light kind '${kind}' has no sample authored form — add one so its GLSL stays compile-covered`);
            }
            lights.push(sample);
        }

        const scene: SceneDescription = {
            id: 'kitchen-sink',
            name: 'Registry kitchen sink (synthesized)',
            ambientSpace: { type: 'euclidean' },
            objects,
            materials,
            lights,
            environment: { type: 'constant', color: [0.1, 0.1, 0.12], intensity: 1.0 },
        };
        const strategy: RenderStrategy = {
            id: 'sink-mis',
            measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 4 },
            estimator: { directLighting: 'mis', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
            view: { tonemap: { type: 'reinhard' } },
        };

        const renderer = compiler.compile(scene, strategy);
        for (const [shaderId, prog] of renderer.shaders) {
            check(prog.vertex, 'vert', `${shaderId} [vertex]`);
            check(prog.fragment, 'frag', `${shaderId} [fragment]`);
        }
    });

    // Heterogeneous media sink (fable-heterogeneous-media.md + impl-plan-medium-emission):
    // delta-tracking × mis is Validator-rejected, so the null-collision arms need their
    // own pair under pt-nee. Covers all three occupant functions (delta, ratio
    // pass-through, ratio shadow), the D1 clamp splice (incl. the P2 ε scale), the
    // Spectrum() expression wrap, expression-param minting, the ε expression splice,
    // the closed-form emissive absorbing arm, and the auto-derived-majorant routing.
    it('heterogeneous media sink + pt-nee delta-tracking', () => {
        const scene: SceneDescription = {
            id: 'het-sink',
            name: 'Heterogeneous media sink (synthesized)',
            ambientSpace: { type: 'euclidean' },
            objects: [
                { type: 'box', parameters: { center: [0, 1, 0], halfSize: [1, 1, 1] }, material: 'fog', name: 'het_fog' },
                { type: 'box', parameters: { center: [3, 1, 0], halfSize: [1, 1, 1] }, material: 'ink', name: 'het_ink' },
                { type: 'box', parameters: { center: [6, 1, 0], halfSize: [1, 1, 1] }, material: 'ember', name: 'sink_ember' },
                { type: 'box', parameters: { center: [9, 1, 0], halfSize: [1, 1, 1] }, material: 'glowmist', name: 'sink_glowmist' },
                { type: 'quad', parameters: { corner: [-5, 0, -5], edge1: [10, 0, 0], edge2: [0, 0, 10] }, material: 'floor', name: 'floor' },
            ],
            materials: {
                floor: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
                // Delta-tracking arm: scattering formula with a declared slider + majorant,
                // plus an ε EXPRESSION (P3 collection + the P2 clamp scale on ε).
                fog: {
                    model: 'none',
                    medium: {
                        sigma_a: [0.05, 0.05, 0.05],
                        sigma_s: { kind: 'glsl', source: 'u_sink_gain * exp(-2.0 * p.y)', params: [{ param: 'sink.gain', default: 1.5, min: 0, max: 4 }] },
                        emission: { kind: 'glsl', source: 'vec3(0.4, 0.2, 0.1) * exp(-p.y)' },
                        majorant: 4.2,
                        phase_g: 0.3,
                    },
                },
                // Ratio pass-through arm: absorbing-only formula (σ_s constant zero).
                ink: {
                    model: 'none',
                    medium: {
                        sigma_a: { kind: 'glsl', source: '2.0 + p.x' },
                        majorant: 6.0,
                    },
                },
                // Closed-form emissive absorbing arm (constant everything — analytic).
                ember: {
                    model: 'none',
                    medium: { sigma_a: [1.5, 1.0, 0.5], emission: [2.0, 0.8, 0.2] },
                },
                // Auto-derived majorant (P5): constant-ε SCATTERING medium, no majorant.
                glowmist: {
                    model: 'none',
                    medium: { sigma_a: [0.2, 0.2, 0.2], sigma_s: [0.6, 0.6, 0.6], emission: [0.5, 0.5, 0.5], phase_g: 0.2 },
                },
            },
            lights: [{ kind: 'point', position: [0, 6, 0], emission: 20 }],
            environment: { type: 'constant', color: [0.1, 0.1, 0.12], intensity: 1.0 },
        };
        const strategy: RenderStrategy = {
            id: 'sink-het-nee',
            measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 6 },
            estimator: {
                directLighting: 'nee',
                volumeSampling: 'delta-tracking',
                russianRoulette: { startDepth: 3 },
                accumulation: { type: 'average' },
            },
            view: { tonemap: { type: 'reinhard' } },
        };
        const renderer = compiler.compile(scene, strategy);
        for (const [shaderId, prog] of renderer.shaders) {
            check(prog.vertex, 'vert', `${shaderId} [vertex]`);
            check(prog.fragment, 'frag', `${shaderId} [fragment]`);
        }
    });
});
