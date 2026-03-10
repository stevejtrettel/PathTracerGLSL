// compiler/generate/ShaderBuilder.ts

import type { ShaderProgram } from '../types.js';
import { isGlslExpression } from '../types.js';
import type { RenderPlan, PlannedSDFObject, PlannedMaterial, PlannedLight, ProgramDescription, PlannedUniform } from '../plan/types.js';
import type { ShaderBlock, BlockMapping } from './ShaderIR.js';
import { assembleBlocks } from './ShaderIR.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';

// Import GLSL library files
import structsGLSL from './glsl/structs.glsl?raw';
import rngGLSL from './glsl/rng.glsl?raw';
import mathGLSL from './glsl/math.glsl?raw';
import euclideanGLSL from './glsl/euclidean.glsl?raw';
import sdfPrimitivesGLSL from './glsl/sdf_primitives.glsl?raw';
import raymarchGLSL from './glsl/raymarch.glsl?raw';
import lambertGLSL from './glsl/lambert.glsl?raw';
import tonemapReinhardGLSL from './glsl/tonemap_reinhard.glsl?raw';

// Import GLSL templates
import fullscreenVertGLSL from './glsl/fullscreen.vert.glsl?raw';
import cameraPinholeGLSL from './glsl/camera_pinhole.glsl?raw';
import pathTraceGLSL from './glsl/path_trace.glsl?raw';
import mainAccumulateGLSL from './glsl/main_accumulate.glsl?raw';

export interface ShaderBuildResult {
    shaders: Map<string, ShaderProgram>;
    sourceMaps: Map<string, BlockMapping[]>;
}

export function buildShaders(plan: RenderPlan, rendererId: string, bag: DiagnosticBag): ShaderBuildResult {
    const shaders = new Map<string, ShaderProgram>();
    const sourceMaps = new Map<string, BlockMapping[]>();

    // Vertex shader (shared)
    const vertexAssembled = assembleBlocks([
        { origin: 'generated:version', source: '#version 300 es' },
        { origin: 'glsl/fullscreen.vert.glsl', source: fullscreenVertGLSL },
    ]);

    // Pathtracer fragment
    const ptAssembled = assembleBlocks(buildPathtracerBlocks(plan, bag));
    const mainShaderId = `${rendererId}-main`;
    shaders.set(mainShaderId, {
        vertex: vertexAssembled.source,
        fragment: ptAssembled.source,
    });
    sourceMaps.set(mainShaderId, ptAssembled.blockMap);

    // Display fragment
    const displayAssembled = assembleBlocks(buildDisplayBlocks());
    const displayShaderId = `${rendererId}-display`;
    shaders.set(displayShaderId, {
        vertex: vertexAssembled.source,
        fragment: displayAssembled.source,
    });
    sourceMaps.set(displayShaderId, displayAssembled.blockMap);

    return { shaders, sourceMaps };
}

// ============================================================================
// Pathtracer Fragment Shader (block assembly)
// ============================================================================

function buildPathtracerBlocks(plan: RenderPlan, bag: DiagnosticBag): ShaderBlock[] {
    const blocks: ShaderBlock[] = [];
    const program = plan.program;

    blocks.push({ origin: 'generated:header', source: buildHeader(program) });
    blocks.push({ origin: 'generated:uniforms', source: buildUniformDeclarations(plan.uniforms) });

    // Core library (always)
    blocks.push({ origin: 'glsl/structs.glsl', source: structsGLSL });
    blocks.push({ origin: 'glsl/rng.glsl', source: rngGLSL });
    blocks.push({ origin: 'glsl/math.glsl', source: mathGLSL });
    blocks.push({ origin: 'glsl/euclidean.glsl', source: euclideanGLSL });

    // Intersection — driven by program.intersection
    if (program.intersection.method === 'raymarch') {
        blocks.push({ origin: 'glsl/sdf_primitives.glsl', source: sdfPrimitivesGLSL });
        blocks.push({ origin: 'generated:sdf-dispatch', source: generateSDFDispatch(plan.objects) });
        blocks.push({ origin: 'glsl/raymarch.glsl', source: raymarchGLSL });
    }

    // Materials — driven by program.materials
    blocks.push({ origin: 'generated:material-lookup', source: generateMaterialLookup(plan.materials) });
    for (const model of program.materials.models) {
        if (model === 'lambert') blocks.push({ origin: 'glsl/lambert.glsl', source: lambertGLSL });
    }

    // Lighting — driven by program.lighting
    if (program.lighting !== null) {
        blocks.push({ origin: 'generated:light-sampling', source: generateLightSampling(plan.lights) });
    }

    // Camera — driven by program.camera
    blocks.push({ origin: cameraOrigin(program), source: buildCamera(program, bag) });

    // Transport — driven by program.transport
    blocks.push({ origin: 'glsl/path_trace.glsl', source: pathTraceGLSL });

    // Accumulation — driven by program.accumulation
    blocks.push({ origin: accumulationOrigin(program), source: buildAccumulation(program, bag) });

    return blocks;
}

function cameraOrigin(program: ProgramDescription): string {
    if (program.camera.type === 'pinhole') return 'glsl/camera_pinhole.glsl';
    return `generated:camera-${program.camera.type}`;
}

function accumulationOrigin(program: ProgramDescription): string {
    if (program.accumulation.type === 'average') return 'glsl/main_accumulate.glsl';
    return `generated:main-${program.accumulation.type}`;
}

// ============================================================================
// Display Fragment Shader (block assembly)
// ============================================================================

function buildDisplayBlocks(): ShaderBlock[] {
    return [
        { origin: 'generated:display-header', source: FRAGMENT_PREAMBLE + '\n\nout vec4 fragColor;' },
        { origin: 'glsl/tonemap_reinhard.glsl', source: tonemapReinhardGLSL },
    ];
}

// ============================================================================
// Header with #defines
// ============================================================================

const FRAGMENT_PREAMBLE = '#version 300 es\nprecision highp float;\nprecision highp int;';

function buildHeader(program: ProgramDescription): string {
    const lines: string[] = [];
    lines.push(FRAGMENT_PREAMBLE);
    lines.push('');
    lines.push(`out vec4 fragColor;`);
    lines.push('');

    // Transport defines
    lines.push(`#define MAX_BOUNCES ${program.transport.maxBounces}`);

    if (program.lighting !== null) {
        lines.push(`#define ENABLE_NEE`);
    }

    if (program.transport.russianRoulette) {
        lines.push(`#define ENABLE_RUSSIAN_ROULETTE`);
        lines.push(`#define RR_START_DEPTH ${program.transport.russianRoulette.startDepth}`);
    }

    // Camera defines
    if (program.camera.type === 'pinhole') {
        lines.push(`#define TAN_FOV ${formatFloat(Math.tan(program.camera.fov * 0.5))}`);
    }

    return lines.join('\n');
}

// ============================================================================
// Uniform declarations (generated from plan)
// ============================================================================

function buildUniformDeclarations(uniforms: PlannedUniform[]): string {
    const lines: string[] = [];
    lines.push('// Uniforms');

    for (const u of uniforms) {
        lines.push(`uniform ${u.type} ${u.name};`);
    }

    // Previous accumulation texture (always needed for progressive rendering)
    lines.push('uniform sampler2D u_previous;');

    return lines.join('\n');
}

// ============================================================================
// Camera (template selection)
// ============================================================================

function buildCamera(program: ProgramDescription, bag: DiagnosticBag): string {
    if (program.camera.type === 'pinhole') {
        return cameraPinholeGLSL;
    }
    bag.error('invalid-setting', `Camera type '${(program.camera as any).type}' not yet supported`).add();
    return '// unsupported camera';
}

// ============================================================================
// Accumulation / main function (template selection)
// ============================================================================

function buildAccumulation(program: ProgramDescription, bag: DiagnosticBag): string {
    if (program.accumulation.type === 'average') {
        return mainAccumulateGLSL;
    }
    bag.error('invalid-setting', `Accumulation type '${(program.accumulation as any).type}' not yet supported`).add();
    return '// unsupported accumulation';
}

// ============================================================================
// Generated SDF dispatch (per-scene codegen)
// ============================================================================

function generateSDFDispatch(objects: PlannedSDFObject[]): string {
    const lines: string[] = [];
    lines.push('// Generated SDF dispatch');

    // Per-object wrapper functions
    for (const obj of objects) {
        lines.push(`float sdf_object_${obj.index}(vec3 p) {`);
        if (obj.translation) {
            lines.push(`    p = p - ${formatVec3(obj.translation)};`);
        }
        lines.push(`    return ${generateSDFCall(obj)};`);
        lines.push(`}`);
        lines.push('');
    }

    // scene_sdf dispatch
    lines.push('float scene_sdf(vec3 p, out int material) {');
    lines.push(`    float d = 1e20;`);
    lines.push(`    float d_obj;`);
    lines.push(`    material = 0;`);

    for (const obj of objects) {
        lines.push(`    d_obj = sdf_object_${obj.index}(p);`);
        lines.push(`    if (d_obj < d) { d = d_obj; material = ${obj.materialId}; }`);
    }

    lines.push(`    return d;`);
    lines.push(`}`);
    lines.push('');

    // Distance-only variant for normal estimation and shadow rays
    lines.push('float scene_sdf_dist(vec3 p) {');
    lines.push('    float d = 1e20;');

    for (const obj of objects) {
        lines.push(`    d = min(d, sdf_object_${obj.index}(p));`);
    }

    lines.push('    return d;');
    lines.push('}');

    return lines.join('\n');
}

function generateSDFCall(obj: PlannedSDFObject): string {
    const p = obj.parameters;
    switch (obj.sdfType) {
        case 'sphere': {
            const center = formatVec3(p.center as number[] ?? [0, 0, 0]);
            const radius = formatFloat(p.radius as number ?? 1.0);
            return `sdf_sphere(p, ${center}, ${radius})`;
        }
        case 'plane': {
            const normal = formatVec3(p.normal as number[] ?? [0, 1, 0]);
            const offset = formatFloat(p.offset as number ?? 0.0);
            return `sdf_plane(p, ${normal}, ${offset})`;
        }
        case 'box': {
            const center = formatVec3(p.center as number[] ?? [0, 0, 0]);
            const halfSize = formatVec3(p.halfSize as number[] ?? [1, 1, 1]);
            return `sdf_box(p, ${center}, ${halfSize})`;
        }
        default:
            throw new Error(`ShaderBuilder: unsupported SDF type '${obj.sdfType}'`);
    }
}

// ============================================================================
// Generated material lookup (per-scene codegen)
// ============================================================================

function generateMaterialLookup(materials: PlannedMaterial[]): string {
    const lines: string[] = [];
    lines.push('// Generated material properties lookup');
    lines.push('MaterialProperties scene_material_properties(int id, vec3 p) {');
    lines.push('    MaterialProperties props;');
    lines.push('    props.albedo = vec3(0.8);');
    lines.push('    props.emission = vec3(0.0);');
    lines.push('    props.emission_strength = 0.0;');
    lines.push('    props.roughness = 1.0;');

    for (let i = 0; i < materials.length; i++) {
        const mat = materials[i];
        const cond = i === 0 ? 'if' : 'else if';
        lines.push(`    ${cond} (id == ${mat.id}) {`);

        if (isGlslExpression(mat.albedo)) {
            lines.push(`        props.albedo = ${mat.albedo.source};`);
        } else {
            lines.push(`        props.albedo = ${formatVec3(mat.albedo)};`);
        }

        if (isGlslExpression(mat.emission)) {
            lines.push(`        props.emission = ${mat.emission.source};`);
        } else {
            const hasEmission = mat.emission[0] > 0 || mat.emission[1] > 0 || mat.emission[2] > 0;
            if (hasEmission) {
                lines.push(`        props.emission = ${formatVec3(mat.emission)};`);
                lines.push(`        props.emission_strength = 1.0;`);
            }
        }

        if (isGlslExpression(mat.roughness)) {
            lines.push(`        props.roughness = ${mat.roughness.source};`);
        } else {
            lines.push(`        props.roughness = ${formatFloat(mat.roughness)};`);
        }

        lines.push(`    }`);
    }

    lines.push('    return props;');
    lines.push('}');
    return lines.join('\n');
}

// ============================================================================
// Generated light sampling (per-scene codegen)
// ============================================================================

function generateLightSampling(lights: PlannedLight[]): string {
    const lines: string[] = [];
    lines.push('// Generated light sampling');

    if (lights.length === 0) {
        lines.push('LightSample lighting_sample(Point p) {');
        lines.push('    LightSample ls;');
        lines.push('    ls.pdf = 0.0;');
        lines.push('    return ls;');
        lines.push('}');
        return lines.join('\n');
    }

    if (lights.length === 1) {
        const light = lights[0];
        lines.push('LightSample lighting_sample(Point p) {');
        lines.push('    LightSample ls;');

        if (light.kind === 'point') {
            const pos = formatVec3(light.position!);
            const radiance = formatVec3(light.color.map(c => c * light.intensity));
            lines.push(`    vec3 light_vector = ${pos} - p;`);
            lines.push(`    ls.distance = length(light_vector);`);
            lines.push(`    ls.wi = normalize(light_vector);`);
            lines.push(`    ls.position = ${pos};`);
            lines.push(`    ls.radiance = ${radiance} / (ls.distance * ls.distance);`);
            lines.push(`    ls.pdf = 1.0;`);
        }

        lines.push('    return ls;');
        lines.push('}');
    } else {
        lines.push('LightSample lighting_sample(Point p) {');
        lines.push('    LightSample ls;');
        lines.push(`    float light_choice = random() * ${formatFloat(lights.length)};`);

        for (let i = 0; i < lights.length; i++) {
            const light = lights[i];
            const cond = i === 0 ? `if` : `else if`;
            lines.push(`    ${cond} (light_choice < ${formatFloat(i + 1)}) {`);

            if (light.kind === 'point') {
                const pos = formatVec3(light.position!);
                const radiance = formatVec3(light.color.map(c => c * light.intensity));
                lines.push(`        vec3 light_vector = ${pos} - p;`);
                lines.push(`        ls.distance = length(light_vector);`);
                lines.push(`        ls.wi = normalize(light_vector);`);
                lines.push(`        ls.position = ${pos};`);
                lines.push(`        ls.radiance = ${radiance} / (ls.distance * ls.distance);`);
            }

            lines.push(`    }`);
        }

        lines.push(`    ls.pdf = ${formatFloat(1.0 / lights.length)};`);
        lines.push('    return ls;');
        lines.push('}');
    }

    return lines.join('\n');
}

// ============================================================================
// GLSL formatting helpers
// ============================================================================

function formatFloat(v: number): string {
    if (!Number.isFinite(v)) {
        throw new Error(`ShaderBuilder: cannot format non-finite number: ${v}`);
    }
    const s = v.toString();
    if (s.includes('e') || s.includes('E')) return v.toExponential();
    return s.includes('.') ? s : s + '.0';
}

function formatVec3(v: number[]): string {
    return `vec3(${formatFloat(v[0])}, ${formatFloat(v[1])}, ${formatFloat(v[2])})`;
}
