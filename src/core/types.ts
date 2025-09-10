/**
 * Core contracts for the modular renderer.
 * Keep this tiny and readable; we’ll expand as needed.
 */

export type Stage = "frag" | "vert" | "common";

/** A named GLSL contribution with optional dependencies. */
export interface GLSLChunk {
    /** Unique, role-scoped identifier, e.g. "integrator.integrate" */
    name: string;
    /** Which pipeline stage this targets (mostly "frag" for now). */
    stage: Stage;
    /** The actual GLSL source (from a .frag/.glsl file). */
    source: string;
    /** Other chunk names this one needs before it. */
    deps: string[];// Always present, [] if none
}



/** Well-known roles; exactly one active plugin per role. */
export type Role = "geometry" | "camera" | "integrator" | "display" | "controls" | "lib";

/** Declarative uniform (local name; engine will prefix at link time). */
export type UniformType =
    | "float" | "int"
    | "vec2" | "vec3" | "vec4"
    | "ivec2" | "ivec3" | "ivec4"
    | "mat3" | "mat4"
    | "sampler2D" | "samplerCube";

export interface UniformDecl {
    name: string;   // local name, e.g. "time", "tint", "accumBuffer"
    type: UniformType;
}

/** Base plugin interface (per-role provider of chunks + uniforms). */
export interface Plugin {
    /** Namespace used for uniform prefixing & diagnostics, e.g. "integrator", "display.aces". */
    namespace: string;
    /** Which role this plugin fulfills. */
    role: Role;
    /** GLSL contributions (functions/helpers) this plugin provides. */
    chunks(): GLSLChunk[];
    /** Uniforms this plugin needs (local names; engine will prefix). */
    uniforms(): UniformDecl[];
    /** Later: parameters(): Parameter[] */
}

/**
 * Recommended contract names (engine will look for exactly one of each at link time):
 * - Camera must provide:   "camera.generateRay"   -> Ray generateRay(vec2 filmUV);
 * - Integrator must provide:"integrator.integrate"-> vec3 integrate(vec2 fragCoord);
 * - Display must provide:  "display.display"      -> vec3 display(vec3 hdr);
 *
 * Common uniforms reserved by the engine (optional per stage):
 *   uniform vec2  u_resolution;
 *   uniform float u_time;
 *   uniform int   u_frame;
 *   // Later (accumulation):
 *   uniform sampler2D u_history;
 *   uniform int       u_sampleCount;
 */
export const ChunkNames = {
    GeometryTypes: "geometry.types",
    GeometryOps: "geometry.ops",
    CameraGenerateRay: "camera.generateRay",
    IntegratorIntegrate: "integrator.integrate",
    DisplayDisplay: "display.display",
} as const;


