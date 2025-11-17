// Scene description types for SceneCompiler

export interface SceneDescription {
  objects: SimpleObject[];
  materials: Map<string, MaterialDescription>;
}

export interface SimpleObject {
  id: string;
  sdf: string;  // Raw GLSL expression
  material: string;  // Reference to material name
}

export interface MaterialDescription {
  // All constant values for now
  albedo: [number, number, number];
  roughness: number;
  metallic: number;
  ior: number;
  emission: [number, number, number];
  emission_strength: number;
}
