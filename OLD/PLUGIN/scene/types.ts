import type { GLSLChunk, Stage } from "../core/types";
import { ChunkNames } from "../core/types";

const stage: Stage = "frag";

export const SceneTypesChunk: GLSLChunk = {
    name:   ChunkNames.SceneTypes,
    stage,
    deps:   [],
    source: /* glsl */`
    // scene.types — shared scene-facing structs

    struct Hit {
      bool  hit;  // intersection found in [tMin, tMax]
      float t;    // affine parameter along the ray
      int   mat;  // material id for scene_material()
    };

    struct Material {
      vec3  baseColor;
      float roughness;   // [0,1]
      float metalness;   // [0,1]
      vec3  emission;    // radiance (can be 0)
    };
  `,
};
