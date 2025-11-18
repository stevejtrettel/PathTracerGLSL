// compiler/utils/shader-builder-utils.ts
import type { ModuleDescriptor } from '../../engine/types';
import { MODULE_ORDER } from '../../engine/types';
import commonStructsGLSL from '../../engine/common-structs.glsl?raw';
import rngSystem from '../../../research/math/random/rng-system.glsl?raw';

/**
 * Build main fragment shader from modules
 */
export function buildMainShaderSource(modules: ModuleDescriptor[]): string {
    const parts: string[] = [];

    // Header
    parts.push('#version 300 es');
    parts.push('precision highp float;');
    parts.push('');

    // Common structs
    parts.push('// ============ COMMON STRUCTS ============');
    parts.push(commonStructsGLSL);
    parts.push('');

    // Engine uniforms
    parts.push('// ============ ENGINE UNIFORMS ============');
    parts.push('uniform vec2 u_resolution;');
    parts.push('uniform vec2 u_image_size;');
    parts.push('uniform int u_frame_index;');
    parts.push('uniform float u_time;');
    parts.push('uniform int u_sample_count;');
    parts.push('uniform vec2 u_pixel_offset;');
    parts.push('');

    // RNG system
    parts.push('// ============ RNG SYSTEM ============');
    parts.push(rngSystem);
    parts.push('');

    // Module code (skip developer module)
    const orderedModules = orderModules(modules);
    for (const module of orderedModules) {
        if (module.id.kind === 'developer') continue;

        parts.push(`// ============ ${module.id.name} (${module.id.kind}) ============`);

        if (module.fragment.constants) {
            parts.push(module.fragment.constants);
        }
        if (module.fragment.uniforms) {
            parts.push(module.fragment.uniforms);
        }
        parts.push(module.fragment.functions);
        parts.push('');
    }

    // Output and main function
    parts.push('out vec4 fragColor;');
    parts.push('');
    parts.push(generateMainFunction());

    return parts.join('\n');
}

/**
 * Build display/tone mapping shader
 */
export function buildDisplayShaderSource(modules: ModuleDescriptor[]): string {
    const developer = modules.find(m => m.id.kind === 'developer');
    if (!developer) {
        throw new Error('No developer module found');
    }

    const parts: string[] = [];

    // Header
    parts.push('#version 300 es');
    parts.push('precision highp float;');
    parts.push('');

    // Uniforms and type aliases
    parts.push('uniform sampler2D u_radiance_texture;');
    parts.push('');
    parts.push('#define Radiance vec3');
    parts.push('#define RGB vec3');
    parts.push('');

    // Developer module code
    if (developer.fragment.constants) {
        parts.push(developer.fragment.constants);
    }
    if (developer.fragment.uniforms) {
        parts.push(developer.fragment.uniforms);
    }
    parts.push(developer.fragment.functions);
    parts.push('');

    // Output and main function
    parts.push('out vec4 fragColor;');
    parts.push('');
    parts.push(`void main() {
    ivec2 coord = ivec2(gl_FragCoord.xy);
    Radiance radiance = texelFetch(u_radiance_texture, coord, 0).rgb;
    RGB color = developer_develop(radiance);
    fragColor = vec4(color, 1.0);
}`);

    return parts.join('\n');
}

/**
 * Build fullscreen triangle vertex shader
 */
export function buildVertexShaderSource(): string {
    return `#version 300 es
void main() {
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    gl_Position = vec4(x, y, 0.0, 1.0);
}`;
}

/**
 * Order modules according to MODULE_ORDER
 */
export function orderModules(modules: ModuleDescriptor[]): ModuleDescriptor[] {
    const moduleMap = new Map(modules.map(m => [m.id.kind, m]));
    const result: ModuleDescriptor[] = [];

    for (const kind of MODULE_ORDER) {
        const module = moduleMap.get(kind);
        if (module) {
            result.push(module);
            moduleMap.delete(kind);
        }
    }

    if (moduleMap.size > 0) {
        console.warn('Unordered modules:', Array.from(moduleMap.keys()));
    }

    return result;
}

/**
 * Add line numbers to shader source for debugging
 */
export function addLineNumbers(source: string): string {
    const lines = source.split('\n');
    const lineNumWidth = String(lines.length).length;

    return lines
        .map((line, index) => {
            const lineNum = String(index + 1).padStart(lineNumWidth, ' ');
            return `${lineNum}: ${line}`;
        })
        .join('\n');
}

/**
 * Generate main function that orchestrates the rendering pipeline
 */
function generateMainFunction(): string {
    return `
void main() {
    vec2 pixel = gl_FragCoord.xy + u_pixel_offset;
    
    // Initialize RNG seed from pixel coordinates and frame index
    rng_seed = hash_init(uvec2(pixel), uint(u_frame_index));
    rng_counter = 0u;
    
    // Render pipeline
    Ray ray = camera_generateRay(pixel, random2());
    Spectrum spectrum = transport_trace(ray);
    Radiance radiance = accumulator_accumulate(spectrum, pixel);
    
    fragColor = vec4(radiance, 1.0);
}`;
}
