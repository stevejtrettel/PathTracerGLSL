// compiler/plan/types.ts

import type { MaterialModel, Vec3, GlslExpression, FramebufferFormat } from '../types.js';
import type { SceneFeatures } from '../analyze/types.js';

// ============================================================================
// Program Description — what the generated program does
// ============================================================================

/**
 * Describes the structure and capabilities of the GPU program to generate.
 * The Planner builds this from scene features + render strategy.
 * The Generator reads it to decide what code to produce.
 */
export interface ProgramDescription {
    intersection: IntersectionDesc;
    materials: MaterialsDesc;
    lighting: LightingDesc | null;
    camera: CameraDesc;
    transport: TransportDesc;
    accumulation: AccumulationDesc;
    tonemap: TonemapDesc;
}

export type IntersectionDesc =
    | { method: 'raymarch' };

export interface MaterialsDesc {
    models: MaterialModel[];
}

export type LightingDesc =
    | { method: 'nee' };

export type CameraDesc =
    | { type: 'pinhole'; fov: number };

export type TransportDesc =
    | { type: 'pathtracer'; maxBounces: number; russianRoulette: { startDepth: number } | null };

export type AccumulationDesc =
    | { type: 'average' }
    | { type: 'exponential'; alpha: number }
    | { type: 'variance' };

export type TonemapDesc =
    | { type: 'reinhard'; exposure?: number }
    | { type: 'aces'; exposure?: number }
    | { type: 'filmic'; exposure?: number }
    | { type: 'none' };

// ============================================================================
// Planned Pipeline — how the GPU program executes
// ============================================================================

export interface PlannedPipeline {
    framebuffers: Array<{ id: string; type: 'screen' | 'double_buffer' | 'texture'; format?: FramebufferFormat }>;
    passes: Array<{ role: string; inputs: Record<string, string>; output: string }>;
    swaps: Array<{ buffers: string[] }>;
}

/**
 * Resolved SDF object for code generation.
 * All parameters are concrete numbers ready to bake into GLSL.
 */
export interface PlannedSDFObject {
    index: number;
    materialId: number;
    sdfType: 'sphere' | 'plane' | 'box' | 'torus' | 'capsule';
    parameters: Record<string, number | number[]>;
    translation?: Vec3;
}

/**
 * Resolved material for code generation.
 * Each property is either a constant value or a GLSL expression string.
 */
export interface PlannedMaterial {
    id: number;
    name: string;
    model: MaterialModel;
    albedo: Vec3 | GlslExpression;
    emission: Vec3 | GlslExpression;
    roughness: number | GlslExpression;
}

/**
 * Resolved light for code generation.
 */
export interface PlannedLight {
    id: number;
    kind: 'point' | 'directional';
    position?: Vec3;
    direction?: Vec3;
    intensity: number;
    color: Vec3;
}

/**
 * Uniform required by the generated shader.
 */
export interface PlannedUniform {
    name: string;
    type: 'float' | 'int' | 'vec2' | 'vec3' | 'vec4' | 'mat4' | 'sampler2D';
    parameterPath: string;
    default?: number | number[];
}

/**
 * Complete render plan — everything the Generator needs to emit code.
 */
export interface RenderPlan {
    features: SceneFeatures;

    /** Resolved scene data for code generators */
    objects: PlannedSDFObject[];
    materials: PlannedMaterial[];
    lights: PlannedLight[];

    /** What the generated program does */
    program: ProgramDescription;

    /** How the GPU program executes */
    pipeline: PlannedPipeline;

    /** Uniforms derived from program description */
    uniforms: PlannedUniform[];
}
