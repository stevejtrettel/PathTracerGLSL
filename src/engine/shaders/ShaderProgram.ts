/**
 * Purpose: Compile/link a vertex + fragment shader, cache uniform/sampler locations (reflection), and expose a bind API.
 * Public contract: class ShaderProgram { static create(gl, sources); use(gl); uniform(name): WebGLUniformLocation|null; dispose(gl); }
 * Inputs: GLSL sources (assembled fragment + fixed vertex), capability-driven defines (if any) are pre-baked by the caller.
 * Outputs: Linked WebGLProgram and a reflection map of uniform locations.
 * Lifecycle: Built on pipeline build; reused until a rebuild is needed; disposed on teardown.
 * Invariants:
 *  - No concatenation or prefixing here (the assembler does that).
 *  - Never swallows compiler/linker logs; fails fast with readable diagnostics.
 *  - No assumptions about attribute layouts (we’ll use a fullscreen triangle VAO elsewhere).
 */

import type { ShaderSources } from "./Types";

export class ShaderProgram {
    private constructor(
        public readonly program: WebGLProgram,
        private readonly uniformMap: Map<string, WebGLUniformLocation>
    ) {}

    /** Compile & link, then reflect uniforms. Throws with readable error on failure. */
    static create(gl: WebGL2RenderingContext, src: ShaderSources): ShaderProgram {
        const vs = compile(gl, gl.VERTEX_SHADER, src.vertex);
        const fs = compile(gl, gl.FRAGMENT_SHADER, src.fragment);

        const program = gl.createProgram();
        if (!program) throw new Error('Failed to create WebGLProgram');

        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        // Clean up shaders regardless of link success (they are no longer needed after link).
        gl.deleteShader(vs);
        gl.deleteShader(fs);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const info = gl.getProgramInfoLog(program) || 'Unknown link error';
            gl.deleteProgram(program);
            throw new Error(formatLinkError(info, src));
        }

        const uniformMap = reflectUniforms(gl, program);
        return new ShaderProgram(program, uniformMap);
    }

    /** Make this program current. Caller sets state (VAO, textures, viewport, draw). */
    use(gl: WebGL2RenderingContext): void {
        gl.useProgram(this.program);
    }

    /** Get the cached uniform location by its (already-prefixed) name, or null if absent. */
    uniform(name: string): WebGLUniformLocation | null {
        return this.uniformMap.get(name) ?? null;
    }

    /** Destroy program. Caller must ensure it is not current. */
    dispose(gl: WebGL2RenderingContext): void {
        gl.deleteProgram(this.program);
    }
}

/* --------------------------------- Helpers -------------------------------- */

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader) || 'Unknown compile error';
        const kind = type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT';
        gl.deleteShader(shader);
        throw new Error(formatCompileError(kind, info, source));
    }
    return shader;
}

/** Reflect active uniforms into a name → location map (includes samplers). */
function reflectUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): Map<string, WebGLUniformLocation> {
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    const map = new Map<string, WebGLUniformLocation>();
    for (let i = 0; i < count; i++) {
        const info = gl.getActiveUniform(program, i);
        if (!info) continue;

        // Strip array suffix "[0]" for arrays; WebGL reports names like "u_array[0]".
        const name = info.name.replace(/\[0\]$/, '');
        const loc = gl.getUniformLocation(program, name);
        if (loc) map.set(name, loc);
    }
    return map;
}

/** Pretty format for shader compile errors with a numbered listing. */
function formatCompileError(kind: 'VERTEX' | 'FRAGMENT', info: string, source: string): string {
    const numbered = source
        .split('\n')
        .map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`)
        .join('\n');
    return `[Shader ${kind} COMPILE ERROR]\n${info}\n--- SOURCE ---\n${numbered}`;
}

/** Pretty format for link errors with both sources attached for context. */
function formatLinkError(info: string, src: ShaderSources): string {
    const fmt = (label: string, code: string) =>
        `${label}:\n` +
        code
            .split('\n')
            .map((l, i) => `${String(i + 1).padStart(4, ' ')} | ${l}`)
            .join('\n');
    return `[Program LINK ERROR]\n${info}\n--- SOURCES ---\n${fmt('VERTEX', src.vertex)}\n\n${fmt('FRAGMENT', src.fragment)}\n`;
}
