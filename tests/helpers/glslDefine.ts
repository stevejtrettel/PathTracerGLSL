// Read one numeric `#define` from GLSL source. Tests and witness fixtures that depend on a
// shader constant read it from the shader with this, instead of copying the number.

export function glslDefine(src: string, name: string): number {
    const m = src.match(new RegExp(`#define\\s+${name}\\s+([0-9.eE+-]+)`));
    if (!m) throw new Error(`#define ${name} not found`);
    return Number(m[1]);
}
