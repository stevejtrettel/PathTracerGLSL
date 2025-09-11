import type { Plugin, GLSLChunk, Role, Stage, UniformSpec } from "../core/types";
import { ChunkNames } from "../core/types";

export interface SceneSDFOptions {
    sphereColor?:     [number, number, number]; // default [0.8, 0.3, 0.3]
    planeColor?:      [number, number, number]; // default [0.4, 0.45, 0.5]
    sphereMetalness?: number;                   // default 0.0 (dielectric)
    planeMetalness?:  number;                   // default 0.0
    sphereRoughness?: number;                   // default 0.3  (glossy to matte)
    planeRoughness?:  number;                   // default 0.8
}

/** Demo scene: sphere over ground plane, with per-primitive albedo + material() */
export default class SceneSDFDemoPlugin implements Plugin {
    readonly role: Role = "lib";
    readonly namespace = "scene.demo";

    // Properties for easy updates
    sphereC: [number, number, number];
    planeC:  [number, number, number];
    sphereM: number;
    planeM:  number;
    sphereR: number;
    planeR:  number;

    constructor(opts: SceneSDFOptions = {}) {
        this.sphereC = opts.sphereColor     ?? [0.8, 0.3, 0.3];
        this.planeC  = opts.planeColor      ?? [0.4, 0.45, 0.5];
        this.sphereM = opts.sphereMetalness ?? 0.0;
        this.planeM  = opts.planeMetalness  ?? 0.0;
        this.sphereR = opts.sphereRoughness ?? 0.3;
        this.planeR  = opts.planeRoughness  ?? 0.8;
    }

    // Single method for uniforms
    getUniforms(): Record<string, UniformSpec> {
        return {
            sphereColor:     { type: "vec3", value: this.sphereC },
            planeColor:      { type: "vec3", value: this.planeC },
            sphereMetalness: { type: "float", value: this.sphereM },
            planeMetalness:  { type: "float", value: this.planeM },
            sphereRoughness: { type: "float", value: this.sphereR },
            planeRoughness:  { type: "float", value: this.planeR }
        };
    }

    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";
        const SRC = /* glsl */`
// scene.sdf — demo scene with per-primitive albedo() and material()

// Distance helpers in Euclidean space
float sdfSphere(Point p, float r) { return length(p) - r; }
float sdfPlaneY(Point p) { return p.y; } // plane y=0

// Canonical scene SDF: min-combine primitives (unchanged)
float map(Point p) {
  float dSphere = sdfSphere(p - Point(0.0, 1.0, 0.0), 1.0);
  float dPlane  = sdfPlaneY(p);
  return min(dSphere, dPlane);
}

// Per-primitive base color at point p (unchanged from prior step)
vec3 albedo(Point p) {
  float dSphere = sdfSphere(p - Point(0.0, 1.0, 0.0), 1.0);
  float dPlane  = sdfPlaneY(p);
  return (dSphere < dPlane) ? sphereColor : planeColor;
}

// New: simple material model
struct Material {
  vec3  albedo;
  float metalness;
  float roughness;
};

// Choose closest primitive's material. Clamp roughness to [0.04, 1] for stability.
Material material(Point p) {
  float dSphere = sdfSphere(p - Point(0.0, 1.0, 0.0), 1.0);
  float dPlane  = sdfPlaneY(p);
  bool sphereCloser = (dSphere < dPlane);

  vec3  a = sphereCloser ? sphereColor     : planeColor;
  float m = sphereCloser ? sphereMetalness : planeMetalness;
  float r = sphereCloser ? sphereRoughness : planeRoughness;
  r = clamp(r, 0.04, 1.0);

  return Material(a, m, r);
}
`;
        return [{
            name:   ChunkNames.SceneSDF,
            stage,
            source: SRC,
            deps:   [ChunkNames.GeometryTypes], // uses Point
        }];
    }

    // Convenience methods for runtime updates
    setSphereColor(r: number, g: number, b: number) {
        this.sphereC = [r, g, b];
    }

    setPlaneColor(r: number, g: number, b: number) {
        this.planeC = [r, g, b];
    }

    setSphereMetalness(m: number) {
        this.sphereM = m;
    }

    setSphereMaterial(metalness: number, roughness: number) {
        this.sphereM = metalness;
        this.sphereR = roughness;
    }
}
