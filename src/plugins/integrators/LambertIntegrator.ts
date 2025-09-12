import type { Plugin, GLSLChunk, Role, Stage, UniformDecl } from "../../core/types";
import { ChunkNames } from "../../core/types";
import UniformManager from "../../systems/UniformManager";

const SRC = /* glsl */`
// integrator.integrate — sphere tracing + Lambert lighting driven by uniform light_dir
// NOTE: 'light_dir' is declared by the assembler from uniforms(); do not redeclare here.

// finite-difference normal from scene.sdf
vec3 estimateNormal(Point p){
  const float e = 1e-3;
  float dx = map(p + Point(e,0,0)) - map(p - Point(e,0,0));
  float dy = map(p + Point(0,e,0)) - map(p - Point(0,0,e));
  float dz = map(p + Point(0,0,e)) - map(p - Point(0,0,e));
  return normalize(vec3(dx, dy, dz));
}

vec3 sky(vec3 dir){
  float t = 0.5 * (dir.y + 1.0);
  return mix(vec3(0.7,0.8,1.0), vec3(0.4,0.6,1.0), t);
}

// DO NOT declare: uniform vec3 light_dir;  // assembler provides it

vec3 integrate(vec2 fragCoord){
  vec2 uv  = fragCoord / u_resolution;   // [0,1]^2
  Ray ray  = generateRay(uv);

  const float EPS  = 1e-3;
  const float TMIN = 1e-3;
  const float TMAX = 100.0;
  float t = 0.0;
  bool hit = false;

  // classic sphere tracing
  for (int i = 0; i < 128; ++i) {
    Point q = ray.o + ray.d * t;
    float d = map(q);
    if (d < EPS) {
      if (t > TMIN) { hit = true; break; }
      t += EPS;
    } else {
      t += d;
    }
    if (t > TMAX) break;
  }

  if (!hit) return sky(ray.d);

  Point p = ray.o + ray.d * t;
  vec3 n = estimateNormal(p);

  vec3 L = normalize(light_dir);  // <-- just use it
  float ndotl = max(dot(n, L), 0.0);

  vec3 base = vec3(0.8);
  vec3 ambient = vec3(0.1);
  return ambient + base * ndotl;
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
                ChunkNames.GeometryOps,
                ChunkNames.CameraGenerateRay,
                ChunkNames.SceneSDF,
            ],
        }];
    }

    applyUniforms(view: UniformManager) {
        let lx: number, ly: number, lz: number;

        if (this.animate) {
            const t = (performance.now() - this.t0) * 0.001; // seconds
            const a = t * this.speed;
            // rotate around Y; keep a stable elevation
            const r = 1.0;
            lx =  r * Math.cos(a);
            ly =  this.elevationY;
            lz =  r * Math.sin(a);
        } else {
            [lx, ly, lz] = this.baseDir;
        }

        // Set as-is; shader normalizes.
        view.set3f("light_dir", lx, ly, lz);
    }
}
