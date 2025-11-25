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
            id: `debug-${scene.id}`,
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
            }
        ];

        return {
            id: `pathtracer-${scene.id}`,
            shaders,
            pipeline,
            uniforms,
            sourceMaps: new Map(),
            // Test parameter metadata for ParameterPanelExtension
            parameters: {
                'camera.position': {
                    type: 'vec3',
                    default: [0, 0, 5],
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
                    default: 4,
                    range: [1, 10],
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
     * Simple raytracer with accumulation
     */
    private _getPathtracerMainFragment(): string {
        return `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform vec2 u_imageSize;     // Full image size for tiled rendering
uniform vec2 u_pixelOffset;   // Tile offset in full image
uniform int u_sampleCount;
uniform int u_frameIndex;
uniform float u_time;
uniform sampler2D u_previous;

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

vec3 random3() {
    return vec3(random(), random(), random());
}

// ============ SIMPLE SCENE ============
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
    vec3 albedo;
};

// Simple sphere SDF
float sdf_sphere(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

// Simple scene: sphere and floor
float scene_sdf(vec3 p, out vec3 albedo) {
    // Floor
    float floor = p.y + 2.0;
    float dist = floor;
    albedo = vec3(0.8);

    // Sphere
    float sphere = sdf_sphere(p, vec3(0.0, 0.0, 0.0), 1.0);
    if (sphere < dist) {
        dist = sphere;
        albedo = vec3(0.9, 0.3, 0.3);
    }

    return dist;
}

// Raymarch intersection
bool scene_intersect(Ray ray, out Hit hit) {
    float t = ray.tmin;
    vec3 albedo;

    for (int i = 0; i < 100; i++) {
        vec3 p = ray.origin + ray.direction * t;
        float d = scene_sdf(p, albedo);

        if (d < 0.001) {
            // Hit!
            hit.p = p;
            hit.t = t;
            hit.albedo = albedo;

            // Compute normal via gradient
            vec2 e = vec2(0.001, 0.0);
            vec3 dummy;
            hit.n = normalize(vec3(
                scene_sdf(p + e.xyy, dummy) - scene_sdf(p - e.xyy, dummy),
                scene_sdf(p + e.yxy, dummy) - scene_sdf(p - e.yxy, dummy),
                scene_sdf(p + e.yyx, dummy) - scene_sdf(p - e.yyx, dummy)
            ));

            return true;
        }

        if (t > ray.tmax) break;
        t += d;
    }

    return false;
}

// Simple camera
Ray generate_camera_ray(vec2 uv, vec2 jitter, vec2 imageSize) {
    // Perspective camera with better FOV
    // Use full image size for aspect ratio (important for tiled rendering)
    vec2 ndc = (uv + jitter / imageSize) * 2.0 - 1.0;
    ndc.x *= imageSize.x / imageSize.y;

    // Camera positioned to see sphere and floor
    vec3 origin = vec3(2.0, 1.0, 4.0);
    vec3 lookAt = vec3(0.0, 0.0, 0.0);
    vec3 up = vec3(0.0, 1.0, 0.0);

    // Build camera basis
    vec3 forward = normalize(lookAt - origin);
    vec3 right = normalize(cross(forward, up));
    vec3 camUp = cross(right, forward);

    // FOV ~60 degrees
    float fov = 1.0;
    vec3 direction = normalize(forward + ndc.x * right * fov + ndc.y * camUp * fov);

    Ray ray;
    ray.origin = origin;
    ray.direction = direction;
    ray.tmin = 0.001;
    ray.tmax = 100.0;

    return ray;
}

// Simple shading
vec3 shade(Hit hit) {
    // Lambertian diffuse with simple sky lighting
    vec3 sky_dir = vec3(0.0, 1.0, 0.0);
    float ndotl = max(0.0, dot(hit.n, sky_dir));
    vec3 sky_color = vec3(0.5, 0.7, 1.0);

    return hit.albedo * (sky_color * ndotl + vec3(0.1));
}

void main() {
    // For tiled rendering: use full image size if set, otherwise use resolution
    vec2 imageSize = u_imageSize.x > 0.0 ? u_imageSize : u_resolution;

    // Compute UVs accounting for tile offset in full image
    vec2 uv = (gl_FragCoord.xy + u_pixelOffset) / imageSize;

    // Initialize RNG using global pixel position for consistent noise across tiles
    uvec2 pixel = uvec2(gl_FragCoord.xy + u_pixelOffset);
    rng_seed = hash_init(pixel, uint(u_frameIndex));
    rng_counter = 0U;

    // Generate ray with jitter
    vec2 jitter = random2() - 0.5;
    Ray ray = generate_camera_ray(uv, jitter, imageSize);

    // Trace
    Hit hit;
    vec3 color = vec3(0.0);

    if (scene_intersect(ray, hit)) {
        color = shade(hit);
    } else {
        // Sky
        color = mix(vec3(1.0), vec3(0.5, 0.7, 1.0), ray.direction.y * 0.5 + 0.5);
    }

    // Accumulate with previous frame
    // Use local UV for texture sampling (texture is tile-sized, not full image)
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
            }
        ];

        return {
            id: `pathtracer-aovs-${scene.id}`,
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
     */
    private _getPathtracerMRTFragment(): string {
        return `#version 300 es
precision highp float;

// MRT outputs
layout(location = 0) out vec4 o_radiance;
layout(location = 1) out vec4 o_albedo;
layout(location = 2) out vec4 o_normal;

uniform vec2 u_resolution;
uniform vec2 u_imageSize;     // Full image size for tiled rendering
uniform vec2 u_pixelOffset;   // Tile offset in full image
uniform int u_sampleCount;
uniform int u_frameIndex;
uniform float u_time;
uniform sampler2D u_previous;  // Previous radiance

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

vec3 random3() {
    return vec3(random(), random(), random());
}

// ============ SIMPLE SCENE ============
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
    vec3 albedo;
};

// Simple sphere SDF
float sdf_sphere(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

// Simple scene: sphere and floor
float scene_sdf(vec3 p, out vec3 albedo) {
    // Floor
    float floor = p.y + 2.0;
    float dist = floor;
    albedo = vec3(0.8);

    // Sphere
    float sphere = sdf_sphere(p, vec3(0.0, 0.0, 0.0), 1.0);
    if (sphere < dist) {
        dist = sphere;
        albedo = vec3(0.9, 0.3, 0.3);
    }

    return dist;
}

// Raymarch intersection
bool scene_intersect(Ray ray, out Hit hit) {
    float t = ray.tmin;
    vec3 albedo;

    for (int i = 0; i < 100; i++) {
        vec3 p = ray.origin + ray.direction * t;
        float d = scene_sdf(p, albedo);

        if (d < 0.001) {
            // Hit!
            hit.p = p;
            hit.t = t;
            hit.albedo = albedo;

            // Compute normal via gradient
            vec2 e = vec2(0.001, 0.0);
            vec3 dummy;
            hit.n = normalize(vec3(
                scene_sdf(p + e.xyy, dummy) - scene_sdf(p - e.xyy, dummy),
                scene_sdf(p + e.yxy, dummy) - scene_sdf(p - e.yxy, dummy),
                scene_sdf(p + e.yyx, dummy) - scene_sdf(p - e.yyx, dummy)
            ));

            return true;
        }

        if (t > ray.tmax) break;
        t += d;
    }

    return false;
}

// Simple camera
Ray generate_camera_ray(vec2 uv, vec2 jitter, vec2 imageSize) {
    // Perspective camera with better FOV
    // Use full image size for aspect ratio (important for tiled rendering)
    vec2 ndc = (uv + jitter / imageSize) * 2.0 - 1.0;
    ndc.x *= imageSize.x / imageSize.y;

    // Camera positioned to see sphere and floor
    vec3 origin = vec3(2.0, 1.0, 4.0);
    vec3 lookAt = vec3(0.0, 0.0, 0.0);
    vec3 up = vec3(0.0, 1.0, 0.0);

    // Build camera basis
    vec3 forward = normalize(lookAt - origin);
    vec3 right = normalize(cross(forward, up));
    vec3 camUp = cross(right, forward);

    // FOV ~60 degrees
    float fov = 1.0;
    vec3 direction = normalize(forward + ndc.x * right * fov + ndc.y * camUp * fov);

    Ray ray;
    ray.origin = origin;
    ray.direction = direction;
    ray.tmin = 0.001;
    ray.tmax = 100.0;

    return ray;
}

// Simple shading
vec3 shade(Hit hit) {
    // Lambertian diffuse with simple sky lighting
    vec3 sky_dir = vec3(0.0, 1.0, 0.0);
    float ndotl = max(0.0, dot(hit.n, sky_dir));
    vec3 sky_color = vec3(0.5, 0.7, 1.0);

    return hit.albedo * (sky_color * ndotl + vec3(0.1));
}

void main() {
    // For tiled rendering: use full image size if set, otherwise use resolution
    vec2 imageSize = u_imageSize.x > 0.0 ? u_imageSize : u_resolution;

    // Compute UVs accounting for tile offset in full image
    vec2 uv = (gl_FragCoord.xy + u_pixelOffset) / imageSize;

    // Initialize RNG using global pixel position for consistent noise across tiles
    uvec2 pixel = uvec2(gl_FragCoord.xy + u_pixelOffset);
    rng_seed = hash_init(pixel, uint(u_frameIndex));
    rng_counter = 0U;

    // Generate ray with jitter
    vec2 jitter = random2() - 0.5;
    Ray ray = generate_camera_ray(uv, jitter, imageSize);

    // Trace
    Hit hit;
    vec3 radiance = vec3(0.0);
    vec3 first_hit_albedo = vec3(0.0);
    vec3 first_hit_normal = vec3(0.5);  // Default to "no hit" encoding

    if (scene_intersect(ray, hit)) {
        // Compute radiance (expensive path tracing)
        radiance = shade(hit);

        // Write first-hit data (very cheap - we already computed it!)
        first_hit_albedo = hit.albedo;
        first_hit_normal = hit.n * 0.5 + 0.5;  // Encode [-1,1] to [0,1]
    } else {
        // Sky
        radiance = mix(vec3(1.0), vec3(0.5, 0.7, 1.0), ray.direction.y * 0.5 + 0.5);
        first_hit_albedo = vec3(0.0);  // No hit
        first_hit_normal = vec3(0.5);  // Encode "no hit"
    }

    // Accumulate radiance with previous frame
    // Use local UV for texture sampling (texture is tile-sized, not full image)
    vec2 localUV = gl_FragCoord.xy / u_resolution;
    vec3 prev_radiance = texture(u_previous, localUV).rgb;
    float blend = 1.0 / float(u_sampleCount + 1);
    vec3 accumulated_radiance = mix(prev_radiance, radiance, blend);

    // Write MRT outputs
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
}
