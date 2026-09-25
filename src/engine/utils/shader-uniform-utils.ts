// engine/utils/shader-uniform-utils.ts
import type { UniformType } from '../types';

// Uniform values compare EXACTLY. The comparison only decides whether to skip a redundant
// upload, so "equal" must mean equal: the old absolute 1e-5 tolerance silently dropped every
// change to a small parameter (a σ in m⁻¹, a tiny radius) — the accumulation reset and the
// stamp recorded the new value while the GPU kept the old one (Sep 25 audit).

/**
 * Set a WebGL uniform value with optional type hint
 */
export function setUniformValue(
    gl: WebGL2RenderingContext,
    location: WebGLUniformLocation,
    value: any,
    type?: UniformType
): void {
    if (type) {
        setUniformTyped(gl, location, value, type);
    } else {
        setUniformInferred(gl, location, value);
    }
}

/**
 * Compare two uniform values for equality
 */
export function uniformValuesEqual(a: any, b: any, type?: UniformType): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;

    if (type) {
        return valuesEqualTyped(a, b, type);
    }
    return valuesEqualUntyped(a, b);
}

// (cacheUniformLocations deleted — E11: zero callers; the executor owns its own
// per-program WeakMap location cache.)

// ============================================================================
// Private: Uniform Setting
// ============================================================================

function setUniformTyped(
    gl: WebGL2RenderingContext,
    location: WebGLUniformLocation,
    value: any,
    type: UniformType
): void {
    switch (type) {
        case 'float':
            gl.uniform1f(location, value);
            break;
        case 'float[]':
            // GLSL `uniform float u_x[N]` — value is a Float32Array/number[] of length N.
            gl.uniform1fv(location, value);
            break;
        case 'int':
            gl.uniform1i(location, value);
            break;
        case 'bool':
            gl.uniform1i(location, value ? 1 : 0);
            break;
        case 'vec2':
            gl.uniform2fv(location, value);
            break;
        case 'vec3':
            gl.uniform3fv(location, value);
            break;
        case 'vec4':
            gl.uniform4fv(location, value);
            break;
        case 'mat3':
            gl.uniformMatrix3fv(location, false, value);
            break;
        case 'mat4':
            gl.uniformMatrix4fv(location, false, value);
            break;
        case 'sampler2D':
        case 'samplerCube':
            gl.uniform1i(location, value);
            break;
        default:
            console.warn(`Unknown uniform type: ${type}`);
            setUniformInferred(gl, location, value);
    }
}

function setUniformInferred(
    gl: WebGL2RenderingContext,
    location: WebGLUniformLocation,
    value: any
): void {
    if (typeof value === 'number') {
        gl.uniform1f(location, value);
    } else if (typeof value === 'boolean') {
        gl.uniform1i(location, value ? 1 : 0);
    } else if (Array.isArray(value) || value instanceof Float32Array) {
        switch (value.length) {
            case 2: gl.uniform2fv(location, value); break;
            case 3: gl.uniform3fv(location, value); break;
            case 4: gl.uniform4fv(location, value); break;
            case 9: gl.uniformMatrix3fv(location, false, value); break;
            case 16: gl.uniformMatrix4fv(location, false, value); break;
        }
    }
}

// ============================================================================
// Private: Value Comparison
// ============================================================================

function valuesEqualTyped(a: any, b: any, type: UniformType): boolean {
    switch (type) {
        case 'float':
            return a === b;
        case 'float[]':
            return valuesEqualUntyped(a, b);   // element-wise, any length
        case 'int':
        case 'bool':
            return a === b;
        case 'vec2':
            return arrayEquals(a, b, 2);
        case 'vec3':
            return arrayEquals(a, b, 3);
        case 'vec4':
            return arrayEquals(a, b, 4);
        case 'mat3':
            return arrayEquals(a, b, 9);
        case 'mat4':
            return arrayEquals(a, b, 16);
        case 'sampler2D':
        case 'samplerCube':
            return a === b;
        default:
            return valuesEqualUntyped(a, b);
    }
}

function valuesEqualUntyped(a: any, b: any): boolean {
    // Handle arrays and typed arrays
    if ((Array.isArray(a) || ArrayBuffer.isView(a)) &&
        (Array.isArray(b) || ArrayBuffer.isView(b))) {
        const arrA = a as ArrayLike<number>;
        const arrB = b as ArrayLike<number>;
        if (arrA.length !== arrB.length) return false;

        for (let i = 0; i < arrA.length; i++) {
            if (arrA[i] !== arrB[i]) return false;
        }
        return true;
    }

    return false;
}

function arrayEquals(a: any, b: any, length: number): boolean {
    if (!a || !b) return false;
    if (a.length !== length || b.length !== length) return false;

    for (let i = 0; i < length; i++) {
        if (a[i] !== b[i]) return false;
    }

    return true;
}
