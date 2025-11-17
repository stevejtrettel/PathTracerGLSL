/**
 * Types for lighting descriptions
 * Similar to scene descriptions, but for light sources
 */

export type vec3 = [number, number, number];

// ============================================
// Individual Light Types
// ============================================

/**
 * Point light - omnidirectional light source at a single point
 */
export interface PointLight {
  type: 'point';
  id: string;
  position: vec3;
  color: vec3;
  intensity: number;
}

/**
 * Sphere light - area light with spherical shape
 */
export interface SphereLight {
  type: 'sphere';
  id: string;
  position: vec3;
  radius: number;
  color: vec3;
  intensity: number;
}

/**
 * Quad light - rectangular area light
 */
export interface QuadLight {
  type: 'quad';
  id: string;
  center: vec3;
  width: number;
  height: number;
  direction1: vec3;  // Width direction (will be normalized)
  direction2: vec3;  // Height direction (will be normalized)
  color: vec3;
  intensity: number;
}

/**
 * Union type for all light types
 */
export type Light = PointLight | SphereLight | QuadLight;

// ============================================
// Scene Lighting Description
// ============================================

/**
 * Environment map configuration
 */
export interface EnvironmentDescription {
  type: 'constant' | 'hdri';
  color?: vec3;      // For constant environments
  intensity?: number;
  hdriPath?: string; // For HDRI environments
}

/**
 * Complete lighting description for a scene
 * Contains all explicit lights plus environment
 *
 * Note: Emissive materials will be added by WorldCompiler
 */
export interface LightingDescription {
  lights: Light[];
  environment?: EnvironmentDescription;
}

// ============================================
// Compiler Internal Types
// ============================================

/**
 * Sampling strategy for a light
 */
export type LightSampling =
  | { type: 'point'; position: vec3 }
  | { type: 'sphere'; position: vec3; radius: number }
  | { type: 'quad'; center: vec3; edge1: vec3; edge2: vec3 }
  | null;  // null = path-only (cannot be sampled)

/**
 * Light source as used by the compiler
 * This is the internal representation after processing
 */
export interface CompilerLight {
  id: string;
  radiance: vec3;  // color * intensity
  sampling: LightSampling;
  source: 'explicit_light' | 'emissive_material' | 'visible_light';
}

/**
 * Parameter metadata for UI generation
 */
export interface ParameterMetadata {
  type: 'float' | 'int' | 'vec3' | 'color';
  default: number | vec3;
  range?: [number, number];
  step?: number;
  name?: string;
  help?: string;
  group?: string;
}
