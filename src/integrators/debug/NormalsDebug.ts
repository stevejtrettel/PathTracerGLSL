import type { GLSLChunk, Plugin, UniformDecl } from "../../core/types";
import { ChunkNames } from "../../core/types"; // adjust import path/name to your project

/**
 * One-shot normals visualizer.
 * - No integratorCaps(): progressive = false by default
 * - No history / RNG / accumulation
 * - Returns linear HDR in [0,1] from mapped normals
 */
export default class NormalsIntegrator implements Plugin {
    readonly role = "integrator" as const;
    readonly namespace = "integrator.normals";

    uniforms(): UniformDecl[] { return []; } // uses only reserved globals (u_resolution)

    chunks(): GLSLChunk[] {
        return [
            {
                name: ChunkNames.IntegratorIntegrate,
                stage: "frag",
                deps: [
                    ChunkNames.GeometryTypes,
                    ChunkNames.CameraGenerateRay,
                    // scene contracts
                    ChunkNames.SceneTypes,
                    ChunkNames.SceneIntersect,
                    ChunkNames.SceneNormal, // require a normal routine for now
                ],
                source: /* glsl */`
        // Expects:
        //   Ray generateRay(vec2 filmUV);
        //   Hit scene_intersect(Ray r, float tMin, float tMax);
        //   Dir scene_normal(Point p, Hit h);

        vec3 integrate(vec2 fragCoord){
          vec2 uv  = (fragCoord + 0.5) / u_resolution;
          Ray  ray = generateRay(uv);

          Hit h = scene_intersect(ray, 1e-3, 1e4);
          if (!h.hit) {
            // simple sky so the display stage has something sane
            return vec3(0.6, 0.8, 1.0);
          }

          Point p = ray.o + ray.d * h.t;
          Dir   n = scene_normal(p, h);

          // map [-1,1] -> [0,1] for visualization
          return 0.5 * (n + vec3(1.0));
        }`
            }
        ];
    }
}
