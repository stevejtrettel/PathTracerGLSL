// compiler/generate/ShaderBuilder.ts

import type { ShaderProgram } from '../types.js';
import type { PlannedUniform, ProgramDescription } from '../plan/types.js';
import type { PlannedTexture } from './features/types.js';
import type { ShaderBlock, BlockMapping } from './ShaderIR.js';
import { assembleBlocks } from './ShaderIR.js';
import type { MergedContributions } from './features/merge.js';

// Film components assembled by the Generator itself (not a swappable feature)
import fullscreenVertGLSL from '../../components/film/fullscreen.vert.glsl?raw';
import tonemapReinhardGLSL from '../../components/film/tonemap_reinhard/tonemap_reinhard.glsl?raw';
import tonemapNoneGLSL from '../../components/film/tonemap_none/tonemap_none.glsl?raw';

export interface ShaderBuildResult {
    shaders: Map<string, ShaderProgram>;
    sourceMaps: Map<string, BlockMapping[]>;
}

export function buildShaders(merged: MergedContributions, rendererId: string, tonemap: ProgramDescription['view']['tonemap'], varianceOutputs = false): ShaderBuildResult {
    const shaders = new Map<string, ShaderProgram>();
    const sourceMaps = new Map<string, BlockMapping[]>();

    // Vertex shader (shared)
    const vertexAssembled = assembleBlocks([
        { origin: 'generated:version', source: '#version 300 es' },
        { origin: 'components/film/fullscreen.vert.glsl', source: fullscreenVertGLSL },
    ]);

    // Pathtracer fragment — from the feature contributions merged in section order (§2.10)
    const ptAssembled = assembleBlocks(buildPathtracerBlocks(merged, varianceOutputs));
    const mainShaderId = `${rendererId}-main`;
    shaders.set(mainShaderId, {
        vertex: vertexAssembled.source,
        fragment: ptAssembled.source,
    });
    sourceMaps.set(mainShaderId, ptAssembled.blockMap);

    // Display fragment
    const displayAssembled = assembleBlocks(buildDisplayBlocks(tonemap));
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

function buildPathtracerBlocks(merged: MergedContributions, varianceOutputs: boolean): ShaderBlock[] {
    return [
        { origin: 'generated:header', source: buildHeader(merged.defines, varianceOutputs) },
        { origin: 'generated:uniforms', source: buildUniformDeclarations(merged.uniforms, merged.textures, varianceOutputs) },
        ...merged.blocks,
    ];
}

// ============================================================================
// Display Fragment Shader (block assembly)
// ============================================================================

function buildDisplayBlocks(tonemap: ProgramDescription['view']['tonemap']): ShaderBlock[] {
    // The display shader is plan-driven (audit C2: it used to emit Reinhard unconditionally,
    // silently ignoring `display: { type: 'none' }` and `exposure`). Exposure is strategy
    // data, so it bakes as a constant — a strategy change recompiles anyway.
    const exposure = tonemap.type === 'none' ? 1.0 : (tonemap.exposure ?? 1.0);
    // The display pass's resources are declared HERE, not in the tonemap templates
    // (bundle i-b): u_radiance is the pass's texture input, u_resolution the engine
    // builtin — templates only contain the tonemap math.
    const header = [
        FRAGMENT_PREAMBLE,
        '',
        'out vec4 fragColor;',
        'uniform vec2 u_resolution;',
        'uniform sampler2D u_radiance;',
        `#define DISPLAY_EXPOSURE ${exposure.toPrecision(8)}`,
    ].join('\n');
    return [
        { origin: 'generated:display-header', source: header },
        tonemap.type === 'none'
            ? { origin: 'components/film/tonemap_none/tonemap_none.glsl', source: tonemapNoneGLSL }
            : { origin: 'components/film/tonemap_reinhard/tonemap_reinhard.glsl', source: tonemapReinhardGLSL },
    ];
}

// ============================================================================
// Header with #defines
// ============================================================================

const FRAGMENT_PREAMBLE = '#version 300 es\nprecision highp float;\nprecision highp int;';

function buildHeader(defines: Record<string, string>, varianceOutputs = false): string {
    const lines: string[] = [];
    lines.push(FRAGMENT_PREAMBLE);
    lines.push('');
    if (varianceOutputs) {
        // MRT for the variance accumulation occupant: mean + second moment.
        lines.push('layout(location = 0) out vec4 fragColor;');
        lines.push('layout(location = 1) out vec4 fragMoment;');
    } else {
        lines.push(`out vec4 fragColor;`);
    }
    lines.push('');

    // #defines contributed by features (§2.10). A flag define has an empty value.
    for (const [name, value] of Object.entries(defines)) {
        lines.push(value === '' ? `#define ${name}` : `#define ${name} ${value}`);
    }

    return lines.join('\n');
}

// ============================================================================
// Uniform declarations (from the merged contribution list)
// ============================================================================

function buildUniformDeclarations(uniforms: PlannedUniform[], textures: PlannedTexture[] = [], varianceOutputs = false): string {
    const lines: string[] = [];
    lines.push('// Uniforms');

    for (const u of uniforms) {
        lines.push(`uniform ${u.type} ${u.name};`);
    }

    // Feature-declared external textures (§2.10): the sampler declaration matches the
    // pass-input name PipelineBuilder threads through as `extern:<name>`.
    for (const t of textures) {
        lines.push(`uniform sampler2D ${t.name};`);
    }

    // Previous accumulation texture (always needed for progressive rendering)
    lines.push('uniform sampler2D u_previous;');
    // Previous second-moment texture (variance accumulation occupant only; bound by
    // the pathtracer pass input 'accumulation_previous:1').
    if (varianceOutputs) lines.push('uniform sampler2D u_previousMoment;');

    return lines.join('\n');
}
