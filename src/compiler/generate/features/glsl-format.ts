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
