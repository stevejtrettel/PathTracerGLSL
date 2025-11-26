// compiler/SimpleCompiler.ts

import type {
    ICompiler,
    SceneDescription,
    RenderStrategy,
    CompiledRenderer,
    ShaderProgram,
    RenderPipeline
} from './types.js';

import type { UniformBinding } from '../engine/types.js';

/**
 * SimpleCompiler - Hardcoded renderer generator for architecture validation
 *
 * This is a temporary compiler that produces valid CompiledRenderer objects
 * without actual code generation. It hardcodes GLSL for two strategies:
 * - 'debug': Simple visualization (UVs, solid colors)
 * - 'pathtracer': Basic accumulation renderer
 *
 * Purpose: Validate the Compiler→Engine architecture before building
 * the real code generation system.
 *
 * NOTE: This will be replaced with real Compiler in Phase 7.
 */
export class SimpleCompiler implements ICompiler {
    /**
     * Compile scene + strategy into executable renderer
     */
    compile(scene: SceneDescription, strategy: RenderStrategy): CompiledRenderer {
        // Route to appropriate generator based on strategy
        switch (strategy.id) {
            case 'debug':
                return this._generateDebugRenderer(scene, strategy);

            case 'pathtracer':
                return this._generatePathtracerRenderer(scene, strategy);

            case 'pathtracer-aovs':
                return this._generatePathtracerAOVsRenderer(scene, strategy);

            case 'pathtracer-full':
                return this._generatePathtracerFullRenderer(scene, strategy);

            case 'debug-aovs':
                return this._generateDebugAOVsRenderer(scene, strategy);

            default:
                throw new Error(`Unknown strategy: ${strategy.id}`);
        }
    }

    /**
     * Generate debug renderer
     *
     * Two-pass renderer that visualizes UVs or outputs solid color.
     * Uses RGB buffer for reliable LDR export.
     *
     * Pipeline:
     * 1. Debug pass: render to RGB buffer
     * 2. Composite pass: copy RGB to screen
     */
    private _generateDebugRenderer(
        scene: SceneDescription,
        strategy: RenderStrategy
    ): CompiledRenderer {
        // Create shaders map
        const shaders = new Map<string, ShaderProgram>();

        // Debug shader: simple UV visualization
        shaders.set('debug', {
            vertex: this._getFullscreenVertex(),
            fragment: `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;

void main() {
    vec2 v_uv = gl_FragCoord.xy / u_resolution;
    // Visualize based on debug output setting
    ${this._getDebugVisualization(strategy)}
}
`
        });

        // Composite shader: copy RGB buffer to screen
        shaders.set('debug-composite', {
            vertex: this._getFullscreenVertex(),
            fragment: this._getCompositeFragment()
        });

        // Pipeline: debug → rgb, composite → screen
        const pipeline: RenderPipeline = {
            framebuffers: [
                {
                    id: 'rgb',
                    type: 'texture',
                    format: 'rgba8'
                },
                {
                    id: 'screen',
                    type: 'screen'
                }
            ],
            passes: [
                {
                    id: 'debug-pass',
                    shader: 'debug',
                    output: 'rgb',
                    execution: {
                        type: 'once',
                        clearBeforeRender: true
                    }
                },
                {
                    id: 'composite-pass',
                    shader: 'debug-composite',
                    inputs: {
                        textures: {
                            'u_rgb': 'rgb'
                        }
                    },
                    output: 'screen',
                    execution: {
                        type: 'once',
                        clearBeforeRender: false
                    }
                }
            ]
        };

        // Minimal uniforms (just for testing parameter system)
        const uniforms: UniformBinding[] = [
            {
                uniform: 'u_resolution',
                parameters: ['engine.resolution'],
                type: 'vec2',
                compute: (params) => params['engine.resolution']
            },
            {
                uniform: 'u_time',
                parameters: ['engine.time'],
                type: 'float',
                compute: (params) => params['engine.time']
            }
        ];

        return {
            id: 'debug',
            shaders,
            pipeline,
            uniforms,
            sourceMaps: new Map(),
            exportTargets: {
                'ldr': {
                    bufferId: 'rgb',
                    format: 'byte'
                }
            }
        };
    }

    /**
     * Get debug visualization GLSL code based on strategy settings
     */
    private _getDebugVisualization(strategy: RenderStrategy): string {
        const debugOutput = strategy.settings?.debugOutput || 'uv';

        switch (debugOutput) {
            case 'uv':
                return `fragColor = vec4(v_uv, 0.5, 1.0);`;

            case 'depth':
                return `
                    float depth = length(v_uv - 0.5);
                    fragColor = vec4(vec3(depth), 1.0);
                `;

            case 'normal':
                return `
                    vec3 normal = normalize(vec3(v_uv - 0.5, 0.5));
                    fragColor = vec4(normal * 0.5 + 0.5, 1.0);
                `;

            default:
                // Solid color with time-based pulse
                return `
                    float pulse = sin(u_time) * 0.5 + 0.5;
                    fragColor = vec4(0.2, 0.6 * pulse, 0.8, 1.0);
                `;
        }
    }

    /**
     * Generate pathtracer renderer
     *
     * Three-pass accumulation renderer:
     * 1. Main pass: raytrace and accumulate into HDR buffer
     * 2. Display pass: tone map to RGB buffer
     * 3. Composite pass: copy RGB to screen
     *
     * Uses ping-pong buffers for progressive accumulation.
     * RGB buffer enables reliable LDR export.
     */
    private _generatePathtracerRenderer(
        scene: SceneDescription,
        _strategy: RenderStrategy
    ): CompiledRenderer {
        const shaders = new Map<string, ShaderProgram>();

        // Main pathtracer shader (accumulation pass)
        shaders.set('pathtracer-main', {
            vertex: this._getFullscreenVertex(),
            fragment: this._getPathtracerMainFragment()
        });

        // Display shader (tone mapping pass)
        shaders.set('pathtracer-display', {
            vertex: this._getFullscreenVertex(),
            fragment: this._getDisplayFragment()
        });

        // Composite shader (copy to screen)
        shaders.set('pathtracer-composite', {
            vertex: this._getFullscreenVertex(),
            fragment: this._getCompositeFragment()
        });

        // Pipeline: three passes with ping-pong accumulation
        const pipeline: RenderPipeline = {
            framebuffers: [
                {
                    id: 'accumulation',
                    type: 'double_buffer',
                    format: 'rgba32f'
                },
                {
                    id: 'rgb',
                    type: 'texture',
                    format: 'rgba8'
                },
                {
                    id: 'screen',
                    type: 'screen'
                }
            ],
            passes: [
                {
                    id: 'main-pass',
                    shader: 'pathtracer-main',
                    inputs: {
                        textures: {
                            'u_previous': 'accumulation_previous'
                        }
                    },
                    output: 'accumulation_current',
                    execution: {
                        type: 'once',
                        clearBeforeRender: false
                    }
                },
                {
                    id: 'display-pass',
                    shader: 'pathtracer-display',
                    inputs: {
                        textures: {
                            'u_radiance': 'accumulation_current'
                        }
                    },
                    output: 'rgb',
                    execution: {
                        type: 'once',
                        clearBeforeRender: false
                    }
                },
                {
                    id: 'composite-pass',
                    shader: 'pathtracer-composite',
                    inputs: {
                        textures: {
                            'u_rgb': 'rgb'
                        }
                    },
                    output: 'screen',
                    execution: {
                        type: 'once',
                        clearBeforeRender: false
                    }
                }
            ],
            postFrame: {
                swaps: [
                    {
                        type: 'swap',
                        buffers: ['accumulation']
                    }
                ]
            }
        };

        // Uniforms for pathtracer (camelCase: u_variableName convention)
        const uniforms: UniformBinding[] = [
            {
                uniform: 'u_resolution',
                parameters: ['engine.resolution'],
                type: 'vec2',
                compute: (params) => params['engine.resolution']
            },
            {
                uniform: 'u_sampleCount',
                parameters: ['engine.sampleCount'],
                type: 'int',
                compute: (params) => params['engine.sampleCount']
            },
            {
                uniform: 'u_frameIndex',
                parameters: ['engine.frameIndex'],
                type: 'int',
                compute: (params) => params['engine.frameIndex']
            },
            {
                uniform: 'u_time',
                parameters: ['engine.time'],
                type: 'float',
                compute: (params) => params['engine.time']
            },
            // Camera uniforms - connected to parameter panel
            {
                uniform: 'u_cameraPosition',
                parameters: ['camera.position'],
                type: 'vec3',
                compute: (params) => params['camera.position'] || [0.0, 0.0, 8.0]
            },
            {
                uniform: 'u_cameraTarget',
                parameters: ['camera.target'],
                type: 'vec3',
                compute: (params) => params['camera.target'] || [0.0, 0.0, 0.0]
            },
            // Scene parameters
            {
                uniform: 'u_sphere1Center',
                parameters: ['scene.sphere1.center'],
                type: 'vec3',
                compute: (params) => params['scene.sphere1.center'] || [-1.5, -0.5, -1.0]
            },
            {
                uniform: 'u_sphere1Radius',
                parameters: ['scene.sphere1.radius'],
                type: 'float',
                compute: (params) => params['scene.sphere1.radius'] ?? 1.5
            },
            {
                uniform: 'u_sphere2Radius',
                parameters: ['scene.sphere2.radius'],
                type: 'float',
                compute: (params) => params['scene.sphere2.radius'] ?? 1.0
            },
            {
                uniform: 'u_lightRadius',
                parameters: ['scene.light.radius'],
                type: 'float',
                compute: (params) => params['scene.light.radius'] ?? 1.0
            },
            {
                uniform: 'u_lightIntensity',
                parameters: ['scene.light.intensity'],
                type: 'float',
                compute: (params) => params['scene.light.intensity'] ?? 15.0
            }
        ];

        return {
            id: 'oneshot',
            shaders,
            pipeline,
            uniforms,
            sourceMaps: new Map(),
            // Test parameter metadata for ParameterPanelExtension
            parameters: {
                'camera.position': {
                    type: 'vec3',
                    default: [0, 0, 8],
                    name: 'Camera Position',
                    group: 'Camera',
                    triggersReset: true
                },
                'camera.target': {
                    type: 'vec3',
                    default: [0, 0, 0],
                    name: 'Camera Target',
                    group: 'Camera',
                    triggersReset: true
                },
                'scene.sphere1.center': {
                    type: 'vec3',
                    default: [-1.5, -0.5, -1.0],
                    name: 'Sphere 1 Center',
                    group: 'Scene',
                    triggersReset: true
                },
                'scene.sphere1.radius': {
                    type: 'float',
                    default: 1.5,
                    range: [0.1, 3.0],
                    step: 0.1,
                    name: 'Sphere 1 Radius',
                    group: 'Scene',
                    triggersReset: true
                },
                'scene.sphere2.radius': {
                    type: 'float',
                    default: 1.0,
                    range: [0.1, 2.0],
                    step: 0.1,
                    name: 'Sphere 2 Radius',
                    group: 'Scene',
                    triggersReset: true
                },
                'scene.light.radius': {
                    type: 'float',
                    default: 1.0,
                    range: [0.2, 3.0],
                    step: 0.1,
                    name: 'Light Size',
                    group: 'Light',
                    triggersReset: true
                },
                'scene.light.intensity': {
                    type: 'float',
                    default: 15.0,
                    range: [1.0, 50.0],
                    step: 1.0,
                    name: 'Light Intensity',
                    group: 'Light',
                    triggersReset: true
                },
                'render.exposure': {
                    type: 'float',
                    default: 1.0,
                    range: [0.1, 5.0],
                    step: 0.1,
                    name: 'Exposure',
                    group: 'Render',
                    triggersReset: false
                }
            },
            exportTargets: {
                'hdr': {
                    bufferId: 'accumulation_current',
                    format: 'float'
                },
                'ldr': {
                    bufferId: 'rgb',
                    format: 'byte'
                }
            }
        };
    }

    /**
     * Get fullscreen triangle vertex shader (uses gl_VertexID trick)
     * No VAO needed - generates fullscreen triangle from vertex ID
     */
    private _getFullscreenVertex(): string {
        return `#version 300 es
void main() {
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    gl_Position = vec4(x, y, 0.0, 1.0);
}`;
    }

    /**
     * Get pathtracer main fragment shader
     * Single-bounce direct lighting with Cornell box scene
     */
    private _getPathtracerMainFragment(): string {
        return `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform vec2 u_imageSize;
uniform vec2 u_pixelOffset;
uniform int u_sampleCount;
uniform int u_frameIndex;
uniform float u_time;
uniform sampler2D u_previous;

uniform vec3 u_cameraPosition;
uniform vec3 u_cameraTarget;

// Scene parameters
uniform vec3 u_sphere1Center;
uniform float u_sphere1Radius;
uniform float u_sphere2Radius;
uniform float u_lightRadius;
uniform float u_lightIntensity;

#define PI 3.14159265359
#define EPSILON 0.001

// ============ RNG SYSTEM ============
uint rng_seed;
uint rng_counter;

uint mix32(uint z) {
    z ^= z >> 16;
    z *= 0x7feb352dU;
    z ^= z >> 15;
    z *= 0x846ca68bU;
    z ^= z >> 16;
    return z;
}

uint hash_init(uvec2 pixel, uint frame) {
    uint h = 2166136261U;
    h = (h ^ pixel.x) * 16777619U;
    h = (h ^ pixel.y) * 16777619U;
    h = (h ^ frame) * 16777619U;
    return mix32(h | 1U);
}

uint rng_u32() {
    uint x = rng_seed + rng_counter * 0x9E3779B9U;
    rng_counter++;
    return mix32(x);
}

float random() {
    return float(rng_u32()) * (1.0 / 4294967296.0);
}

vec2 random2() {
    return vec2(random(), random());
}

// ============ CORNELL BOX SCENE ============
#define MAT_FLOOR 1
#define MAT_LEFT_WALL 2
#define MAT_RIGHT_WALL 3
#define MAT_BACK_WALL 4
#define MAT_CEILING 5
#define MAT_SPHERE_DIFFUSE 6
#define MAT_SPHERE_LIGHT 7
#define MAT_SPHERE_METAL 8

struct Ray {
    vec3 origin;
    vec3 direction;
    float tmin;
    float tmax;
};

struct Hit {
    vec3 p;
    vec3 n;
    float t;
    int material;
};

float sdf_sphere(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

float sdf_plane(vec3 p, vec3 normal, float offset) {
    return dot(p, normal) + offset;
}

float scene_sdf(vec3 p, out int material) {
    float min_dist = 1e10;
    material = 0;

    float floor_d = sdf_plane(p, vec3(0.0, 1.0, 0.0), 2.0);
    if (floor_d < min_dist) { min_dist = floor_d; material = MAT_FLOOR; }

    float left_d = sdf_plane(p, vec3(1.0, 0.0, 0.0), 4.0);
    if (left_d < min_dist) { min_dist = left_d; material = MAT_LEFT_WALL; }

    float right_d = sdf_plane(p, vec3(-1.0, 0.0, 0.0), 4.0);
    if (right_d < min_dist) { min_dist = right_d; material = MAT_RIGHT_WALL; }

    float back_d = sdf_plane(p, vec3(0.0, 0.0, 1.0), 4.0);
    if (back_d < min_dist) { min_dist = back_d; material = MAT_BACK_WALL; }

    float ceil_d = sdf_plane(p, vec3(0.0, -1.0, 0.0), 4.0);
    if (ceil_d < min_dist) { min_dist = ceil_d; material = MAT_CEILING; }

    // Sphere 1 (diffuse) - position and radius from uniforms
    float sphere1 = sdf_sphere(p, u_sphere1Center, u_sphere1Radius);
    if (sphere1 < min_dist) { min_dist = sphere1; material = MAT_SPHERE_DIFFUSE; }

    // Sphere 2 (metal) - fixed position, radius from uniform
    float sphere2 = sdf_sphere(p, vec3(1.8, -1.0, 0.5), u_sphere2Radius);
    if (sphere2 < min_dist) { min_dist = sphere2; material = MAT_SPHERE_METAL; }

    // Light sphere - radius from uniform
    float light = sdf_sphere(p, vec3(0.0, 3.0, 0.0), u_lightRadius);
    if (light < min_dist) { min_dist = light; material = MAT_SPHERE_LIGHT; }

    return min_dist;
}

vec3 scene_normal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    int dummy;
    return normalize(vec3(
        scene_sdf(p + e.xyy, dummy) - scene_sdf(p - e.xyy, dummy),
        scene_sdf(p + e.yxy, dummy) - scene_sdf(p - e.yxy, dummy),
        scene_sdf(p + e.yyx, dummy) - scene_sdf(p - e.yyx, dummy)
    ));
}

bool scene_intersect(Ray ray, out Hit hit) {
    float t = ray.tmin;
    int material;

    for (int i = 0; i < 128; i++) {
        vec3 p = ray.origin + ray.direction * t;
        float d = scene_sdf(p, material);

        if (d < EPSILON) {
            hit.p = p;
            hit.t = t;
            hit.n = scene_normal(p);
            hit.material = material;
            return true;
        }

        if (t > ray.tmax) break;
        t += d;
    }

    return false;
}

// ============ MATERIALS ============
vec3 get_albedo(int mat) {
    if (mat == MAT_FLOOR) return vec3(0.73);
    if (mat == MAT_LEFT_WALL) return vec3(0.63, 0.065, 0.05);
    if (mat == MAT_RIGHT_WALL) return vec3(0.14, 0.45, 0.091);
    if (mat == MAT_BACK_WALL) return vec3(0.73);
    if (mat == MAT_CEILING) return vec3(0.73);
    if (mat == MAT_SPHERE_DIFFUSE) return vec3(0.9);
    if (mat == MAT_SPHERE_METAL) return vec3(0.95, 0.64, 0.54);
    if (mat == MAT_SPHERE_LIGHT) return vec3(1.0);
    return vec3(0.0);
}

vec3 get_emission(int mat) {
    if (mat == MAT_SPHERE_LIGHT) return vec3(u_lightIntensity);
    return vec3(0.0);
}

// ============ CAMERA ============
Ray generate_camera_ray(vec2 uv, vec2 jitter, vec2 imageSize) {
    vec2 ndc = (uv + jitter / imageSize) * 2.0 - 1.0;
    ndc.x *= imageSize.x / imageSize.y;

    vec3 origin = length(u_cameraPosition) > 0.0 ? u_cameraPosition : vec3(0.0, 0.0, 8.0);
    vec3 lookAt = u_cameraTarget;
    vec3 up = vec3(0.0, 1.0, 0.0);

    vec3 forward = normalize(lookAt - origin);
    vec3 right = normalize(cross(forward, up));
    vec3 camUp = cross(right, forward);

    float fov = 0.8;
    vec3 direction = normalize(forward + ndc.x * right * fov + ndc.y * camUp * fov);

    Ray ray;
    ray.origin = origin;
    ray.direction = direction;
    ray.tmin = EPSILON;
    ray.tmax = 100.0;
    return ray;
}

// ============ DIRECT LIGHTING ============
vec3 shade_direct(Hit hit) {
    vec3 emission = get_emission(hit.material);
    if (length(emission) > 0.0) return emission;

    vec3 albedo = get_albedo(hit.material);

    // Direct light from the emissive sphere (using uniforms)
    vec3 light_pos = vec3(0.0, 3.0, 0.0);
    float light_radius = u_lightRadius;
    vec3 light_emission = vec3(u_lightIntensity);

    // Sample point on light (simplified - just use center)
    vec3 to_light = light_pos - hit.p;
    float dist = length(to_light);
    vec3 L = to_light / dist;

    // Check visibility
    Ray shadow_ray;
    shadow_ray.origin = hit.p + hit.n * EPSILON;
    shadow_ray.direction = L;
    shadow_ray.tmin = EPSILON;
    shadow_ray.tmax = dist - light_radius - EPSILON;

    Hit shadow_hit;
    // Check if something blocks the light (but ignore hitting the light itself)
    bool in_shadow = scene_intersect(shadow_ray, shadow_hit) && shadow_hit.material != MAT_SPHERE_LIGHT;

    vec3 direct = vec3(0.0);
    if (!in_shadow) {
        float ndotl = max(0.0, dot(hit.n, L));
        // Approximate solid angle of sphere light
        float solid_angle = (light_radius * light_radius * PI) / (dist * dist);
        direct = albedo * light_emission * ndotl * solid_angle / PI;
    }

    // Add ambient
    vec3 ambient = albedo * vec3(0.05);

    return direct + ambient;
}

void main() {
    vec2 imageSize = u_imageSize.x > 0.0 ? u_imageSize : u_resolution;
    vec2 uv = (gl_FragCoord.xy + u_pixelOffset) / imageSize;

    uvec2 pixel = uvec2(gl_FragCoord.xy + u_pixelOffset);
    rng_seed = hash_init(pixel, uint(u_frameIndex));
    rng_counter = 0U;

    vec2 jitter = random2() - 0.5;
    Ray ray = generate_camera_ray(uv, jitter, imageSize);

    Hit hit;
    vec3 color = vec3(0.0);

    if (scene_intersect(ray, hit)) {
        color = shade_direct(hit);
    } else {
        // Sky
        vec3 sky = mix(vec3(0.1), vec3(0.3, 0.4, 0.6), ray.direction.y * 0.5 + 0.5);
        color = sky * 0.5;
    }

    // Accumulate
    vec2 localUV = gl_FragCoord.xy / u_resolution;
    vec3 prev = texture(u_previous, localUV).rgb;
    float blend = 1.0 / float(u_sampleCount + 1);
    vec3 accumulated = mix(prev, color, blend);

    fragColor = vec4(accumulated, 1.0);
}`;
    }

    /**
     * Get display fragment shader (tone mapping)
     */
    private _getDisplayFragment(): string {
        return `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform sampler2D u_radiance;

// Gamma correction
vec3 gamma_correct(vec3 linear) {
    return pow(clamp(linear, 0.0, 1.0), vec3(1.0 / 2.2));
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec3 radiance = texture(u_radiance, uv).rgb;
    vec3 color = gamma_correct(radiance);
    fragColor = vec4(color, 1.0);
}`;
    }

    /**
     * Get composite fragment shader (copy RGB buffer to screen)
     *
     * This pass exists so we have a readable LDR buffer for screenshots/export.
     * Reading from screen (default framebuffer) is unreliable in WebGL.
     */
    private _getCompositeFragment(): string {
        return `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform sampler2D u_rgb;

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    fragColor = texture(u_rgb, uv);
}`;
    }

    /**
     * Generate pathtracer renderer with AOVs (MRT example)
     *
     * Four-pass MRT accumulation renderer:
     * 1. Main pass: raytrace and write to 3 attachments (radiance, albedo, normal)
     * 2. Display pass: tone map selected AOV to RGB buffer
     * 3. Composite pass: copy RGB to screen
     *
     * Demonstrates Multiple Render Targets (MRT) for outputting AOVs.
     * RGB buffer enables reliable LDR export.
     */
    private _generatePathtracerAOVsRenderer(
        scene: SceneDescription,
        _strategy: RenderStrategy
    ): CompiledRenderer {
        const shaders = new Map<string, ShaderProgram>();

        // MRT pathtracer shader (writes to 3 attachments)
        shaders.set('pathtracer-mrt-main', {
            vertex: this._getFullscreenVertex(),
            fragment: this._getPathtracerMRTFragment()
        });

        // Display shader with AOV visualization support
        // NOTE: Use unique shader ID to avoid collision with regular pathtracer
        shaders.set('pathtracer-aovs-display', {
            vertex: this._getFullscreenVertex(),
            fragment: this._getAOVDisplayFragment()
        });

        // Composite shader (copy to screen)
        shaders.set('pathtracer-aovs-composite', {
            vertex: this._getFullscreenVertex(),
            fragment: this._getCompositeFragment()
        });

        // Pipeline: MRT accumulation with 3 attachments + RGB buffer
        const pipeline: RenderPipeline = {
            framebuffers: [
                {
                    id: 'accumulation',
                    type: 'double_buffer',
                    format: ['rgba32f', 'rgba8', 'rgba16f']  // radiance, albedo, normal
                },
                {
                    id: 'rgb',
                    type: 'texture',
                    format: 'rgba8'
                },
                {
                    id: 'screen',
                    type: 'screen'
                }
            ],
            passes: [
                {
                    id: 'main-pass',
                    shader: 'pathtracer-mrt-main',
                    inputs: {
                        textures: {
                            'u_previous': 'accumulation_previous:0'  // Read radiance from attachment 0
                        }
                    },
                    output: [
                        'accumulation_current:0',  // Write radiance
                        'accumulation_current:1',  // Write albedo
                        'accumulation_current:2'   // Write normal
                    ],
                    execution: {
                        type: 'once',
                        clearBeforeRender: false
                    }
                },
                {
                    id: 'display-pass',
                    shader: 'pathtracer-aovs-display',
                    inputs: {
                        textures: {
                            'u_radiance': 'accumulation_current:0',
                            'u_albedo': 'accumulation_current:1',
                            'u_normal': 'accumulation_current:2'
                        }
                    },
                    output: 'rgb',
                    execution: {
                        type: 'once',
                        clearBeforeRender: false
                    }
                },
                {
                    id: 'composite-pass',
                    shader: 'pathtracer-aovs-composite',
                    inputs: {
                        textures: {
                            'u_rgb': 'rgb'
                        }
                    },
                    output: 'screen',
                    execution: {
                        type: 'once',
                        clearBeforeRender: false
                    }
                }
            ],
            postFrame: {
                swaps: [
                    {
                        type: 'swap',
                        buffers: ['accumulation']
                    }
                ]
            }
        };

        // Uniforms (including display mode for AOV visualization)
        const uniforms: UniformBinding[] = [
            {
                uniform: 'u_resolution',
                parameters: ['engine.resolution'],
                type: 'vec2',
                compute: (params) => params['engine.resolution']
            },
            {
                uniform: 'u_sampleCount',
                parameters: ['engine.sampleCount'],
                type: 'int',
                compute: (params) => params['engine.sampleCount']
            },
            {
                uniform: 'u_frameIndex',
                parameters: ['engine.frameIndex'],
                type: 'int',
                compute: (params) => params['engine.frameIndex']
            },
            {
                uniform: 'u_time',
                parameters: ['engine.time'],
                type: 'float',
                compute: (params) => params['engine.time']
            },
            {
                uniform: 'u_displayMode',
                parameters: ['renderer.displayMode'],
                type: 'int',
                compute: (params) => params['renderer.displayMode'] || 0
            },
            // Camera uniforms - connected to parameter panel
            {
                uniform: 'u_cameraPosition',
                parameters: ['camera.position'],
                type: 'vec3',
                compute: (params) => params['camera.position'] || [0.0, 0.0, 8.0]
            },
            {
                uniform: 'u_cameraTarget',
                parameters: ['camera.target'],
                type: 'vec3',
                compute: (params) => params['camera.target'] || [0.0, 0.0, 0.0]
            },
            // Scene parameters
            {
                uniform: 'u_sphere1Center',
                parameters: ['scene.sphere1.center'],
                type: 'vec3',
                compute: (params) => params['scene.sphere1.center'] || [-1.5, -0.5, -1.0]
            },
            {
                uniform: 'u_sphere1Radius',
                parameters: ['scene.sphere1.radius'],
                type: 'float',
                compute: (params) => params['scene.sphere1.radius'] ?? 1.5
            },
            {
                uniform: 'u_sphere2Radius',
                parameters: ['scene.sphere2.radius'],
                type: 'float',
                compute: (params) => params['scene.sphere2.radius'] ?? 1.0
            },
            {
                uniform: 'u_lightRadius',
                parameters: ['scene.light.radius'],
                type: 'float',
                compute: (params) => params['scene.light.radius'] ?? 1.0
            },
            {
                uniform: 'u_lightIntensity',
                parameters: ['scene.light.intensity'],
                type: 'float',
                compute: (params) => params['scene.light.intensity'] ?? 15.0
            }
        ];

        return {
            id: 'oneshot-aovs',
            shaders,
            pipeline,
            uniforms,
            sourceMaps: new Map(),
            exportTargets: {
                'hdr': {
                    bufferId: 'accumulation_current',
                    format: 'float',
                    attachment: 0
                },
                'albedo': {
                    bufferId: 'accumulation_current',
                    format: 'byte',
                    attachment: 1
                },
                'normal': {
                    bufferId: 'accumulation_current',
                    format: 'float',
                    attachment: 2
                },
                'ldr': {
                    bufferId: 'rgb',
                    format: 'byte'
                }
            }
        };
    }

    /**
     * Get MRT pathtracer fragment shader
     * Outputs to 3 attachments: radiance, albedo, normal
     * Uses Cornell box scene with direct lighting
     */
    private _getPathtracerMRTFragment(): string {
        return `#version 300 es
precision highp float;

// MRT outputs
layout(location = 0) out vec4 o_radiance;
layout(location = 1) out vec4 o_albedo;
layout(location = 2) out vec4 o_normal;

uniform vec2 u_resolution;
uniform vec2 u_imageSize;
uniform vec2 u_pixelOffset;
uniform int u_sampleCount;
uniform int u_frameIndex;
uniform float u_time;
uniform sampler2D u_previous;

uniform vec3 u_cameraPosition;
uniform vec3 u_cameraTarget;

// Scene parameters
uniform vec3 u_sphere1Center;
uniform float u_sphere1Radius;
uniform float u_sphere2Radius;
uniform float u_lightRadius;
uniform float u_lightIntensity;

#define PI 3.14159265359
#define EPSILON 0.001

// ============ RNG SYSTEM ============
uint rng_seed;
uint rng_counter;

uint mix32(uint z) {
    z ^= z >> 16;
    z *= 0x7feb352dU;
    z ^= z >> 15;
    z *= 0x846ca68bU;
    z ^= z >> 16;
    return z;
}

uint hash_init(uvec2 pixel, uint frame) {
    uint h = 2166136261U;
    h = (h ^ pixel.x) * 16777619U;
    h = (h ^ pixel.y) * 16777619U;
    h = (h ^ frame) * 16777619U;
    return mix32(h | 1U);
}

uint rng_u32() {
    uint x = rng_seed + rng_counter * 0x9E3779B9U;
    rng_counter++;
    return mix32(x);
}

float random() {
    return float(rng_u32()) * (1.0 / 4294967296.0);
}

vec2 random2() {
    return vec2(random(), random());
}

// ============ CORNELL BOX SCENE ============
#define MAT_FLOOR 1
#define MAT_LEFT_WALL 2
#define MAT_RIGHT_WALL 3
#define MAT_BACK_WALL 4
#define MAT_CEILING 5
#define MAT_SPHERE_DIFFUSE 6
#define MAT_SPHERE_LIGHT 7
#define MAT_SPHERE_METAL 8

struct Ray {
    vec3 origin;
    vec3 direction;
    float tmin;
    float tmax;
};

struct Hit {
    vec3 p;
    vec3 n;
    float t;
    int material;
};

float sdf_sphere(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

float sdf_plane(vec3 p, vec3 normal, float offset) {
    return dot(p, normal) + offset;
}

float scene_sdf(vec3 p, out int material) {
    float min_dist = 1e10;
    material = 0;

    float floor_d = sdf_plane(p, vec3(0.0, 1.0, 0.0), 2.0);
    if (floor_d < min_dist) { min_dist = floor_d; material = MAT_FLOOR; }

    float left_d = sdf_plane(p, vec3(1.0, 0.0, 0.0), 4.0);
    if (left_d < min_dist) { min_dist = left_d; material = MAT_LEFT_WALL; }

    float right_d = sdf_plane(p, vec3(-1.0, 0.0, 0.0), 4.0);
    if (right_d < min_dist) { min_dist = right_d; material = MAT_RIGHT_WALL; }

    float back_d = sdf_plane(p, vec3(0.0, 0.0, 1.0), 4.0);
    if (back_d < min_dist) { min_dist = back_d; material = MAT_BACK_WALL; }

    float ceil_d = sdf_plane(p, vec3(0.0, -1.0, 0.0), 4.0);
    if (ceil_d < min_dist) { min_dist = ceil_d; material = MAT_CEILING; }

    // Sphere 1 (diffuse) - position and radius from uniforms
    float sphere1 = sdf_sphere(p, u_sphere1Center, u_sphere1Radius);
    if (sphere1 < min_dist) { min_dist = sphere1; material = MAT_SPHERE_DIFFUSE; }

    // Sphere 2 (metal) - fixed position, radius from uniform
    float sphere2 = sdf_sphere(p, vec3(1.8, -1.0, 0.5), u_sphere2Radius);
    if (sphere2 < min_dist) { min_dist = sphere2; material = MAT_SPHERE_METAL; }

    // Light sphere - radius from uniform
    float light = sdf_sphere(p, vec3(0.0, 3.0, 0.0), u_lightRadius);
    if (light < min_dist) { min_dist = light; material = MAT_SPHERE_LIGHT; }

    return min_dist;
}

vec3 scene_normal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    int dummy;
    return normalize(vec3(
        scene_sdf(p + e.xyy, dummy) - scene_sdf(p - e.xyy, dummy),
        scene_sdf(p + e.yxy, dummy) - scene_sdf(p - e.yxy, dummy),
        scene_sdf(p + e.yyx, dummy) - scene_sdf(p - e.yyx, dummy)
    ));
}

bool scene_intersect(Ray ray, out Hit hit) {
    float t = ray.tmin;
    int material;

    for (int i = 0; i < 128; i++) {
        vec3 p = ray.origin + ray.direction * t;
        float d = scene_sdf(p, material);

        if (d < EPSILON) {
            hit.p = p;
            hit.t = t;
            hit.n = scene_normal(p);
            hit.material = material;
            return true;
        }

        if (t > ray.tmax) break;
        t += d;
    }

    return false;
}

// ============ MATERIALS ============
vec3 get_albedo(int mat) {
    if (mat == MAT_FLOOR) return vec3(0.73);
    if (mat == MAT_LEFT_WALL) return vec3(0.63, 0.065, 0.05);
    if (mat == MAT_RIGHT_WALL) return vec3(0.14, 0.45, 0.091);
    if (mat == MAT_BACK_WALL) return vec3(0.73);
    if (mat == MAT_CEILING) return vec3(0.73);
    if (mat == MAT_SPHERE_DIFFUSE) return vec3(0.9);
    if (mat == MAT_SPHERE_METAL) return vec3(0.95, 0.64, 0.54);
    if (mat == MAT_SPHERE_LIGHT) return vec3(1.0);
    return vec3(0.0);
}

vec3 get_emission(int mat) {
    if (mat == MAT_SPHERE_LIGHT) return vec3(u_lightIntensity);
    return vec3(0.0);
}

// ============ CAMERA ============
Ray generate_camera_ray(vec2 uv, vec2 jitter, vec2 imageSize) {
    vec2 ndc = (uv + jitter / imageSize) * 2.0 - 1.0;
    ndc.x *= imageSize.x / imageSize.y;

    vec3 origin = length(u_cameraPosition) > 0.0 ? u_cameraPosition : vec3(0.0, 0.0, 8.0);
    vec3 lookAt = u_cameraTarget;
    vec3 up = vec3(0.0, 1.0, 0.0);

    vec3 forward = normalize(lookAt - origin);
    vec3 right = normalize(cross(forward, up));
    vec3 camUp = cross(right, forward);

    float fov = 0.8;
    vec3 direction = normalize(forward + ndc.x * right * fov + ndc.y * camUp * fov);

    Ray ray;
    ray.origin = origin;
    ray.direction = direction;
    ray.tmin = EPSILON;
    ray.tmax = 100.0;
    return ray;
}

// ============ DIRECT LIGHTING ============
vec3 shade_direct(Hit hit) {
    vec3 emission = get_emission(hit.material);
    if (length(emission) > 0.0) return emission;

    vec3 albedo = get_albedo(hit.material);
    vec3 light_pos = vec3(0.0, 3.0, 0.0);
    float light_radius = u_lightRadius;
    vec3 light_emission = vec3(u_lightIntensity);

    vec3 to_light = light_pos - hit.p;
    float dist = length(to_light);
    vec3 L = to_light / dist;

    Ray shadow_ray;
    shadow_ray.origin = hit.p + hit.n * EPSILON;
    shadow_ray.direction = L;
    shadow_ray.tmin = EPSILON;
    shadow_ray.tmax = dist - light_radius - EPSILON;

    Hit shadow_hit;
    // Check if something blocks the light (but ignore hitting the light itself)
    bool in_shadow = scene_intersect(shadow_ray, shadow_hit) && shadow_hit.material != MAT_SPHERE_LIGHT;

    vec3 direct = vec3(0.0);
    if (!in_shadow) {
        float ndotl = max(0.0, dot(hit.n, L));
        float solid_angle = (light_radius * light_radius * PI) / (dist * dist);
        direct = albedo * light_emission * ndotl * solid_angle / PI;
    }

    return direct + albedo * vec3(0.05);
}

void main() {
    vec2 imageSize = u_imageSize.x > 0.0 ? u_imageSize : u_resolution;
    vec2 uv = (gl_FragCoord.xy + u_pixelOffset) / imageSize;

    uvec2 pixel = uvec2(gl_FragCoord.xy + u_pixelOffset);
    rng_seed = hash_init(pixel, uint(u_frameIndex));
    rng_counter = 0U;

    vec2 jitter = random2() - 0.5;
    Ray ray = generate_camera_ray(uv, jitter, imageSize);

    Hit hit;
    vec3 radiance = vec3(0.0);
    vec3 first_hit_albedo = vec3(0.0);
    vec3 first_hit_normal = vec3(0.5);

    if (scene_intersect(ray, hit)) {
        radiance = shade_direct(hit);
        first_hit_albedo = get_albedo(hit.material);
        first_hit_normal = hit.n * 0.5 + 0.5;
    } else {
        vec3 sky = mix(vec3(0.1), vec3(0.3, 0.4, 0.6), ray.direction.y * 0.5 + 0.5);
        radiance = sky * 0.5;
        first_hit_albedo = vec3(0.0);
        first_hit_normal = vec3(0.5);
    }

    vec2 localUV = gl_FragCoord.xy / u_resolution;
    vec3 prev_radiance = texture(u_previous, localUV).rgb;
    float blend = 1.0 / float(u_sampleCount + 1);
    vec3 accumulated_radiance = mix(prev_radiance, radiance, blend);

    o_radiance = vec4(accumulated_radiance, 1.0);
    o_albedo = vec4(first_hit_albedo, 1.0);
    o_normal = vec4(first_hit_normal, 1.0);
}`;
    }

    /**
     * Get AOV display fragment shader
     * Supports switching between radiance, albedo, and normal display
     */
    private _getAOVDisplayFragment(): string {
        return `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform sampler2D u_radiance;
uniform sampler2D u_albedo;
uniform sampler2D u_normal;
uniform int u_displayMode;  // 0=radiance, 1=albedo, 2=normal

// Gamma correction
vec3 gamma_correct(vec3 linear) {
    return pow(clamp(linear, 0.0, 1.0), vec3(1.0 / 2.2));
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;

    vec3 color;

    if (u_displayMode == 1) {
        // Albedo (already in [0,1], but apply gamma)
        color = gamma_correct(texture(u_albedo, uv).rgb);
    } else if (u_displayMode == 2) {
        // Normal (encoded as [0,1], display directly)
        color = texture(u_normal, uv).rgb;
    } else {
        // Radiance (default, tone map + gamma)
        vec3 radiance = texture(u_radiance, uv).rgb;
        color = gamma_correct(radiance);
    }

    fragColor = vec4(color, 1.0);
}`;
    }

    /**
     * Generate full path tracer renderer
     *
     * Multi-bounce path tracing with Cornell box scene:
     * - Proper importance sampling with cosine-weighted hemisphere
     * - Russian roulette termination
     * - Emissive light sources
     * - Configurable max bounces
     */
    private _generatePathtracerFullRenderer(
        scene: SceneDescription,
        strategy: RenderStrategy
    ): CompiledRenderer {
        const shaders = new Map<string, ShaderProgram>();
        const maxBounces = strategy.settings?.maxBounces ?? 8;

        // Main pathtracer shader with multi-bounce
        shaders.set('pathtracer-full-main', {
            vertex: this._getFullscreenVertex(),
            fragment: this._getPathtracerFullFragment(maxBounces)
        });

        // Display shader (tone mapping)
        shaders.set('pathtracer-full-display', {
            vertex: this._getFullscreenVertex(),
            fragment: this._getDisplayFragment()
        });

        // Composite shader
        shaders.set('pathtracer-full-composite', {
            vertex: this._getFullscreenVertex(),
            fragment: this._getCompositeFragment()
        });

        // Same pipeline as regular pathtracer
        const pipeline: RenderPipeline = {
            framebuffers: [
                {
                    id: 'accumulation',
                    type: 'double_buffer',
                    format: 'rgba32f'
                },
                {
                    id: 'rgb',
                    type: 'texture',
                    format: 'rgba8'
                },
                {
                    id: 'screen',
                    type: 'screen'
                }
            ],
            passes: [
                {
                    id: 'main-pass',
                    shader: 'pathtracer-full-main',
                    inputs: {
                        textures: {
                            'u_previous': 'accumulation_previous'
                        }
                    },
                    output: 'accumulation_current',
                    execution: {
                        type: 'once',
                        clearBeforeRender: false
                    }
                },
                {
                    id: 'display-pass',
                    shader: 'pathtracer-full-display',
                    inputs: {
                        textures: {
                            'u_radiance': 'accumulation_current'
                        }
                    },
                    output: 'rgb',
                    execution: {
                        type: 'once',
                        clearBeforeRender: false
                    }
                },
                {
                    id: 'composite-pass',
                    shader: 'pathtracer-full-composite',
                    inputs: {
                        textures: {
                            'u_rgb': 'rgb'
                        }
                    },
                    output: 'screen',
                    execution: {
                        type: 'once',
                        clearBeforeRender: false
                    }
                }
            ],
            postFrame: {
                swaps: [
                    {
                        type: 'swap',
                        buffers: ['accumulation']
                    }
                ]
            }
        };

        const uniforms: UniformBinding[] = [
            {
                uniform: 'u_resolution',
                parameters: ['engine.resolution'],
                type: 'vec2',
                compute: (params) => params['engine.resolution']
            },
            {
                uniform: 'u_sampleCount',
                parameters: ['engine.sampleCount'],
                type: 'int',
                compute: (params) => params['engine.sampleCount']
            },
            {
                uniform: 'u_frameIndex',
                parameters: ['engine.frameIndex'],
                type: 'int',
                compute: (params) => params['engine.frameIndex']
            },
            {
                uniform: 'u_time',
                parameters: ['engine.time'],
                type: 'float',
                compute: (params) => params['engine.time']
            },
            {
                uniform: 'u_cameraPosition',
                parameters: ['camera.position'],
                type: 'vec3',
                compute: (params) => params['camera.position'] || [0.0, 0.0, 8.0]
            },
            {
                uniform: 'u_cameraTarget',
                parameters: ['camera.target'],
                type: 'vec3',
                compute: (params) => params['camera.target'] || [0.0, 0.0, 0.0]
            },
            // Scene parameters
            {
                uniform: 'u_sphere1Center',
                parameters: ['scene.sphere1.center'],
                type: 'vec3',
                compute: (params) => params['scene.sphere1.center'] || [-1.5, -0.5, -1.0]
            },
            {
                uniform: 'u_sphere1Radius',
                parameters: ['scene.sphere1.radius'],
                type: 'float',
                compute: (params) => params['scene.sphere1.radius'] ?? 1.5
            },
            {
                uniform: 'u_sphere2Radius',
                parameters: ['scene.sphere2.radius'],
                type: 'float',
                compute: (params) => params['scene.sphere2.radius'] ?? 1.0
            },
            {
                uniform: 'u_lightRadius',
                parameters: ['scene.light.radius'],
                type: 'float',
                compute: (params) => params['scene.light.radius'] ?? 1.0
            },
            {
                uniform: 'u_lightIntensity',
                parameters: ['scene.light.intensity'],
                type: 'float',
                compute: (params) => params['scene.light.intensity'] ?? 15.0
            }
        ];

        return {
            id: 'pathtracer',
            shaders,
            pipeline,
            uniforms,
            sourceMaps: new Map(),
            parameters: {
                'camera.position': {
                    type: 'vec3',
                    default: [0, 0, 8],
                    name: 'Camera Position',
                    group: 'Camera',
                    triggersReset: true
                },
                'camera.target': {
                    type: 'vec3',
                    default: [0, 0, 0],
                    name: 'Camera Target',
                    group: 'Camera',
                    triggersReset: true
                },
                'scene.sphere1.center': {
                    type: 'vec3',
                    default: [-1.5, -0.5, -1.0],
                    name: 'Sphere 1 Center',
                    group: 'Scene',
                    triggersReset: true
                },
                'scene.sphere1.radius': {
                    type: 'float',
                    default: 1.5,
                    range: [0.1, 3.0],
                    step: 0.1,
                    name: 'Sphere 1 Radius',
                    group: 'Scene',
                    triggersReset: true
                },
                'scene.sphere2.radius': {
                    type: 'float',
                    default: 1.0,
                    range: [0.1, 2.0],
                    step: 0.1,
                    name: 'Sphere 2 Radius',
                    group: 'Scene',
                    triggersReset: true
                },
                'scene.light.radius': {
                    type: 'float',
                    default: 1.0,
                    range: [0.2, 3.0],
                    step: 0.1,
                    name: 'Light Size',
                    group: 'Light',
                    triggersReset: true
                },
                'scene.light.intensity': {
                    type: 'float',
                    default: 15.0,
                    range: [1.0, 50.0],
                    step: 1.0,
                    name: 'Light Intensity',
                    group: 'Light',
                    triggersReset: true
                },
                'render.exposure': {
                    type: 'float',
                    default: 1.0,
                    range: [0.1, 5.0],
                    step: 0.1,
                    name: 'Exposure',
                    group: 'Render',
                    triggersReset: false
                },
                'render.maxBounces': {
                    type: 'int',
                    default: maxBounces,
                    range: [1, 16],
                    name: 'Max Bounces',
                    group: 'Render',
                    triggersReset: true
                }
            },
            exportTargets: {
                'hdr': {
                    bufferId: 'accumulation_current',
                    format: 'float'
                },
                'ldr': {
                    bufferId: 'rgb',
                    format: 'byte'
                }
            }
        };
    }

    /**
     * Get full path tracer fragment shader with multi-bounce
     */
    private _getPathtracerFullFragment(maxBounces: number): string {
        return `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform vec2 u_imageSize;
uniform vec2 u_pixelOffset;
uniform int u_sampleCount;
uniform int u_frameIndex;
uniform float u_time;
uniform sampler2D u_previous;

uniform vec3 u_cameraPosition;
uniform vec3 u_cameraTarget;

// Scene parameters
uniform vec3 u_sphere1Center;
uniform float u_sphere1Radius;
uniform float u_sphere2Radius;
uniform float u_lightRadius;
uniform float u_lightIntensity;

#define PI 3.14159265359
#define TWO_PI 6.28318530718
#define EPSILON 0.001
#define MAX_BOUNCES ${maxBounces}
#define RR_START_DEPTH 3

// ============ RNG SYSTEM ============
uint rng_seed;
uint rng_counter;

uint mix32(uint z) {
    z ^= z >> 16;
    z *= 0x7feb352dU;
    z ^= z >> 15;
    z *= 0x846ca68bU;
    z ^= z >> 16;
    return z;
}

uint hash_init(uvec2 pixel, uint frame) {
    uint h = 2166136261U;
    h = (h ^ pixel.x) * 16777619U;
    h = (h ^ pixel.y) * 16777619U;
    h = (h ^ frame) * 16777619U;
    return mix32(h | 1U);
}

uint rng_u32() {
    uint x = rng_seed + rng_counter * 0x9E3779B9U;
    rng_counter++;
    return mix32(x);
}

float random() {
    return float(rng_u32()) * (1.0 / 4294967296.0);
}

vec2 random2() {
    return vec2(random(), random());
}

// ============ SAMPLING ============

// Cosine-weighted hemisphere sampling
vec3 sample_hemisphere_cosine(vec2 xi) {
    float z = sqrt(xi.x);
    float r = sqrt(1.0 - xi.x);
    float phi = TWO_PI * xi.y;
    return vec3(r * cos(phi), r * sin(phi), z);
}

// Build orthonormal basis from normal
void build_basis(vec3 n, out vec3 t, out vec3 b) {
    vec3 up = abs(n.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    t = normalize(cross(up, n));
    b = cross(n, t);
}

vec3 local_to_world(vec3 local_dir, vec3 n) {
    vec3 t, b;
    build_basis(n, t, b);
    return local_dir.x * t + local_dir.y * b + local_dir.z * n;
}

float luminance(vec3 c) {
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

// ============ SCENE: CORNELL BOX ============

#define MAT_FLOOR 1
#define MAT_LEFT_WALL 2
#define MAT_RIGHT_WALL 3
#define MAT_BACK_WALL 4
#define MAT_CEILING 5
#define MAT_SPHERE_DIFFUSE 6
#define MAT_SPHERE_LIGHT 7
#define MAT_SPHERE_METAL 8

struct Ray {
    vec3 origin;
    vec3 direction;
    float tmin;
    float tmax;
};

struct Hit {
    vec3 p;
    vec3 n;
    float t;
    int material;
};

float sdf_sphere(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

float sdf_plane(vec3 p, vec3 normal, float offset) {
    return dot(p, normal) + offset;
}

float scene_sdf(vec3 p, out int material) {
    float min_dist = 1e10;
    material = 0;

    // Floor at y = -2
    float floor_d = sdf_plane(p, vec3(0.0, 1.0, 0.0), 2.0);
    if (floor_d < min_dist) { min_dist = floor_d; material = MAT_FLOOR; }

    // Left wall at x = -4 (red)
    float left_d = sdf_plane(p, vec3(1.0, 0.0, 0.0), 4.0);
    if (left_d < min_dist) { min_dist = left_d; material = MAT_LEFT_WALL; }

    // Right wall at x = 4 (green)
    float right_d = sdf_plane(p, vec3(-1.0, 0.0, 0.0), 4.0);
    if (right_d < min_dist) { min_dist = right_d; material = MAT_RIGHT_WALL; }

    // Back wall at z = -4
    float back_d = sdf_plane(p, vec3(0.0, 0.0, 1.0), 4.0);
    if (back_d < min_dist) { min_dist = back_d; material = MAT_BACK_WALL; }

    // Ceiling at y = 4
    float ceil_d = sdf_plane(p, vec3(0.0, -1.0, 0.0), 4.0);
    if (ceil_d < min_dist) { min_dist = ceil_d; material = MAT_CEILING; }

    // Diffuse sphere (left) - position and radius from uniforms
    float sphere1 = sdf_sphere(p, u_sphere1Center, u_sphere1Radius);
    if (sphere1 < min_dist) { min_dist = sphere1; material = MAT_SPHERE_DIFFUSE; }

    // Metal sphere (right) - fixed position, radius from uniform
    float sphere2 = sdf_sphere(p, vec3(1.8, -1.0, 0.5), u_sphere2Radius);
    if (sphere2 < min_dist) { min_dist = sphere2; material = MAT_SPHERE_METAL; }

    // Emissive light sphere (top center) - radius from uniform
    float light = sdf_sphere(p, vec3(0.0, 3.0, 0.0), u_lightRadius);
    if (light < min_dist) { min_dist = light; material = MAT_SPHERE_LIGHT; }

    return min_dist;
}

vec3 scene_normal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    int dummy;
    return normalize(vec3(
        scene_sdf(p + e.xyy, dummy) - scene_sdf(p - e.xyy, dummy),
        scene_sdf(p + e.yxy, dummy) - scene_sdf(p - e.yxy, dummy),
        scene_sdf(p + e.yyx, dummy) - scene_sdf(p - e.yyx, dummy)
    ));
}

bool scene_intersect(Ray ray, out Hit hit) {
    float t = ray.tmin;
    int material;

    for (int i = 0; i < 128; i++) {
        vec3 p = ray.origin + ray.direction * t;
        float d = scene_sdf(p, material);

        if (d < EPSILON) {
            hit.p = p;
            hit.t = t;
            hit.n = scene_normal(p);
            hit.material = material;
            return true;
        }

        if (t > ray.tmax) break;
        t += d;
    }

    return false;
}

// ============ MATERIALS ============

vec3 get_albedo(int mat) {
    if (mat == MAT_FLOOR) return vec3(0.73);
    if (mat == MAT_LEFT_WALL) return vec3(0.63, 0.065, 0.05);  // Red
    if (mat == MAT_RIGHT_WALL) return vec3(0.14, 0.45, 0.091); // Green
    if (mat == MAT_BACK_WALL) return vec3(0.73);
    if (mat == MAT_CEILING) return vec3(0.73);
    if (mat == MAT_SPHERE_DIFFUSE) return vec3(0.9, 0.9, 0.9);
    if (mat == MAT_SPHERE_METAL) return vec3(0.95, 0.64, 0.54); // Copper-ish
    if (mat == MAT_SPHERE_LIGHT) return vec3(1.0);
    return vec3(0.0);
}

vec3 get_emission(int mat) {
    if (mat == MAT_SPHERE_LIGHT) return vec3(u_lightIntensity);
    return vec3(0.0);
}

float get_roughness(int mat) {
    if (mat == MAT_SPHERE_METAL) return 0.1;
    return 1.0; // Fully diffuse
}

bool is_metal(int mat) {
    return mat == MAT_SPHERE_METAL;
}

// ============ CAMERA ============

Ray generate_camera_ray(vec2 uv, vec2 jitter, vec2 imageSize) {
    vec2 ndc = (uv + jitter / imageSize) * 2.0 - 1.0;
    ndc.x *= imageSize.x / imageSize.y;

    vec3 origin = length(u_cameraPosition) > 0.0 ? u_cameraPosition : vec3(0.0, 0.0, 8.0);
    vec3 lookAt = u_cameraTarget;
    vec3 up = vec3(0.0, 1.0, 0.0);

    vec3 forward = normalize(lookAt - origin);
    vec3 right = normalize(cross(forward, up));
    vec3 camUp = cross(right, forward);

    float fov = 0.8;
    vec3 direction = normalize(forward + ndc.x * right * fov + ndc.y * camUp * fov);

    Ray ray;
    ray.origin = origin;
    ray.direction = direction;
    ray.tmin = EPSILON;
    ray.tmax = 100.0;
    return ray;
}

// ============ PATH TRACING ============

vec3 trace_path(Ray ray) {
    vec3 throughput = vec3(1.0);
    vec3 radiance = vec3(0.0);

    for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        Hit hit;

        if (!scene_intersect(ray, hit)) {
            // Sky / environment
            vec3 sky = mix(vec3(0.1), vec3(0.3, 0.4, 0.6), ray.direction.y * 0.5 + 0.5);
            radiance += throughput * sky * 0.5;
            break;
        }

        // Add emission
        vec3 emission = get_emission(hit.material);
        radiance += throughput * emission;

        // Russian roulette after a few bounces
        if (bounce >= RR_START_DEPTH) {
            float p_survive = min(0.95, luminance(throughput));
            if (random() > p_survive) break;
            throughput /= p_survive;
        }

        vec3 albedo = get_albedo(hit.material);
        float roughness = get_roughness(hit.material);

        vec3 wo = -ray.direction;
        vec3 wi;
        float pdf;

        if (is_metal(hit.material)) {
            // Glossy reflection (simplified)
            vec3 reflected = reflect(ray.direction, hit.n);
            // Add roughness perturbation
            vec3 perturb = sample_hemisphere_cosine(random2());
            wi = normalize(mix(reflected, local_to_world(perturb, reflected), roughness));
            if (dot(wi, hit.n) <= 0.0) break;
            pdf = 1.0; // Simplified
            throughput *= albedo;
        } else {
            // Diffuse: cosine-weighted sampling
            vec3 local_wi = sample_hemisphere_cosine(random2());
            wi = local_to_world(local_wi, hit.n);
            float cos_theta = local_wi.z;
            pdf = cos_theta / PI;

            // Lambertian BRDF: albedo / PI
            // Monte Carlo: (BRDF * cos_theta) / pdf = (albedo/PI * cos_theta) / (cos_theta/PI) = albedo
            throughput *= albedo;
        }

        // Setup next ray
        ray.origin = hit.p + hit.n * EPSILON;
        ray.direction = wi;
        ray.tmin = EPSILON;
        ray.tmax = 100.0;
    }

    return radiance;
}

void main() {
    vec2 imageSize = u_imageSize.x > 0.0 ? u_imageSize : u_resolution;
    vec2 uv = (gl_FragCoord.xy + u_pixelOffset) / imageSize;

    uvec2 pixel = uvec2(gl_FragCoord.xy + u_pixelOffset);
    rng_seed = hash_init(pixel, uint(u_frameIndex));
    rng_counter = 0U;

    vec2 jitter = random2() - 0.5;
    Ray ray = generate_camera_ray(uv, jitter, imageSize);

    vec3 color = trace_path(ray);

    // Accumulate
    vec2 localUV = gl_FragCoord.xy / u_resolution;
    vec3 prev = texture(u_previous, localUV).rgb;
    float blend = 1.0 / float(u_sampleCount + 1);
    vec3 accumulated = mix(prev, color, blend);

    fragColor = vec4(accumulated, 1.0);
}`;
    }

    /**
     * Generate debug AOVs renderer
     *
     * Outputs to MRT:
     * - albedo (material color)
     * - distance (depth from camera, normalized)
     * - steps (ray march iterations, normalized)
     *
     * Includes scene parameters for spheres and light.
     */
    private _generateDebugAOVsRenderer(
        scene: SceneDescription,
        strategy: RenderStrategy
    ): CompiledRenderer {
        const shaders = new Map<string, ShaderProgram>();

        // Main debug shader with MRT outputs
        shaders.set('debug-aovs-main', {
            vertex: this._getFullscreenVertex(),
            fragment: this._getDebugAOVsFragment()
        });

        // Display shader with mode switching
        shaders.set('debug-aovs-display', {
            vertex: this._getFullscreenVertex(),
            fragment: this._getDebugAOVsDisplayFragment()
        });

        // Composite to screen
        shaders.set('debug-aovs-composite', {
            vertex: this._getFullscreenVertex(),
            fragment: this._getCompositeFragment()
        });

        // Pipeline with MRT for AOVs (using same pattern as pathtracer-aovs)
        const pipeline: RenderPipeline = {
            framebuffers: [
                {
                    id: 'aovs',
                    type: 'texture',
                    format: ['rgba32f', 'rgba32f', 'rgba32f', 'rgba16f']  // albedo, distance, steps, normal (MRT)
                },
                {
                    id: 'rgb',
                    type: 'texture',
                    format: 'rgba8'
                },
                {
                    id: 'screen',
                    type: 'screen'
                }
            ],
            passes: [
                {
                    id: 'main-pass',
                    shader: 'debug-aovs-main',
                    inputs: { textures: {} },
                    output: [
                        'aovs:0',  // Write albedo
                        'aovs:1',  // Write distance
                        'aovs:2',  // Write steps
                        'aovs:3'   // Write normal
                    ],
                    execution: {
                        type: 'once',
                        clearBeforeRender: true
                    }
                },
                {
                    id: 'display-pass',
                    shader: 'debug-aovs-display',
                    inputs: {
                        textures: {
                            'u_albedo': 'aovs:0',
                            'u_distance': 'aovs:1',
                            'u_steps': 'aovs:2',
                            'u_normal': 'aovs:3'
                        }
                    },
                    output: 'rgb',
                    execution: {
                        type: 'once',
                        clearBeforeRender: false
                    }
                },
                {
                    id: 'composite-pass',
                    shader: 'debug-aovs-composite',
                    inputs: {
                        textures: {
                            'u_rgb': 'rgb'
                        }
                    },
                    output: 'screen',
                    execution: {
                        type: 'once',
                        clearBeforeRender: false
                    }
                }
            ]
        };

        const uniforms: UniformBinding[] = [
            {
                uniform: 'u_resolution',
                parameters: ['engine.resolution'],
                type: 'vec2',
                compute: (params) => params['engine.resolution']
            },
            {
                uniform: 'u_time',
                parameters: ['engine.time'],
                type: 'float',
                compute: (params) => params['engine.time']
            },
            {
                uniform: 'u_cameraPosition',
                parameters: ['camera.position'],
                type: 'vec3',
                compute: (params) => params['camera.position'] || [0.0, 0.0, 8.0]
            },
            {
                uniform: 'u_cameraTarget',
                parameters: ['camera.target'],
                type: 'vec3',
                compute: (params) => params['camera.target'] || [0.0, 0.0, 0.0]
            },
            // Scene parameters
            {
                uniform: 'u_sphere1Center',
                parameters: ['scene.sphere1.center'],
                type: 'vec3',
                compute: (params) => params['scene.sphere1.center'] || [-1.5, -0.5, -1.0]
            },
            {
                uniform: 'u_sphere1Radius',
                parameters: ['scene.sphere1.radius'],
                type: 'float',
                compute: (params) => params['scene.sphere1.radius'] ?? 1.5
            },
            {
                uniform: 'u_sphere2Radius',
                parameters: ['scene.sphere2.radius'],
                type: 'float',
                compute: (params) => params['scene.sphere2.radius'] ?? 1.0
            },
            {
                uniform: 'u_lightRadius',
                parameters: ['scene.light.radius'],
                type: 'float',
                compute: (params) => params['scene.light.radius'] ?? 1.0
            },
            {
                uniform: 'u_lightIntensity',
                parameters: ['scene.light.intensity'],
                type: 'float',
                compute: (params) => params['scene.light.intensity'] ?? 15.0
            },
            {
                uniform: 'u_displayMode',
                parameters: ['debug.displayMode'],
                type: 'int',
                compute: (params) => params['debug.displayMode'] ?? 0
            }
        ];

        return {
            id: 'debug-aovs',
            shaders,
            pipeline,
            uniforms,
            sourceMaps: new Map(),
            parameters: {
                'camera.position': {
                    type: 'vec3',
                    default: [0, 0, 8],
                    name: 'Camera Position',
                    group: 'Camera',
                    triggersReset: false
                },
                'camera.target': {
                    type: 'vec3',
                    default: [0, 0, 0],
                    name: 'Camera Target',
                    group: 'Camera',
                    triggersReset: false
                },
                'scene.sphere1.center': {
                    type: 'vec3',
                    default: [-1.5, -0.5, -1.0],
                    name: 'Sphere 1 Center',
                    group: 'Scene',
                    triggersReset: false
                },
                'scene.sphere1.radius': {
                    type: 'float',
                    default: 1.5,
                    range: [0.1, 3.0],
                    step: 0.1,
                    name: 'Sphere 1 Radius',
                    group: 'Scene',
                    triggersReset: false
                },
                'scene.sphere2.radius': {
                    type: 'float',
                    default: 1.0,
                    range: [0.1, 2.0],
                    step: 0.1,
                    name: 'Sphere 2 Radius',
                    group: 'Scene',
                    triggersReset: false
                },
                'scene.light.radius': {
                    type: 'float',
                    default: 1.0,
                    range: [0.2, 3.0],
                    step: 0.1,
                    name: 'Light Size',
                    group: 'Light',
                    triggersReset: false
                },
                'scene.light.intensity': {
                    type: 'float',
                    default: 15.0,
                    range: [1.0, 50.0],
                    step: 1.0,
                    name: 'Light Intensity',
                    group: 'Light',
                    triggersReset: false
                },
                'debug.displayMode': {
                    type: 'int',
                    default: 0,
                    range: [0, 3],
                    name: 'Display Mode',
                    group: 'Debug',
                    triggersReset: false,
                    options: ['Albedo', 'Distance', 'Steps', 'Normal']
                }
            },
            exportTargets: {
                'albedo': {
                    bufferId: 'aovs',
                    format: 'float',
                    attachment: 0
                },
                'distance': {
                    bufferId: 'aovs',
                    format: 'float',
                    attachment: 1
                },
                'steps': {
                    bufferId: 'aovs',
                    format: 'float',
                    attachment: 2
                },
                'normal': {
                    bufferId: 'aovs',
                    format: 'float',
                    attachment: 3
                },
                'ldr': {
                    bufferId: 'rgb',
                    format: 'byte'
                }
            }
        };
    }

    /**
     * Debug AOVs fragment shader - outputs albedo, distance, steps, normal
     */
    private _getDebugAOVsFragment(): string {
        return `#version 300 es
precision highp float;

// MRT outputs
layout(location = 0) out vec4 o_albedo;
layout(location = 1) out vec4 o_distance;
layout(location = 2) out vec4 o_steps;
layout(location = 3) out vec4 o_normal;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_cameraPosition;
uniform vec3 u_cameraTarget;

// Scene parameters
uniform vec3 u_sphere1Center;
uniform float u_sphere1Radius;
uniform float u_sphere2Radius;
uniform float u_lightRadius;
uniform float u_lightIntensity;

#define EPSILON 0.001
#define MAX_STEPS 128
#define MAX_DIST 100.0

// Material IDs
#define MAT_FLOOR 1
#define MAT_LEFT_WALL 2
#define MAT_RIGHT_WALL 3
#define MAT_BACK_WALL 4
#define MAT_CEILING 5
#define MAT_SPHERE_DIFFUSE 6
#define MAT_SPHERE_LIGHT 7
#define MAT_SPHERE_METAL 8

float sdf_sphere(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

float sdf_plane(vec3 p, vec3 normal, float offset) {
    return dot(p, normal) + offset;
}

float scene_sdf(vec3 p, out int material) {
    float min_dist = 1e10;
    material = 0;

    float floor_d = sdf_plane(p, vec3(0.0, 1.0, 0.0), 2.0);
    if (floor_d < min_dist) { min_dist = floor_d; material = MAT_FLOOR; }

    float left_d = sdf_plane(p, vec3(1.0, 0.0, 0.0), 4.0);
    if (left_d < min_dist) { min_dist = left_d; material = MAT_LEFT_WALL; }

    float right_d = sdf_plane(p, vec3(-1.0, 0.0, 0.0), 4.0);
    if (right_d < min_dist) { min_dist = right_d; material = MAT_RIGHT_WALL; }

    float back_d = sdf_plane(p, vec3(0.0, 0.0, 1.0), 4.0);
    if (back_d < min_dist) { min_dist = back_d; material = MAT_BACK_WALL; }

    float ceil_d = sdf_plane(p, vec3(0.0, -1.0, 0.0), 4.0);
    if (ceil_d < min_dist) { min_dist = ceil_d; material = MAT_CEILING; }

    // Sphere 1 (diffuse) - position and radius from uniforms
    float sphere1 = sdf_sphere(p, u_sphere1Center, u_sphere1Radius);
    if (sphere1 < min_dist) { min_dist = sphere1; material = MAT_SPHERE_DIFFUSE; }

    // Sphere 2 (metal) - fixed position, radius from uniform
    float sphere2 = sdf_sphere(p, vec3(1.8, -1.0, 0.5), u_sphere2Radius);
    if (sphere2 < min_dist) { min_dist = sphere2; material = MAT_SPHERE_METAL; }

    // Light sphere - radius from uniform
    float light = sdf_sphere(p, vec3(0.0, 3.0, 0.0), u_lightRadius);
    if (light < min_dist) { min_dist = light; material = MAT_SPHERE_LIGHT; }

    return min_dist;
}

vec3 scene_normal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    int dummy;
    return normalize(vec3(
        scene_sdf(p + e.xyy, dummy) - scene_sdf(p - e.xyy, dummy),
        scene_sdf(p + e.yxy, dummy) - scene_sdf(p - e.yxy, dummy),
        scene_sdf(p + e.yyx, dummy) - scene_sdf(p - e.yyx, dummy)
    ));
}

vec3 get_albedo(int mat) {
    if (mat == MAT_FLOOR) return vec3(0.73);
    if (mat == MAT_LEFT_WALL) return vec3(0.63, 0.065, 0.05);
    if (mat == MAT_RIGHT_WALL) return vec3(0.14, 0.45, 0.091);
    if (mat == MAT_BACK_WALL) return vec3(0.73);
    if (mat == MAT_CEILING) return vec3(0.73);
    if (mat == MAT_SPHERE_DIFFUSE) return vec3(0.9);
    if (mat == MAT_SPHERE_METAL) return vec3(0.95, 0.64, 0.54);
    if (mat == MAT_SPHERE_LIGHT) return vec3(1.0, 0.95, 0.8);
    return vec3(0.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec2 ndc = uv * 2.0 - 1.0;
    ndc.x *= u_resolution.x / u_resolution.y;

    // Camera
    vec3 origin = u_cameraPosition;
    vec3 lookAt = u_cameraTarget;
    vec3 up = vec3(0.0, 1.0, 0.0);

    vec3 forward = normalize(lookAt - origin);
    vec3 right = normalize(cross(forward, up));
    vec3 camUp = cross(right, forward);

    float fov = 0.8;
    vec3 direction = normalize(forward + ndc.x * right * fov + ndc.y * camUp * fov);

    // Ray march
    float t = EPSILON;
    int material = 0;
    int steps = 0;

    for (int i = 0; i < MAX_STEPS; i++) {
        vec3 p = origin + direction * t;
        float d = scene_sdf(p, material);
        steps = i + 1;

        if (d < EPSILON) break;
        if (t > MAX_DIST) {
            material = 0;
            break;
        }
        t += d;
    }

    // Output AOVs
    vec3 albedo = material > 0 ? get_albedo(material) : vec3(0.0);
    float distance_norm = clamp(t / MAX_DIST, 0.0, 1.0);
    float steps_norm = float(steps) / float(MAX_STEPS);

    // Calculate normal at hit point (encode to [0,1] range for display)
    vec3 hit_pos = origin + direction * t;
    vec3 normal = material > 0 ? scene_normal(hit_pos) * 0.5 + 0.5 : vec3(0.5);

    o_albedo = vec4(albedo, 1.0);
    o_distance = vec4(vec3(distance_norm), 1.0);
    o_steps = vec4(vec3(steps_norm), 1.0);
    o_normal = vec4(normal, 1.0);
}`;
    }

    /**
     * Debug AOVs display shader - switches between outputs
     */
    private _getDebugAOVsDisplayFragment(): string {
        return `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform sampler2D u_albedo;
uniform sampler2D u_distance;
uniform sampler2D u_steps;
uniform sampler2D u_normal;
uniform int u_displayMode;  // 0=albedo, 1=distance, 2=steps, 3=normal

// Turbo colormap for distance/steps visualization
vec3 turbo(float t) {
    const vec4 kRedVec4 = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
    const vec4 kGreenVec4 = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
    const vec4 kBlueVec4 = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
    const vec2 kRedVec2 = vec2(-152.94239396, 59.28637943);
    const vec2 kGreenVec2 = vec2(4.27729857, 2.82956604);
    const vec2 kBlueVec2 = vec2(-89.90310912, 27.34824973);

    t = clamp(t, 0.0, 1.0);
    vec4 v4 = vec4(1.0, t, t * t, t * t * t);
    vec2 v2 = v4.zw * v4.z;
    return vec3(
        dot(v4, kRedVec4) + dot(v2, kRedVec2),
        dot(v4, kGreenVec4) + dot(v2, kGreenVec2),
        dot(v4, kBlueVec4) + dot(v2, kBlueVec2)
    );
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;

    vec3 color;

    if (u_displayMode == 1) {
        // Distance visualization with turbo colormap
        float dist = texture(u_distance, uv).r;
        color = turbo(dist);
    } else if (u_displayMode == 2) {
        // Steps visualization with turbo colormap
        float steps = texture(u_steps, uv).r;
        color = turbo(steps);
    } else if (u_displayMode == 3) {
        // Normal visualization (already encoded to [0,1])
        color = texture(u_normal, uv).rgb;
    } else {
        // Albedo (default)
        color = texture(u_albedo, uv).rgb;
    }

    fragColor = vec4(color, 1.0);
}`;
    }
}
