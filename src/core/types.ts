/**
 * Core contracts for the modular renderer.
 * Keep this tiny and readable; we'll expand as needed.
 */

export type Stage = "frag" | "vert" | "common";

/** A named GLSL contribution with optional dependencies. */
export interface GLSLChunk {
    name: string;
    stage: Stage;
    source: string;
    deps?: readonly string[];
}

/** Well-known roles; exactly one active plugin per role. */
export type Role = "geometry" | "camera" | "integrator" | "display" | "controls" | "lib";

/** Declarative uniform types */
export type UniformType =
    | "float" | "int"
    | "vec2" | "vec3" | "vec4"
    | "ivec2" | "ivec3" | "ivec4"
    | "mat3" | "mat4"
    | "sampler2D" | "samplerCube";

/** Uniform declaration (used internally by assembler) */
export interface UniformDecl {
    name: string;
    type: UniformType;
}

/** Uniform specification with type and value */
export interface UniformSpec {
    type: UniformType;
    value: number | number[] | Float32Array | WebGLTexture;
}

/** Base plugin interface */
export interface Plugin {
    namespace: string;
    role: Role;
    chunks(): GLSLChunk[];

    /** Single method provides both types and values */
    getUniforms?(): Record<string, UniformSpec>;
}

/** Recommended contract names */
export const ChunkNames = {
    GeometryTypes: "geometry.types",
    GeometryOps: "geometry.ops",
    CameraGenerateRay: "camera.generateRay",
    IntegratorIntegrate: "integrator.integrate",
    DisplayDisplay: "display.display",
    SceneSDF: "scene.sdf",
} as const;

// ---------- Geometry contracts (runtime) ----------
export type Vec3 = { x: number; y: number; z: number };

/** Opaque CPU-side frame; concrete geometries define their own fields. */
export interface GeoFrame {
    [key: string]: unknown;
}

/** Minimal runtime hooks every geometry provides */
export interface GeometryRuntime<F extends GeoFrame = GeoFrame> {
    createDefaultFrame(): F;
    moveLocal(frame: F, local: Vec3, speed: number, dt: number): void;
    rotateLocal(frame: F, angular: Vec3, rotSpeed: number, dt: number): void;
    stabilize?(frame: F): void;
}

/** A complete geometry module = shader plugin + runtime. */
export interface GeometryModule<F extends GeoFrame = GeoFrame> {
    shader: Plugin;
    runtime: GeometryRuntime<F>;
}

/** Optional context passed to plugins during uniform binding. */
export interface PipelineContext<F extends GeoFrame = GeoFrame> {
    geometry?: {
        runtime: GeometryRuntime<F>;
        frame: F;
    };
}
