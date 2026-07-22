// components/glsl-format.ts
// Shared GLSL literal formatting used by descriptor emit-code and the per-scene code
// generators. Pure leaf util (no imports) — lives in components so descriptors never
// reach into the compiler for it.

export function formatFloat(v: number): string {
    if (!Number.isFinite(v)) {
        throw new Error(`GLSL format: cannot format non-finite number: ${v}`);
    }
    const s = v.toString();
    if (s.includes('e') || s.includes('E')) return v.toExponential();
    return s.includes('.') ? s : s + '.0';
}

export function formatVec3(v: number[]): string {
    return `vec3(${formatFloat(v[0])}, ${formatFloat(v[1])}, ${formatFloat(v[2])})`;
}

export function formatVec4(v: number[]): string {
    return `vec4(${formatFloat(v[0])}, ${formatFloat(v[1])}, ${formatFloat(v[2])}, ${formatFloat(v[3])})`;
}

/**
 * Format a RADIOMETRIC constant (albedo, emission, light radiance, sky color) — §2.5.
 * The SINGLE point spectral mode overrides: RGB mode emits `vec3(r,g,b)` (identical to
 * formatVec3 today); spectral mode will emit upsampling-coefficient evaluation here. Kept
 * distinct from formatVec3 so geometric constants (positions, normals) are never touched.
 */
export function formatSpectrum(v: number[]): string {
    return formatVec3(v);
}

/** Column-major mat3 literal (GLSL constructor order) from 9 numbers. */
export function formatMat3(m: number[]): string {
    if (m.length !== 9) {
        throw new Error(`GLSL format: mat3 needs 9 numbers, got ${m.length}`);
    }
    return `mat3(${m.map(formatFloat).join(', ')})`;
}

/** Uniform name from a parameter path (§2.8): 'clay.albedo' → 'u_clay_albedo'. */
export function paramToUniform(path: string): string {
    return 'u_' + path.replace(/\./g, '_');
}
