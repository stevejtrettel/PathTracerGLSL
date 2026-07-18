// engine/utils/shader-uniform-utils.ts
import type { UniformType } from '../types';

// Epsilon for floating point comparison
const EPSILON = 0.00001;

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

/**
 * Cache all uniform locations for a program
 */
export function cacheUniformLocations(
    gl: WebGL2RenderingContext,
    program: WebGLProgram
): Map<string, WebGLUniformLocation> {
    const locations = new Map<string, WebGLUniformLocation>();
    const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);

    for (let i = 0; i < numUniforms; i++) {
        const uniformInfo = gl.getActiveUniform(program, i);
        if (!uniformInfo) continue;

        const location = gl.getUniformLocation(program, uniformInfo.name);
        if (location) {
            locations.set(uniformInfo.name, location);
        }
    }

    return locations;
}

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
            return Math.abs(a - b) < EPSILON;
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
            if (Math.abs(arrA[i] - arrB[i]) > EPSILON) return false;
        }
        return true;
    }

    return false;
}

function arrayEquals(a: any, b: any, length: number): boolean {
    if (!a || !b) return false;
    if (a.length !== length || b.length !== length) return false;

    for (let i = 0; i < length; i++) {
        if (Math.abs(a[i] - b[i]) >= EPSILON) return false;
    }

    return true;
}
