// compiler/generate/features/glsl-format.ts
// Shared GLSL literal formatting used by the per-scene code generators.

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

/**
 * Format a RADIOMETRIC constant (albedo, emission, light radiance, sky color) — §2.5.
 * The SINGLE point spectral mode overrides: RGB mode emits `vec3(r,g,b)` (identical to
 * formatVec3 today); spectral mode will emit upsampling-coefficient evaluation here. Kept
 * distinct from formatVec3 so geometric constants (positions, normals) are never touched.
 */
export function formatSpectrum(v: number[]): string {
    return formatVec3(v);
}
