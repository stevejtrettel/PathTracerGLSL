import type { Plugin, GLSLChunk, Role, Stage } from "../../core/types";
import { ChunkNames } from "../../core/types";

const SCENE_SRC = /* glsl */`
// scene.sdf — demo scene: sphere over ground plane

// Distance helpers in Euclidean space
float sdfSphere(Point p, float r) { return length(p) - r; }
float sdfPlaneY(Point p) { return p.y; } // plane y=0

// Scene map: min-combine primitives
float map(Point p) {
  float sphere = sdfSphere(p - Point(0.0, 1.0, 0.0), 1.0);
  float ground = sdfPlaneY(p);
  return min(sphere, ground);
}
`;

export default class SceneSDFDemoPlugin implements Plugin {
    readonly role: Role = "lib";        // pure library provider
    readonly namespace = "scene.demo";

    uniforms() { return []; }

    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";
        return [{
            name:   ChunkNames.SceneSDF,
            stage,
            source: SCENE_SRC,
            deps:   [ChunkNames.GeometryTypes], // uses Point
        }];
    }
}
