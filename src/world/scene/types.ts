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

// Material property value: either a constant or a parameter reference
export type MaterialPropertyValue<T> = T | { param: string };

export interface MaterialDescription {
  // Each property can be constant or reference a parameter
  albedo: MaterialPropertyValue<[number, number, number]>;
  roughness: MaterialPropertyValue<number>;
  metallic: MaterialPropertyValue<number>;
  ior: MaterialPropertyValue<number>;
  emission: MaterialPropertyValue<[number, number, number]>;
  emission_strength: MaterialPropertyValue<number>;
}
