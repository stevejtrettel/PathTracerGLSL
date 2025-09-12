// src/plugins/integrators/LambertIntegrator.ts
import type { Plugin, GLSLChunk, Role, Stage, UniformDecl } from "../../core/types";
import { ChunkNames } from "../../core/types";
import UniformManager from "../../systems/UniformManager";

const SRC = /* glsl */`
// integrator.integrate — ray/scene intersect + simple Lambert + tiny spec

// Sky gradient
vec3 sky(vec3 dir){
  float t = 0.5 * (dir.y + 1.0);
  return mix(vec3(0.7,0.8,1.0), vec3(0.4,0.6,1.0), t);
}

// NOTE: 'light_dir' is a uniform provided by uniforms(); do NOT redeclare it here.

vec3 integrate(vec2 fragCoord){
  // film coords → primary ray
  vec2 uv  = (fragCoord + 0.5) / u_resolution;  // [0,1]^2
  Ray  ray = generateRay(uv);

  // intersect scene
  const float TMIN = 1e-3;
  const float TMAX = 100.0;
  Hit h = scene_intersect(ray, TMIN, TMAX);
  if (!h.hit) return sky(ray.d);

  // shading point & data
  Point    p = ray.o + ray.d * h.t;
  Dir      n = scene_normal(p, h);
  Material m = scene_material(h.mat);

  // lighting (single directional)
  vec3  L = normalize(light_dir);   // provided by TS side
  vec3  V = normalize(ray.o - p);
  float NdotL = max(dot(n, L), 0.0);

  // lambert
  vec3 diffuse = m.baseColor * NdotL;

  // tiny Blinn-Phong specular for a highlight; energy-not-physical (demo only)
  vec3  H     = normalize(L + V);
  float shin  = mix(8.0, 256.0, 1.0 - m.roughness);
  float specF0 = mix(0.04, 1.0, m.metalness);   // crude F0 blend
  float spec  = pow(max(dot(n, H), 0.0), shin);
  vec3  specCol = mix(vec3(specF0), m.baseColor, m.metalness) * spec;

  // emission from material
  vec3 emission = m.emission;

  // ambient term (cheap fill)
  vec3 ambient = 0.1 * m.baseColor;



  return ambient + diffuse + specCol + emission;
}
`;

export interface LambertOptions {
    /** Static light direction (world-space). Default: [0.5, 1, 0.3]. */
    lightDir?: [number, number, number];
    /** Animate light around the Y axis (overrides static dir when true). */
    animate?: boolean;
    /** Angular speed in radians/sec when animate=true. Default: 0.5. */
    speed?: number;
    /** Elevation for animated light (y component). Default: 0.6. */
    elevationY?: number;
}

export default class LambertIntegrator implements Plugin {
    readonly role: Role = "integrator";
    readonly namespace = "integrator.lambert";

    private animate: boolean;
    private speed: number;
    private elevationY: number;
    private baseDir: [number, number, number];
    private t0 = performance.now();

    constructor(opts: LambertOptions = {}) {
        this.baseDir = opts.lightDir ?? [0.5, 1.0, 0.3];
        this.animate = !!opts.animate;
        this.speed = opts.speed ?? 0.5;
        this.elevationY = opts.elevationY ?? 0.6;
    }

    uniforms(): UniformDecl[] {
        return [{ name: "light_dir", type: "vec3" }];
    }

    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";
        return [{
            name:   ChunkNames.IntegratorIntegrate,
            stage,
            source: SRC,
            deps: [
                ChunkNames.GeometryTypes,
                ChunkNames.CameraGenerateRay,
                ChunkNames.SceneTypes,      // ← add this
                ChunkNames.SceneIntersect,
                ChunkNames.SceneNormal,
                ChunkNames.SceneMaterial,
            ],
        }];
    }

    applyUniforms(view: UniformManager) {
        let lx: number, ly: number, lz: number;

        if (this.animate) {
            const t = (performance.now() - this.t0) * 0.001; // seconds
            const a = t * this.speed;
            const r = 1.0;
            lx =  r * Math.cos(a);
            ly =  this.elevationY;
            lz =  r * Math.sin(a);
        } else {
            [lx, ly, lz] = this.baseDir;
        }

        view.set3f("light_dir", lx, ly, lz);
    }
}
