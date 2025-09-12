
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
   // deps: string[];// Always present, [] if none
    deps?: readonly string[];   // ← accept readonly/literal arrays
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
    SceneSDF: "scene.sdf",           //for now
} as const;








// ---------- Geometry contracts (runtime) ----------
export type Vec3 = { x: number; y: number; z: number };

/** Opaque CPU-side frame; concrete geometries define their own fields. */
export interface GeoFrame {
    [key: string]: unknown;
}

/** Minimal runtime hooks every geometry provides (no library types). */
export interface GeometryRuntime<F extends GeoFrame = GeoFrame> {
    createDefaultFrame(): F;

    /** Move in *local* [right, up, forward]. Units: world-units/sec. */
    moveLocal(frame: F, local: Vec3, speed: number, dt: number): void;

    /** Rotate about *local* axes: pitch (about right), yaw (about up), roll (about forward). */
    rotateLocal(frame: F, angular: Vec3, rotSpeed: number, dt: number): void;

    /** Optional re-orthonormalization / cleanup. */
    stabilize?(frame: F): void;
}

/** A complete geometry module = shader plugin + runtime. */
export interface GeometryModule<F extends GeoFrame = GeoFrame> {
    shader: Plugin;                // contributes geometry.types / geometry.ops
    runtime: GeometryRuntime<F>;   // owns and updates the frame
}

/** Optional context passed to plugins during uniform binding. */
export interface PipelineContext<F extends GeoFrame = GeoFrame> {
    geometry?: {
        runtime: GeometryRuntime<F>;
        frame: F;
    };
}




// Rich semantic types for parameters
export type ParameterType =
    | 'float'
    | 'int'
    | 'angle'      // Shown in degrees in UI, but can be radians internally
    | 'color'      // vec3 representing RGB
    | 'vec2'
    | 'vec3'
    | 'boolean';

// Describes a user-facing parameter
export interface ParameterDescriptor {
    name: string;                    // Local name (e.g., 'fov')
    displayName?: string;            // UI display name (e.g., 'Field of View')
    type: ParameterType;
    default: any;                    // Default value

    // Constraints
    min?: number;                    // For numeric types
    max?: number;
    step?: number;                   // For discrete increments
    options?: any[];                 // For discrete choices (e.g., f-stops)

    // UI hints
    unit?: string;                   // Display unit (e.g., 'degrees', 'mm')
    uiHint?: 'slider' | 'input' | 'dropdown' | 'color-picker' | 'hidden';
    group?: string;                  // For UI organization (e.g., 'Lens', 'Exposure')

    // Behavior
    persistent?: boolean;            // Should this be saved/restored?
    resetAccumulation?: boolean;     // Should changes reset accumulation buffer?
}

// Read-only view of parameters for a specific namespace
export interface ParameterView {
    get(name: string): any;
    has(name: string): boolean;
    onChange(name: string, callback: (value: any, old: any) => void): void;
    offChange(name: string, callback: (value: any, old: any) => void): void;
}

// Extended Plugin interface
export interface Plugin {
    // Existing methods
    readonly role: Role;
    readonly namespace: string;
    uniforms(): UniformDecl[];
    chunks(): GLSLChunk[];

    //view should be a UniformManager
    applyUniforms?(view: any, ctx?: PipelineContext): void;
   // applyUniforms?(view: UniformManager, ctx?: PipelineContext): void;

    // New parameter system methods
    parameters?(): ParameterDescriptor[];
    applyParameters?(params: ParameterView, ctx?: PipelineContext): void;

    // For controls plugins
    update?(ctx: PipelineContext, dt: number): void;
}

