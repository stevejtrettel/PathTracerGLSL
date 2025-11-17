import type { ModuleDescriptor } from '../../engine/types';
import type { SceneDescription, SimpleObject, MaterialDescription } from './types';

/**
 * SceneCompiler transforms scene descriptions into optimized GLSL Scene modules.
 *
 * Generates:
 * - Object SDF functions
 * - Material dispatch
 * - Material property lookups
 * - Ray intersection code
 */
export class SceneCompiler {
  compile(scene: SceneDescription): ModuleDescriptor {
    // Build material ID mapping
    const materialIds = this.buildMaterialIds(scene.materials);

    // Generate all code sections
    const constants = this.generateConstants(scene, materialIds);
    const objectSDFs = this.generateObjectSDFs(scene.objects);
    const dispatch = this.generateDispatch(scene.objects, materialIds);
    const materialAt = this.generateMaterialAt(scene.objects, materialIds);
    const materialProps = this.generateMaterialProperties(scene.materials, materialIds);
    const intersection = this.generateIntersection();

    return {
      id: { kind: 'scene', name: 'compiled-scene', version: '1.0.0' },
      fragment: {
        constants,
        functions: [
          objectSDFs,
          dispatch,
          materialAt,
          materialProps,
          intersection
        ].join('\n\n')
      }
    };
  }

  /**
   * Build material ID mapping
   * AIR is always ID 0, user materials start at 1
   */
  private buildMaterialIds(materials: Map<string, MaterialDescription>): Map<string, number> {
    const ids = new Map<string, number>();
    ids.set('air', 0);

    let nextId = 1;
    for (const [name] of materials) {
      ids.set(name, nextId++);
    }

    return ids;
  }

  /**
   * Generate #define constants
   */
  private generateConstants(scene: SceneDescription, materialIds: Map<string, number>): string {
    const lines = [
      `#define NUM_OBJECTS ${scene.objects.length}`,
      `#define NUM_MATERIALS ${materialIds.size}`,
      `#define MATERIAL_AIR 0`,
      `#define MAX_MARCH_STEPS 256`,
      `#define MARCH_EPSILON 0.0001`
    ];

    for (const [name, id] of materialIds) {
      if (name !== 'air') {
        const constName = `MATERIAL_${this.toConstantName(name)}`;
        lines.push(`#define ${constName} ${id}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate individual SDF functions for each object
   */
  private generateObjectSDFs(objects: SimpleObject[]): string {
    const functions = objects.map((obj) => {
      const funcName = `sdf_${this.sanitizeId(obj.id)}`;

      return `
// ${obj.id}
float ${funcName}(vec3 p) {
  return ${obj.sdf};
}`.trim();
    });

    return '// ========== OBJECT SDFs ==========\n\n' + functions.join('\n\n');
  }

  /**
   * Generate dispatch function that finds closest SDF
   */
  private generateDispatch(objects: SimpleObject[], materialIds: Map<string, number>): string {
    const checks = objects.map((obj) => {
      const funcName = `sdf_${this.sanitizeId(obj.id)}`;
      const constName = `MATERIAL_${this.toConstantName(obj.material)}`;

      return `
  d = ${funcName}(p);
  if (d < min_d) {
    min_d = d;
    closest_material = ${constName};
  }`.trim();
    });

    return `
// ========== DISPATCH ==========

float dispatch_sdf(vec3 p, out int closest_material) {
  float min_d = 1e10;
  float d;

  ${checks.join('\n\n  ')}

  return min_d;
}`.trim();
  }

  /**
   * Generate material classification (which material at point p)
   */
  private generateMaterialAt(objects: SimpleObject[], materialIds: Map<string, number>): string {
    const checks = objects.map((obj) => {
      const funcName = `sdf_${this.sanitizeId(obj.id)}`;
      const constName = `MATERIAL_${this.toConstantName(obj.material)}`;

      return `
  d = ${funcName}(p);
  if (d < 0.0 && -d > deepest) {
    deepest = -d;
    inside_material = ${constName};
  }`.trim();
    });

    return `
// ========== MATERIAL CLASSIFICATION ==========

int scene_material_at(vec3 p) {
  int inside_material = MATERIAL_AIR;
  float deepest = 0.0;
  float d;

  ${checks.join('\n\n  ')}

  return inside_material;
}`.trim();
  }

  /**
   * Generate material properties lookup
   */
  private generateMaterialProperties(
    materials: Map<string, MaterialDescription>,
    materialIds: Map<string, number>
  ): string {
    const cases: string[] = [];

    // Air case
    cases.push(`
  if (mat_id == MATERIAL_AIR) {
    props.albedo = vec3(0.0);
    props.roughness = 0.0;
    props.metallic = 0.0;
    props.ior = 1.0;
    props.emission = vec3(0.0);
    props.emission_strength = 0.0;
    props.light_id = -1;
  }`.trim());

    // Each material
    for (const [name, mat] of materials) {
      const constName = `MATERIAL_${this.toConstantName(name)}`;

      cases.push(`
  else if (mat_id == ${constName}) {
    props.albedo = vec3(${mat.albedo.map(v => this.toGLSLFloat(v)).join(', ')});
    props.roughness = ${this.toGLSLFloat(mat.roughness)};
    props.metallic = ${this.toGLSLFloat(mat.metallic)};
    props.ior = ${this.toGLSLFloat(mat.ior)};
    props.emission = vec3(${mat.emission.map(v => this.toGLSLFloat(v)).join(', ')});
    props.emission_strength = ${this.toGLSLFloat(mat.emission_strength)};
    props.light_id = -1;  // No lights yet
  }`.trim());
    }

    return `
// ========== MATERIAL PROPERTIES ==========

MaterialProperties scene_material_properties(int mat_id, Point p) {
  MaterialProperties props;

  // Default initialization
  props.albedo = vec3(1.0, 0.0, 1.0);  // Magenta = error color
  props.roughness = 0.8;
  props.metallic = 0.0;
  props.ior = 1.5;
  props.emission = vec3(0.0);
  props.emission_strength = 0.0;
  props.light_id = -1;

  ${cases.join('\n  ')}

  return props;
}`.trim();
  }

  /**
   * Generate intersection functions (boilerplate, same for all scenes)
   */
  private generateIntersection(): string {
    return `
// ========== INTERSECTION ==========

vec3 scene_normal(vec3 p) {
  int dummy_mat;
  const vec2 e = vec2(0.001, 0.0);

  vec3 n = vec3(
    dispatch_sdf(p + e.xyy, dummy_mat) - dispatch_sdf(p - e.xyy, dummy_mat),
    dispatch_sdf(p + e.yxy, dummy_mat) - dispatch_sdf(p - e.yxy, dummy_mat),
    dispatch_sdf(p + e.yyx, dummy_mat) - dispatch_sdf(p - e.yyx, dummy_mat)
  );

  return normalize(n);
}

bool scene_intersect(Ray ray, out Hit hit) {
  float t = ray.tmin;
  int material = MATERIAL_AIR;

  for (int step = 0; step < MAX_MARCH_STEPS; step++) {
    vec3 p = ambient_geodesic(ray.origin, ray.direction, t);

    float d = dispatch_sdf(p, material);

    if (d < MARCH_EPSILON) {
      // Hit detected
      hit.t = t;
      hit.p = p;
      hit.n = scene_normal(p);
      hit.uv = vec2(p.x * 0.1, p.z * 0.1);

      // Material interface (simple: always from air)
      hit.material_from = MATERIAL_AIR;
      hit.material_to = material;

      // Build frame for shading
      hit.frame = ambient_frame(hit.p, hit.n);

      return true;
    }

    if (t > ray.tmax) break;

    t += d * 0.9;
  }

  return false;
}

bool scene_intersect_any(Ray ray, float max_distance) {
  float t = ray.tmin;
  int dummy_mat;

  for (int step = 0; step < MAX_MARCH_STEPS; step++) {
    vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
    float d = dispatch_sdf(p, dummy_mat);

    if (d < MARCH_EPSILON) return true;
    if (t > min(ray.tmax, max_distance)) break;

    t += d * 0.95;
  }

  return false;
}`.trim();
  }

  /**
   * Sanitize object ID for use in function names
   * "red sphere" -> "red_sphere"
   * "Red-Sphere" -> "red_sphere"
   */
  private sanitizeId(id: string): string {
    return id.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  }

  /**
   * Convert material name to constant name
   * "red_diffuse" -> "RED_DIFFUSE"
   */
  private toConstantName(name: string): string {
    return name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  }

  /**
   * Format a number as a GLSL float literal
   * Ensures numbers have decimal point (0 -> 0.0)
   */
  private toGLSLFloat(value: number): string {
    const str = value.toString();
    // If no decimal point, add .0
    return str.includes('.') ? str : str + '.0';
  }
}
