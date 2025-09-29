// shader-builder-utils.ts
import type { ModuleDescriptor } from './types';
import { MODULE_ORDER } from './types';
import commonStructsGLSL from './common-structs.glsl?raw';

export function getRNGSystem(): string {
    return `
// ============ RNG SYSTEM ============
// Per-fragment RNG state that gets initialized in main()
uint rng_seed;

uint pcg_advance(uint seed) {
    // This combines both steps of PCG
    uint state = seed * 747796405u + 2891336453u;
    uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

float random() {
    rng_seed = pcg_advance(rng_seed);
    return float(rng_seed) / 4294967295.0;
}

// Get two random floats
vec2 random2() {
    return vec2(random(), random());
}

// Get three random floats
vec3 random3() {
    return vec3(random(), random(), random());
}`;
}

export function generateMainFunction(): string {
    return `
void main(){
    vec2 pixel = gl_FragCoord.xy;
    
    // Initialize RNG seed once per pixel
    // Add time for better decorrelation if frame index doesnt update
    rng_seed = uint(uint(pixel.x) * uint(1973) + 
                   uint(pixel.y) * uint(9277) + 
                   uint(u_frame_index) * uint(26699)) | uint(1);
                   
               //     rng_seed = uint(uint(pixel.x) * uint(1973) + 
               // uint(pixel.y) * uint(9277) + 
               // uint(u_frame_index) * uint(26699)) | uint(1);
                   
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
    parts.push('uniform vec2 u_resolution;');
    parts.push('uniform int u_frame_index;');
    parts.push('uniform float u_time;');
    parts.push('uniform int u_sample_count;');
    parts.push('');

    // Add the RNG system
    parts.push(getRNGSystem());
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
