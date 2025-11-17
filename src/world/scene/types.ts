// Scene description types for SceneCompiler

import type { ParameterMetadata } from '../../engine/types';

export interface SceneDescription {
  objects: SimpleObject[];
  materials: Map<string, MaterialDescription>;
  parameters?: Record<string, ParameterMetadata>;  // Optional UI-controllable parameters
}

export interface SimpleObject {
  id: string;
  sdf: string;  // Raw GLSL expression
  material: string;  // Reference to material name
}

// Material property value: constant, parameter reference, or GLSL code
export type MaterialPropertyValue<T> =
  | T                      // Constant value
  | { param: string }      // Reference to UI parameter
  | { glsl: string }       // GLSL code snippet (can use 'p' for position)

export interface MaterialDescription {
  // Each property can be constant or reference a parameter
  albedo: MaterialPropertyValue<[number, number, number]>;
  roughness: MaterialPropertyValue<number>;
  metallic: MaterialPropertyValue<number>;
  ior: MaterialPropertyValue<number>;
  emission: MaterialPropertyValue<[number, number, number]>;
  emission_strength: MaterialPropertyValue<number>;
}
