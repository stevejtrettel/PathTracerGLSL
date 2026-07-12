// compiler/EnvironmentBake.ts
// env-as-light T4: compile the ONE-SHOT bake renderer for a procedural environment.
//
// "A procedural sky is a recipe for a table" made literal: this is an ordinary
// CompiledRenderer — one generated fragment shader evaluating the formula over the equirect
// grid, one FIXED-SIZE framebuffer (the FramebufferConfig.size contract extension), one
// pass, one export target. The engine executes it blindly; the APP owns run-once semantics
// (load → select → renderFrame → readExport('table') → unload), then feeds the readback to
// the same CPU CDF builder image environments use. The engine never learns the word "bake".
//
// The table bakes UNROTATED (the chart's rotation is a lookup-time transform, shadowed to a
// const 0 here) and WITHOUT intensity (a uniform scale cancels in the normalized CDF).

import type { SceneDescription, CompiledRenderer } from './types.js';
import fullscreenVertGLSL from './generate/glsl/fullscreen.vert.glsl?raw';
import envChartEquirectGLSL from './generate/glsl/env_chart_equirect.glsl?raw';

export const DEFAULT_ENV_TABLE_SIZE: [number, number] = [512, 256];

export function compileEnvironmentBake(scene: SceneDescription): CompiledRenderer | null {
    const env = scene.environment;
    if (env?.type !== 'procedural') return null;

    const [w, h] = env.tableSize ?? DEFAULT_ENV_TABLE_SIZE;
    const rendererId = `envbake-${scene.id}`;
    const shaderId = `${rendererId}-bake`;

    const fragment = [
        '#version 300 es',
        'precision highp float;',
        'precision highp int;',
        '',
        'out vec4 fragColor;',
        '',
        '#define PI 3.14159265359',
        '#define TWO_PI 6.28318530718',
        '// The chart reads u_envRotation; the TABLE is unrotated by definition (rotation is a',
        '// lookup-time transform) — a const shadows the uniform the chart file expects.',
        'const float u_envRotation = 0.0;',
        '',
        envChartEquirectGLSL,
        '',
        '// gl_FragCoord centers at +0.5, so uv hits texel centers; readback row j then',
        '// corresponds to θ = π(j+½)/H — the exact convention the CPU CDF builder assumes.',
        'void main() {',
        `    vec2 uv = gl_FragCoord.xy / vec2(${w}.0, ${h}.0);`,
        '    vec3 dir = env_chart_dir(uv);',
        `    fragColor = vec4((${env.glsl.source}), 1.0);`,
        '}',
    ].join('\n');

    return {
        id: rendererId,
        shaders: new Map([[shaderId, { vertex: '#version 300 es\n' + fullscreenVertGLSL, fragment }]]),
        pipeline: {
            framebuffers: [
                { id: 'env_table', type: 'texture', format: 'rgba32f', size: [w, h] },
            ],
            passes: [
                {
                    id: 'bake-pass',
                    shader: shaderId,
                    output: 'env_table',
                    execution: { type: 'once' },
                },
            ],
        },
        uniforms: [],
        sourceMaps: new Map([[shaderId, {
            shaderId,
            blocks: [{ origin: 'generated:env-bake', startLine: 1, endLine: fragment.split('\n').length }],
            assembledSource: fragment,
        }]]),
        exportTargets: {
            table: { bufferId: 'env_table', format: 'float' },
        },
    };
}
