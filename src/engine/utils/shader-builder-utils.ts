// shader-builder-utils.ts
import type { ModuleDescriptor } from '../types';
import { MODULE_ORDER } from '../types';
import commonStructsGLSL from '../common-structs.glsl?raw';

import rngSystem from '../../math/random/rng-system.glsl?raw'



export function generateMainFunction(): string {
    return `
void main(){

    vec2 pixel = gl_FragCoord.xy + u_pixel_offset;
    
    // Initialize RNG seed once per pixel
    // robust seed from pixel + frame
    rng_seed = hash_init(uvec2(pixel), uint(u_frame_index));
    rng_counter = 0u;
                   
    // Now just use random() or random2() anywhere!
    Ray ray = camera_generateRay(pixel, random2());
    Spectrum spectrum = transport_trace(ray);
    Radiance radiance = accumulator_accumulate(spectrum, pixel);
    
    fragColor = vec4(radiance, 1.0);
}`;
}

export function buildMainShaderSource(modules: ModuleDescriptor[]): string {
    const parts: string[] = [];

    parts.push('#version 300 es');
    parts.push('precision highp float;');
    parts.push('');
    parts.push('// ============ COMMON STRUCTS ============');
    parts.push(commonStructsGLSL);
    parts.push('');
    parts.push('// ============ ENGINE UNIFORMS ============');
    parts.push('uniform vec2 u_resolution;');      // Framebuffer
    parts.push('uniform vec2 u_image_size;');      // Full image (camera uses this)
    parts.push('uniform int u_frame_index;');
    parts.push('uniform float u_time;');
    parts.push('uniform int u_sample_count;');
    parts.push('uniform vec2 u_pixel_offset;');
    parts.push('');

    // Add the RNG system
    parts.push(rngSystem);
    parts.push('');

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

    parts.push('out vec4 fragColor;');
    parts.push('');
    parts.push(generateMainFunction());

    return parts.join('\n');
}

export function buildDisplayShaderSource(modules: ModuleDescriptor[]): string {
    const developer = modules.find(m => m.id.kind === 'developer');
    if (!developer) {
        throw new Error('No developer module found');
    }

    const parts: string[] = [];

    parts.push('#version 300 es');
    parts.push('precision highp float;');
    parts.push('');
    parts.push('uniform sampler2D u_radiance_texture;');
    parts.push('');
    parts.push('#define Radiance vec3');
    parts.push('#define RGB vec3');
    parts.push('');

    if (developer.fragment.constants) {
        parts.push(developer.fragment.constants);
    }
    if (developer.fragment.uniforms) {
        parts.push(developer.fragment.uniforms);
    }
    parts.push(developer.fragment.functions);
    parts.push('');
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

export function buildVertexShaderSource(): string {
    return `#version 300 es
void main() {
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    gl_Position = vec4(x, y, 0.0, 1.0);
}`;
}

export function orderModules(mods: ModuleDescriptor[]): ModuleDescriptor[] {
    const moduleMap = new Map(mods.map(m => [m.id.kind, m]));
    const result: ModuleDescriptor[] = [];

    for (const kind of MODULE_ORDER) {
        const m = moduleMap.get(kind);
        if (m) {
            result.push(m);
            moduleMap.delete(kind);
        }
    }

    if (moduleMap.size > 0) {
        console.warn('Unordered modules:', Array.from(moduleMap.keys()));
    }

    return result;
}

export function addLineNumbers(source: string): string {
    const lines = source.split('\n');
    const lineNumWidth = String(lines.length).length;

    return lines.map((line, index) => {
        const lineNum = String(index + 1).padStart(lineNumWidth, ' ');
        return `${lineNum}: ${line}`;
    }).join('\n');
}
