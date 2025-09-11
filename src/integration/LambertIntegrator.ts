
import type { Plugin, GLSLChunk, Role, Stage, UniformSpec } from "../core/types";
import { ChunkNames } from "../core/types";

const SRC = /* glsl */`
// integrator.integrate — sphere tracing + Lambert + lightweight spec via material(p)

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

// NOTE: 'light_dir' uniform is declared by the assembler from UniformDecl

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
  vec3 L = normalize(light_dir);
  vec3 V = normalize(-ray.d);
  vec3 H = normalize(L + V);

  // Scene-provided material
  Material mat = material(p);

  // Diffuse (no 1/pi here; we’re illustrative not energy-correct)
  float ndotl = max(dot(n, L), 0.0);
  vec3 diffuse = (1.0 - mat.metalness) * mat.albedo * ndotl;

  // Specular (very lightweight): Schlick Fresnel * Blinn-Phong
  vec3  F0    = mix(vec3(0.04), mat.albedo, mat.metalness);
  float VoH   = max(dot(V, H), 0.0);
  vec3  F     = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);

  // Roughness → gloss exponent (heuristic)
  float gloss = mix(256.0, 8.0, mat.roughness); // low roughness → sharp lobe
  float ndoth = max(dot(n, H), 0.0);
  float specLobe = pow(ndoth, gloss);

  vec3 specular = F * specLobe * ndotl;

  // Ambient term
  vec3 ambient = 0.05 * mat.albedo;

  return ambient + diffuse + specular;
}
`;





export interface LambertOptions {
    lightDir?: [number, number, number];
    animate?: boolean;
    speed?: number;
    elevationY?: number;
}

export default class LambertIntegrator implements Plugin {
    readonly role: Role = "integrator";
    readonly namespace = "integrator.lambert";

    // Properties for state
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

    // Single method for uniforms
    getUniforms(): Record<string, UniformSpec> {
        let lightDir: [number, number, number];

        if (this.animate) {
            const t = (performance.now() - this.t0) * 0.001;
            const a = t * this.speed;
            lightDir = [
                Math.cos(a),
                this.elevationY,
                Math.sin(a)
            ];
        } else {
            lightDir = this.baseDir;
        }

        return {
            light_dir: { type: "vec3", value: lightDir }
        };
    }

    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";
        return [{
            name:   ChunkNames.IntegratorIntegrate,
            stage,
            source: SRC,  // Your GLSL source here
            deps: [
                ChunkNames.GeometryTypes,
                ChunkNames.GeometryOps,
                ChunkNames.CameraGenerateRay,
                ChunkNames.SceneSDF,
            ],
        }];
    }

    // Convenience methods for runtime control
    setAnimate(animate: boolean) {
        this.animate = animate;
        if (animate) {
            this.t0 = performance.now(); // Reset animation start time
        }
    }

    setLightDirection(x: number, y: number, z: number) {
        this.baseDir = [x, y, z];
    }

    setSpeed(speed: number) {
        this.speed = speed;
    }
}
