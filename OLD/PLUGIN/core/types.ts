
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



// 1) Role: add "scene"
export type Role =
    | "geometry"
    | "camera"
    | "integrator"
    | "postprocess"
    | "scene"        // <— new
    | "controls"
    | "lib";




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


/**
 * Recommended contract names (engine will look for exactly one of each at link time):
 * - Camera must provide:   "camera.generateRay"   -> Ray generateRay(vec2 filmUV);
 * - Integrator must provide:"integrator.integrate"-> vec3 integrate(vec2 fragCoord);
 * - Display must provide:  "postprocess.postprocess"      -> vec3 postprocess(vec3 hdr);
 */
// 2) Chunk names: add scene-related constants
export const ChunkNames = {
    // existing …
    GeometryTypes:       "geometry.types",
    GeometryOps:         "geometry.ops",
    CameraGenerateRay:   "camera.generateRay",
    IntegratorIntegrate: "integrator.integrate",
    PostprocessApply:    "postprocess.apply",    // NEW: postprocess - replaces postprocess


    // new (Phase 1 prelude + future scene contract)
    SceneTypes:          "scene.types",          // <— new (this phase)
    SceneIntersect:      "scene.intersect",      // future (Phase 3+)
    SceneMaterial:       "scene.material",       // future (Phase 3+)
    SceneNormal:         "scene.normal",         // optional
    // SceneBounds:         "scene.bounds",         // optional
    // SceneSignedDistance: "scene.signedDistance", // optional/future
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
    displayName?: string;            // UI postprocess name (e.g., 'Field of View')
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








// types for integrators

export type Lifetime = "perFrame" | "history";

export type TargetFormat = "rgba16f" | "rg16f" | "r16f" | "rgba8" | "r32f";

export interface TargetDesc {
    name: string;                 // logical name, e.g. "albedo", "moments"
    format: TargetFormat;
    filtering?: "nearest" | "linear";
    lifetime: Lifetime;           // cleared per-frame or persisted
}

export interface IntegratorCaps {
    progressive?: boolean;        // default: false
    rng?: "hash" | "sobol" | "pmj" | "blueNoise" | "custom";
    accumulation?: "none" | "box" | "ema" | "custom";
    extraTargets?: TargetDesc[];  // optional AOVs (MRT)
    historyCompatHash?: string;   // bump to reset history on incompatible changes
    // optional hints (do not force behavior)
    needsNormals?: "required" | "optional";
    maxRayT?: number;
    rngSeedPolicy?: "frameIndex" | "sampleCount" | "explicit";
}

// Optional compile-time guard rails
export function validateCaps(c: IntegratorCaps, maxMRT: number): void {
    if (c.progressive && !c.accumulation && !c.extraTargets?.length) {
        console.warn("[caps] Progressive set, but no accumulation/targets specified.");
    }
    if ((c.extraTargets?.length ?? 0) > Math.max(0, maxMRT - 1)) {
        throw new Error(`[caps] Too many color attachments requested: ${c.extraTargets?.length}`);
    }
}
