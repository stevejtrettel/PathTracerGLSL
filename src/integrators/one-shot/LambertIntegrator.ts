// src/plugins/integrators/LambertIntegrator.ts
import type { Plugin, GLSLChunk, Role, Stage, UniformDecl } from "../../core/types";
import { ChunkNames } from "../../core/types";
import UniformManager from "../../systems/UniformManager";

export interface LambertOptions {
    lightDir?: [number, number, number];  // default [0.5,1,0.3]
}

export default class LambertIntegrator implements Plugin {
    readonly role: Role = "integrator";
    readonly namespace = "integrator.lambert";

    private baseDir: [number, number, number];

    constructor(opts: LambertOptions = {}) {
        this.baseDir = opts.lightDir ?? [0.5, 1.0, 0.3];
    }

    uniforms(): UniformDecl[] {
        return [{ name: "light_dir", type: "vec3" }];
    }

    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";
        const source = /* glsl */`
    // One-shot Lambert + tiny Blinn-Phong highlight (demo energy, not physical)

    vec3 sky_inline(vec3 dir){
      float t = 0.5 * (dir.y + 1.0);
      return mix(vec3(0.7,0.8,1.0), vec3(0.4,0.6,1.0), t);
    }

    vec3 integrate(vec2 fragCoord){
      vec2 uv  = (fragCoord + 0.5) / u_resolution;
      Ray  ray = generateRay(uv);

      Hit h = scene_intersect(ray, 0.001, 10000.0);
      if (!h.hit) return sky_inline(ray.d);

      Point    p = ray.o + ray.d * h.t;
      Dir      n = scene_normal(p, h);
      Material m = scene_material(h.mat);

      vec3 L = normalize(light_dir);          // uniform from TS
      vec3 V = normalize(ray.o - p);
      vec3 H = normalize(L + V);

      float NdotL = max(dot(n, L), 0.0);     // plain Euclidean ops for safety
      vec3  diffuse = m.baseColor * NdotL;

      float shin    = mix(8.0, 256.0, 1.0 - m.roughness);
      float specF0  = mix(0.04, 1.0, m.metalness);
      float spec    = pow(max(dot(n, H), 0.0), shin);
      vec3  specCol = mix(vec3(specF0), m.baseColor, m.metalness) * spec;

      vec3 ambient  = 0.1 * m.baseColor;
      vec3 col = ambient + diffuse + specCol + m.emission; // linear HDR
      return postprocess(col);
    }`;

        return [{
            name:   ChunkNames.IntegratorIntegrate,
            stage,
            source,
            deps: [
                ChunkNames.GeometryTypes,
                ChunkNames.CameraGenerateRay,
                ChunkNames.SceneTypes,
                ChunkNames.SceneIntersect,
                ChunkNames.SceneNormal,
                ChunkNames.SceneMaterial,
                ChunkNames.PostprocessApply,//so we can do postprocessing right in the integrator
            ],
        }];
    }

    applyUniforms(view: UniformManager) {
        const [lx, ly, lz] = this.baseDir;
        view.set3f("light_dir", lx, ly, lz);
    }
}
