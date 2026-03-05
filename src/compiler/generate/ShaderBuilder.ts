// compiler/generate/ShaderBuilder.ts

import type { ShaderProgram } from '../types.js';
import type { RenderPlan, PlannedSDFObject, PlannedMaterial, PlannedLight } from '../plan/types.js';

// Import GLSL library files
import structsGLSL from './glsl/structs.glsl?raw';
import rngGLSL from './glsl/rng.glsl?raw';
import mathGLSL from './glsl/math.glsl?raw';
import euclideanGLSL from './glsl/euclidean.glsl?raw';
import sdfPrimitivesGLSL from './glsl/sdf_primitives.glsl?raw';
import raymarchGLSL from './glsl/raymarch.glsl?raw';
import lambertGLSL from './glsl/lambert.glsl?raw';
import tonemapReinhardGLSL from './glsl/tonemap_reinhard.glsl?raw';
import compositeGLSL from './glsl/composite.glsl?raw';

const FULLSCREEN_VERTEX = `#version 300 es
void main() {
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

export function buildShaders(plan: RenderPlan, rendererId: string): Map<string, ShaderProgram> {
    const shaders = new Map<string, ShaderProgram>();

    shaders.set(`${rendererId}-main`, {
        vertex: FULLSCREEN_VERTEX,
        fragment: buildPathtracerFragment(plan),
    });

    shaders.set(`${rendererId}-display`, {
        vertex: FULLSCREEN_VERTEX,
        fragment: buildDisplayFragment(),
    });

    shaders.set(`${rendererId}-composite`, {
        vertex: FULLSCREEN_VERTEX,
        fragment: buildCompositeFragment(),
    });

    return shaders;
}

// ============================================================================
// Pathtracer Fragment Shader
// ============================================================================

function buildPathtracerFragment(plan: RenderPlan): string {
    const sections: string[] = [];

    // Header
    sections.push(`#version 300 es
precision highp float;
precision highp int;

out vec4 fragColor;
`);

    // Uniforms
    sections.push(buildUniformDeclarations(plan));

    // Library includes
    sections.push(structsGLSL);
    sections.push(rngGLSL);
    sections.push(mathGLSL);
    sections.push(euclideanGLSL);
    sections.push(sdfPrimitivesGLSL);

    // Generated scene SDF
    sections.push(generateSDFDispatch(plan.objects));

    // Raymarch infrastructure (depends on scene_sdf)
    sections.push(raymarchGLSL);

    // Generated material properties
    sections.push(generateMaterialLookup(plan.materials));

    // BRDF
    if (plan.brdfModels.has('lambert')) {
        sections.push(lambertGLSL);
    }

    // Generated light sampling (NEE)
    if (plan.emitNEE) {
        sections.push(generateLightSampling(plan.lights));
    }

    // Camera
    sections.push(generateCamera(plan));

    // Path trace loop
    sections.push(generatePathTraceLoop(plan));

    // Main function
    sections.push(generateMain(plan));

    return sections.join('\n');
}

// ============================================================================
// Uniform declarations
// ============================================================================

function buildUniformDeclarations(plan: RenderPlan): string {
    const lines: string[] = [];
    lines.push('// Uniforms');

    for (const u of plan.uniforms) {
        const glslType = u.type === 'sampler2D' ? 'sampler2D' : u.type;
        lines.push(`uniform ${glslType} ${u.name};`);
    }

    // Previous accumulation texture (always needed for progressive rendering)
    lines.push('uniform sampler2D u_previous;');

    return lines.join('\n');
}

// ============================================================================
// Generated SDF dispatch
// ============================================================================

function generateSDFDispatch(objects: PlannedSDFObject[]): string {
    const lines: string[] = [];
    lines.push('// Generated SDF dispatch');

    // Per-object wrapper functions
    for (const obj of objects) {
        lines.push(`float sdf_object_${obj.index}(vec3 p) {`);
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
// Generated material lookup
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

    for (const mat of materials) {
        lines.push(`    if (id == ${mat.id}) {`);

        if (typeof mat.albedo === 'string') {
            lines.push(`        props.albedo = ${mat.albedo};`);
        } else {
            lines.push(`        props.albedo = ${formatVec3(mat.albedo)};`);
        }

        if (typeof mat.emission === 'string') {
            lines.push(`        props.emission = ${mat.emission};`);
        } else {
            const em = mat.emission as number[];
            const hasEmission = em[0] > 0 || em[1] > 0 || em[2] > 0;
            if (hasEmission) {
                lines.push(`        props.emission = ${formatVec3(em)};`);
                lines.push(`        props.emission_strength = 1.0;`);
            }
        }

        if (typeof mat.roughness === 'string') {
            lines.push(`        props.roughness = ${mat.roughness};`);
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
// Generated light sampling
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

    // For single light, no selection needed
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
        // Multiple lights — uniform random selection
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
// Camera generation
// ============================================================================

function generateCamera(plan: RenderPlan): string {
    const cam = plan.features.strategy.camera;
    const lines: string[] = [];
    lines.push('// Generated camera');

    if (cam.type === 'pinhole') {
        const tanFov = formatFloat(Math.tan(cam.fov * 0.5));
        lines.push(`Ray camera_generateRay(vec2 pixel, vec2 xi) {`);
        lines.push(`    vec2 jittered_pixel = pixel + (xi - 0.5);`);
        lines.push(`    vec2 ndc = (2.0 * jittered_pixel / u_imageSize) - 1.0;`);
        lines.push(`    float aspect = u_imageSize.x / u_imageSize.y;`);
        lines.push(`    ndc.x *= aspect;`);
        lines.push('');
        lines.push(`    vec3 forward = normalize(u_cameraTarget - u_cameraPosition);`);
        lines.push(`    vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));`);
        lines.push(`    vec3 up = cross(right, forward);`);
        lines.push('');
        lines.push(`    float tan_fov = ${tanFov};`);
        lines.push(`    vec3 dir = normalize(forward + ndc.x * tan_fov * right + ndc.y * tan_fov * up);`);
        lines.push('');
        lines.push(`    Ray ray;`);
        lines.push(`    ray.origin = u_cameraPosition;`);
        lines.push(`    ray.direction = dir;`);
        lines.push(`    ray.tmin = 0.001;`);
        lines.push(`    ray.tmax = 1000.0;`);
        lines.push(`    return ray;`);
        lines.push(`}`);
    } else {
        throw new Error(`ShaderBuilder: camera type '${cam.type}' not yet supported`);
    }

    return lines.join('\n');
}

// ============================================================================
// Path trace loop
// ============================================================================

function generatePathTraceLoop(plan: RenderPlan): string {
    const lines: string[] = [];
    lines.push('// Generated path trace loop');
    lines.push(`Radiance transport_trace(Ray ray) {`);
    lines.push(`    vec3 throughput = vec3(1.0);`);
    lines.push(`    vec3 radiance = vec3(0.0);`);
    lines.push(`    Ray current_ray = ray;`);
    lines.push('');
    lines.push(`    for (int bounce = 0; bounce < ${plan.maxBounces}; bounce++) {`);
    lines.push(`        Hit hit;`);
    lines.push(`        if (!scene_intersect(current_ray, hit)) {`);
    // Sky gradient
    lines.push(`            float sky_t = 0.5 * (current_ray.direction.y + 1.0);`);
    lines.push(`            vec3 sky = mix(vec3(0.5, 0.6, 0.8), vec3(0.2, 0.3, 0.6), sky_t);`);
    lines.push(`            radiance += throughput * sky;`);
    lines.push(`            break;`);
    lines.push(`        }`);
    lines.push('');
    lines.push(`        hit.frame = ambient_frame(hit.p, hit.n);`);
    lines.push('');

    // Emission check
    lines.push(`        Spectrum emitted = interaction_surface_emit(hit);`);
    lines.push(`        radiance += throughput * emitted;`);
    lines.push('');

    // NEE (direct lighting)
    if (plan.emitNEE) {
        lines.push(`        // Next Event Estimation`);
        lines.push(`        LightSample ls = lighting_sample(hit.p);`);
        lines.push(`        if (ls.pdf > 0.0) {`);
        lines.push(`            Ray shadow_ray;`);
        lines.push(`            shadow_ray.origin = hit.p + hit.n * EPSILON;`);
        lines.push(`            shadow_ray.direction = ls.wi;`);
        lines.push(`            shadow_ray.tmin = EPSILON;`);
        lines.push(`            shadow_ray.tmax = ls.distance - EPSILON;`);
        lines.push(`            if (!scene_intersect_any(shadow_ray, ls.distance - EPSILON)) {`);
        lines.push(`                vec3 f = interaction_surface_shade(ls.wi, -current_ray.direction, hit);`);
        lines.push(`                radiance += throughput * ls.radiance * f / ls.pdf;`);
        lines.push(`            }`);
        lines.push(`        }`);
        lines.push('');
    }

    // Russian roulette
    if (plan.emitRussianRoulette) {
        lines.push(`        // Russian roulette`);
        lines.push(`        if (bounce >= ${plan.russianRouletteStartDepth}) {`);
        lines.push(`            float p_survive = min(0.95, luminance(throughput));`);
        lines.push(`            if (random() > p_survive) break;`);
        lines.push(`            throughput /= p_survive;`);
        lines.push(`        }`);
        lines.push('');
    }

    // BRDF sampling for next bounce
    lines.push(`        // BRDF sampling`);
    lines.push(`        float pdf;`);
    lines.push(`        Direction wi = interaction_surface_scatter(-current_ray.direction, hit, pdf);`);
    lines.push(`        if (pdf <= 0.0001) break;`);
    lines.push('');
    lines.push(`        Spectrum f = interaction_surface_shade(wi, -current_ray.direction, hit);`);
    lines.push(`        float cos_theta = max(0.0, ambient_dot(wi, hit.n, hit.p));`);
    lines.push(`        if (cos_theta <= 0.0001) break;`);
    lines.push(`        throughput *= f / pdf;`);
    lines.push('');
    lines.push(`        current_ray.origin = ambient_geodesic(hit.p, hit.n, EPSILON);`);
    lines.push(`        current_ray.direction = wi;`);
    lines.push(`        current_ray.tmin = EPSILON;`);
    lines.push(`        current_ray.tmax = 1000.0;`);
    lines.push(`    }`);
    lines.push('');
    lines.push(`    return radiance;`);
    lines.push(`}`);

    return lines.join('\n');
}

// ============================================================================
// Main function
// ============================================================================

function generateMain(plan: RenderPlan): string {
    const lines: string[] = [];
    lines.push('// Main');
    lines.push('void main() {');
    lines.push('    vec2 pixel = gl_FragCoord.xy + u_pixelOffset;');
    lines.push('    hash_init(uvec2(gl_FragCoord.xy), uint(u_frameIndex));');
    lines.push('');
    lines.push('    vec2 xi = random2();');
    lines.push('    Ray ray = camera_generateRay(pixel, xi);');
    lines.push('    vec3 color = transport_trace(ray);');
    lines.push('');

    // Accumulation
    if (plan.features.strategy.accumulation.type === 'average') {
        lines.push('    if (u_sampleCount == 0) {');
        lines.push('        fragColor = vec4(color, 1.0);');
        lines.push('    } else {');
        lines.push('        ivec2 coord = ivec2(gl_FragCoord.xy);');
        lines.push('        vec3 previous = texelFetch(u_previous, coord, 0).rgb;');
        lines.push('        float n = float(u_sampleCount);');
        lines.push('        float new_weight = 1.0 / (n + 1.0);');
        lines.push('        fragColor = vec4(mix(previous, color, new_weight), 1.0);');
        lines.push('    }');
    }

    lines.push('}');
    return lines.join('\n');
}

// ============================================================================
// Display and composite fragment shaders
// ============================================================================

function buildDisplayFragment(): string {
    return `#version 300 es
precision highp float;

out vec4 fragColor;

${tonemapReinhardGLSL}
`;
}

function buildCompositeFragment(): string {
    return `#version 300 es
precision highp float;

out vec4 fragColor;

${compositeGLSL}
`;
}

// ============================================================================
// GLSL formatting helpers
// ============================================================================

function formatFloat(v: number): string {
    const s = v.toString();
    return s.includes('.') ? s : s + '.0';
}

function formatVec3(v: number[]): string {
    return `vec3(${formatFloat(v[0])}, ${formatFloat(v[1])}, ${formatFloat(v[2])})`;
}
