// compiler/generate/ShaderBuilder.ts

import type { ShaderProgram } from '../types.js';
import type { RenderPlan, ProgramDescription, PlannedUniform } from '../plan/types.js';
import type { ShaderBlock, BlockMapping } from './ShaderIR.js';
import { assembleBlocks } from './ShaderIR.js';
import type { MergedContributions } from './features/merge.js';
import { formatFloat } from './features/glsl-format.js';

// GLSL owned by the Generator itself (not a swappable feature)
import fullscreenVertGLSL from './glsl/fullscreen.vert.glsl?raw';
import tonemapReinhardGLSL from './glsl/tonemap_reinhard.glsl?raw';

export interface ShaderBuildResult {
    shaders: Map<string, ShaderProgram>;
    sourceMaps: Map<string, BlockMapping[]>;
}

export function buildShaders(plan: RenderPlan, merged: MergedContributions, rendererId: string): ShaderBuildResult {
    const shaders = new Map<string, ShaderProgram>();
    const sourceMaps = new Map<string, BlockMapping[]>();

    // Vertex shader (shared)
    const vertexAssembled = assembleBlocks([
        { origin: 'generated:version', source: '#version 300 es' },
        { origin: 'glsl/fullscreen.vert.glsl', source: fullscreenVertGLSL },
    ]);

    // Pathtracer fragment — from the feature contributions merged in section order (§2.10)
    const ptAssembled = assembleBlocks(buildPathtracerBlocks(plan.program, merged));
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

function buildPathtracerBlocks(program: ProgramDescription, merged: MergedContributions): ShaderBlock[] {
    return [
        { origin: 'generated:header', source: buildHeader(program) },
        { origin: 'generated:uniforms', source: buildUniformDeclarations(merged.uniforms) },
        ...merged.blocks,
    ];
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
// Uniform declarations (from the merged contribution list)
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
