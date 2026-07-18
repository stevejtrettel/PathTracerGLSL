// compiler/generate/ShaderBuilder.ts

import type { ShaderProgram } from '../types.js';
import type { PlannedUniform, ProgramDescription } from '../plan/types.js';
import type { PlannedTexture } from './features/types.js';
import type { ShaderBlock, BlockMapping } from './ShaderIR.js';
import { assembleBlocks } from './ShaderIR.js';
import type { MergedContributions } from './features/merge.js';

// Display components assembled by the Generator itself (not a swappable feature).
// fullscreen.vert + display.glsl are fixed plumbing/math (glsl/shared/): fullscreen.vert
// is used by every pass (main/display/bake); display.glsl holds the shared safe_color +
// sRGB OETF. Tonemap occupants (the tone CURVE only) come from the tonemap registry.
import fullscreenVertGLSL from '../../glsl/shared/fullscreen.vert.glsl?raw';
import displayMathGLSL from '../../glsl/shared/display.glsl?raw';
import blueNoiseGLSL from '../../glsl/shared/noise.glsl?raw';
import { tonemapModel, type TonemapDescriptor } from '../../components/tonemap/index.js';

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
        { origin: 'glsl/shared/fullscreen.vert.glsl', source: fullscreenVertGLSL },
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
    const model = tonemapModel(tonemap.type);
    // 'none' is the raw probe path: exposure forced to 1.0 so a pixel IS the accumulator
    // value (§11). Every encoding occupant applies the requested exposure.
    const exposure = tonemap.type === 'none' ? 1.0 : (tonemap.exposure ?? 1.0);
    // The display pass's resources are declared HERE, not in the tonemap occupants:
    // u_radiance is the pass's texture input, u_resolution the engine builtin — occupants
    // contain the tone CURVE only. safe_color + the sRGB OETF are the shared display math.
    // Blue-noise dither is applied only when we quantize to display bytes (the encode
    // path). 'none' (the §11 probe path) stays bit-exact — no dither, no u_blueNoise.
    const dither = model.encodesToDisplay;
    const header = [
        FRAGMENT_PREAMBLE,
        '',
        'out vec4 fragColor;',
        'uniform vec2 u_resolution;',
        'uniform sampler2D u_radiance;',
        ...(dither ? ['uniform sampler2D u_blueNoise;'] : []),
        `#define DISPLAY_EXPOSURE ${exposure.toPrecision(8)}`,
    ].join('\n');
    return [
        { origin: 'generated:display-header', source: header },
        { origin: 'glsl/shared/display.glsl', source: displayMathGLSL },
        ...(dither ? [{ origin: 'glsl/shared/noise.glsl', source: blueNoiseGLSL }] : []),
        { origin: model.origin, source: model.glsl },
        { origin: 'generated:display-main', source: buildDisplayMain(model) },
    ];
}

/** The composed display main() — policy/plumbing (generated), calling the occupant's
 *  static curve: exposure → curve → (sRGB encode + clamp + blue-noise dither, iff the
 *  occupant encodes to display bytes). */
function buildDisplayMain(model: TonemapDescriptor): string {
    // Dither in display-code space, right before the implicit 8-bit write: ±½ LSB of
    // blue noise, INDEPENDENT per channel (blue_noise returns a decorrelated RGB triple),
    // turns quantization banding into imperceptible high-frequency grain.
    const encode = model.encodesToDisplay
        ? '    color = clamp(linear_to_srgb(color), 0.0, 1.0);\n'
        + '    color += (blue_noise(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0);\n'
        : '';
    return [
        'void main() {',
        '    vec2 uv = gl_FragCoord.xy / u_resolution;',
        '    vec3 color = safe_color(texture(u_radiance, uv).rgb) * DISPLAY_EXPOSURE;',
        `    color = ${model.curveFn}(color);`,
        `${encode}    fragColor = vec4(color, 1.0);`,
        '}',
    ].join('\n');
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
        // `float[]` declares as `uniform float u_x[N];` (the array length rides the
        // PlannedUniform; the upload infers it from the Float32Array).
        if (u.type === 'float[]') {
            lines.push(`uniform float ${u.name}[${u.arrayLength}];`);
        } else {
            lines.push(`uniform ${u.type} ${u.name};`);
        }
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
