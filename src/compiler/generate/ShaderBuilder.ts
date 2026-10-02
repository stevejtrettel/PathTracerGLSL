// compiler/generate/ShaderBuilder.ts

import type { ShaderProgram } from '../types.js';
import type { PlannedUniform, PlannedPicture, ProgramDescription } from '../plan/types.js';
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
import viewsGLSL from '../../glsl/shared/views.glsl?raw';
import { tonemapModel, type TonemapDescriptor } from '../../components/tonemap/index.js';

export interface ShaderBuildResult {
    shaders: Map<string, ShaderProgram>;
    sourceMaps: Map<string, BlockMapping[]>;
}

export function buildShaders(merged: MergedContributions, rendererId: string, tonemap: ProgramDescription['view']['tonemap'], pictures: PlannedPicture[]): ShaderBuildResult {
    const shaders = new Map<string, ShaderProgram>();
    const sourceMaps = new Map<string, BlockMapping[]>();

    // Vertex shader (shared)
    const vertexAssembled = assembleBlocks([
        { origin: 'generated:version', source: '#version 300 es' },
        { origin: 'glsl/shared/fullscreen.vert.glsl', source: fullscreenVertGLSL },
    ]);

    // Pathtracer fragment — from the feature contributions merged in section order (§2.10)
    const ptAssembled = assembleBlocks(buildPathtracerBlocks(merged, pictures));
    const mainShaderId = `${rendererId}-main`;
    shaders.set(mainShaderId, {
        vertex: vertexAssembled.source,
        fragment: ptAssembled.source,
    });
    sourceMaps.set(mainShaderId, ptAssembled.blockMap);

    // Display fragment
    const displayAssembled = assembleBlocks(buildDisplayBlocks(tonemap, pictures));
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

function buildPathtracerBlocks(merged: MergedContributions, pictures: PlannedPicture[]): ShaderBlock[] {
    return [
        { origin: 'generated:header', source: buildHeader(merged.defines, pictures) },
        { origin: 'generated:uniforms', source: buildUniformDeclarations(merged.uniforms, merged.textures) },
        ...merged.blocks,
    ];
}

// ============================================================================
// Display Fragment Shader (block assembly)
// ============================================================================

function buildDisplayBlocks(tonemap: ProgramDescription['view']['tonemap'], pictures: PlannedPicture[]): ShaderBlock[] {
    // The display shader is plan-driven (audit C2: it used to emit Reinhard unconditionally,
    // silently ignoring `display: { type: 'none' }` and `exposure`). Exposure is strategy
    // data, so it bakes as a constant — a strategy change recompiles anyway.
    const model = tonemapModel(tonemap.type);
    // 'none' is the raw probe path: exposure forced to 1.0 so a pixel IS the accumulator
    // value (§11). Every encoding occupant applies the requested exposure.
    const exposure = tonemap.type === 'none' ? 1.0 : (tonemap.exposure ?? 1.0);
    // The display pass's resources are declared HERE, not in the tonemap occupants: one
    // sampler per picture (the pass's texture inputs), u_picture choosing among them when
    // there is more than one, and the engine builtin u_resolution — occupants contain the
    // tone CURVE only. safe_color + the sRGB OETF are the shared display math.
    // Blue-noise dither is applied only when we quantize to display bytes (the encode
    // path). 'none' (the §11 probe path) stays bit-exact — no dither, no u_blueNoise.
    const dither = model.encodesToDisplay;
    const header = [
        FRAGMENT_PREAMBLE,
        '',
        'out vec4 fragColor;',
        'uniform vec2 u_resolution;',
        ...pictures.map((p) => `uniform sampler2D ${p.display};`),
        ...(pictures.length > 1 ? ['uniform int u_picture;'] : []),
        ...(dither ? ['uniform sampler2D u_blueNoise;'] : []),
        `#define DISPLAY_EXPOSURE ${exposure.toPrecision(8)}`,
    ].join('\n');
    return [
        { origin: 'generated:display-header', source: header },
        { origin: 'glsl/shared/display.glsl', source: displayMathGLSL },
        // The data views, only when some picture is not shown through the tonemap.
        ...(pictures.some((p) => p.view !== 'tonemap') ? [{ origin: 'glsl/shared/views.glsl', source: viewsGLSL }] : []),
        ...(dither ? [{ origin: 'glsl/shared/noise.glsl', source: blueNoiseGLSL }] : []),
        // Origin DERIVED from the registry key (D2 — the path convention is the one truth).
        { origin: `components/tonemap/${model.type}/${model.type}.glsl`, source: model.glsl },
        { origin: 'generated:display-main', source: buildDisplayMain(model, pictures) },
    ];
}

/** The composed display main() — policy/plumbing (generated), calling the occupant's
 *  static curve: the displayed picture → exposure → curve → (sRGB encode + clamp + blue-noise
 *  dither, iff the occupant encodes to display bytes). With more than one picture, u_picture
 *  (its index in the planned list) chooses which — GLSL ES 3.00 cannot index samplers
 *  dynamically. When some picture uses a data view ('unit', 'signed'), each branch computes
 *  its own final color instead (buildDataViewMain). */
function buildDisplayMain(model: TonemapDescriptor, pictures: PlannedPicture[]): string {
    if (pictures.some((p) => p.view !== 'tonemap')) return buildDataViewMain(model, pictures);
    // Dither in display-code space, right before the implicit 8-bit write: ±½ LSB of
    // blue noise, INDEPENDENT per channel (blue_noise returns a decorrelated RGB triple),
    // turns quantization banding into imperceptible high-frequency grain.
    const encode = model.encodesToDisplay
        ? '    color = clamp(linear_to_srgb(color), 0.0, 1.0);\n'
        + '    color += (blue_noise(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0);\n'
        : '';
    const [main, ...rest] = pictures;
    const fetch = (p: PlannedPicture) => `texture(${p.display}, uv).rgb`;
    const pick = rest.length === 0
        ? [`    vec3 color = safe_color(${fetch(main)}) * DISPLAY_EXPOSURE;`]
        : [
            '    vec3 picture;',
            ...rest.map((p, i) => `    ${i === 0 ? 'if' : 'else if'} (u_picture == ${p.attachment}) picture = ${fetch(p)};`),
            `    else picture = ${fetch(main)};`,
            '    vec3 color = safe_color(picture) * DISPLAY_EXPOSURE;',
        ];
    return [
        'void main() {',
        '    vec2 uv = gl_FragCoord.xy / u_resolution;',
        ...pick,
        `    color = ${model.curveFn}(color);`,
        `${encode}    fragColor = vec4(color, 1.0);`,
        '}',
    ].join('\n');
}

/** The display main() for a list that mixes views. Each picture's branch computes its final
 *  color: a 'tonemap' picture through view_tonemap (the same steps as above — safe_color,
 *  exposure, the curve, the sRGB encode), a data picture through its fixed view (views.glsl),
 *  which applies neither exposure nor the curve and keeps negative values until it maps them.
 *  The dither, when the occupant encodes to display bytes, is applied once after the choice. */
function buildDataViewMain(model: TonemapDescriptor, pictures: PlannedPicture[]): string {
    const viewFn: Record<PlannedPicture['view'], string> = { tonemap: 'view_tonemap', unit: 'view_unit', signed: 'view_signed' };
    const shown = (p: PlannedPicture) => `${viewFn[p.view]}(texture(${p.display}, uv).rgb)`;
    const [main, ...rest] = pictures;
    const tonemapped = pictures.some((p) => p.view === 'tonemap');
    return [
        ...(tonemapped ? [
            'vec3 view_tonemap(vec3 picture) {',
            '    vec3 color = safe_color(picture) * DISPLAY_EXPOSURE;',
            `    color = ${model.curveFn}(color);`,
            ...(model.encodesToDisplay ? ['    color = clamp(linear_to_srgb(color), 0.0, 1.0);'] : []),
            '    return color;',
            '}',
            '',
        ] : []),
        'void main() {',
        '    vec2 uv = gl_FragCoord.xy / u_resolution;',
        '    vec3 color;',
        ...rest.map((p, i) => `    ${i === 0 ? 'if' : 'else if'} (u_picture == ${p.attachment}) color = ${shown(p)};`),
        `    ${rest.length > 0 ? 'else ' : ''}color = ${shown(main)};`,
        ...(model.encodesToDisplay ? ['    color += (blue_noise(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0);'] : []),
        '    fragColor = vec4(color, 1.0);',
        '}',
    ].join('\n');
}

// ============================================================================
// Header with #defines
// ============================================================================

const FRAGMENT_PREAMBLE = '#version 300 es\nprecision highp float;\nprecision highp int;';

function buildHeader(defines: Record<string, string>, pictures: PlannedPicture[]): string {
    const lines: string[] = [];
    lines.push(FRAGMENT_PREAMBLE);
    lines.push('');
    // One fragment output per picture, at its attachment's location (MRT when there are more
    // than one); a single picture keeps the plain declaration.
    if (pictures.length > 1) {
        for (const p of pictures) lines.push(`layout(location = ${p.attachment}) out vec4 ${p.output};`);
    } else {
        lines.push(`out vec4 ${pictures[0].output};`);
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

function buildUniformDeclarations(uniforms: PlannedUniform[], textures: PlannedTexture[] = []): string {
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
    // pass-input name PipelineBuilder threads through as `extern:<name>`. Integer
    // samplers carry explicit highp (no default precision for them in ES 3.00).
    for (const t of textures) {
        const precision = t.samplerType === 'usampler2D' || t.precision === 'highp' ? 'highp ' : '';
        lines.push(`uniform ${precision}${t.samplerType ?? 'sampler2D'} ${t.name};`);
    }

    // Each picture's previous-frame sampler is declared by the accumulation feature, from the
    // planned picture list — exact linkage: only a mode that reads history declares any.

    return lines.join('\n');
}
