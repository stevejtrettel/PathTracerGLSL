// compiler/plan/types.ts

import type { MaterialModel } from '../types.js';
import type { SceneFeatures } from '../analyze/types.js';

/**
 * Resolved SDF object for code generation.
 * All parameters are concrete numbers ready to bake into GLSL.
 */
export interface PlannedSDFObject {
    index: number;
    materialId: number;
    sdfType: 'sphere' | 'plane' | 'box' | 'torus' | 'capsule';
    parameters: Record<string, number | number[]>;
}

/**
 * Resolved material for code generation.
 * Each property is either a constant value or a GLSL expression string.
 */
export interface PlannedMaterial {
    id: number;
    name: string;
    model: MaterialModel;
    albedo: number[] | string;
    emission: number[] | string;
    roughness: number | string;
}

/**
 * Resolved light for code generation.
 */
export interface PlannedLight {
    id: number;
    kind: 'point' | 'directional';
    position?: number[];
    direction?: number[];
    intensity: number;
    color: number[];
}

/**
 * Uniform required by the generated shader.
 */
export interface PlannedUniform {
    name: string;
    type: 'float' | 'int' | 'vec2' | 'vec3' | 'vec4' | 'mat4' | 'sampler2D';
    parameterPath: string;
    default?: any;
}

/**
 * Complete render plan — everything the Generator needs to emit code.
 */
export interface RenderPlan {
    features: SceneFeatures;

    objects: PlannedSDFObject[];
    materials: PlannedMaterial[];
    lights: PlannedLight[];

    /** Which BRDF models to include */
    brdfModels: Set<MaterialModel>;

    /** Whether to emit NEE (next event estimation) code */
    emitNEE: boolean;

    /** Whether to emit Russian roulette code */
    emitRussianRoulette: boolean;
    russianRouletteStartDepth: number;

    /** Max path bounces */
    maxBounces: number;

    /** Whether to unroll SDF dispatch (vs loop) */
    unrollSDFDispatch: boolean;

    /** Uniforms the shader needs */
    uniforms: PlannedUniform[];
}
