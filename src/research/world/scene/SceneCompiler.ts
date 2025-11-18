import type { ModuleDescriptor, UniformBinding } from '../../../infrastructure/engine/types';
import type { SceneDescription, SimpleObject, MaterialDescription, MaterialPropertyValue } from './types';

/**
 * SceneCompiler transforms scene descriptions into optimized GLSL Scene modules.
 *
 * Generates:
 * - Object SDF functions
 * - Material dispatch
 * - Material property lookups (with uniform support)
 * - Ray intersection code
 * - Uniform bindings for parameters
 */
export class SceneCompiler {
  compile(scene: SceneDescription): ModuleDescriptor {
    // Build material ID mapping
    const materialIds = this.buildMaterialIds(scene.materials);

    // Analyze parameter usage (both explicit references and all scene parameters)
    const paramUsage = this.analyzeParameterUsage(scene.materials, scene.parameters || {});

    // Generate all code sections
    const constants = this.generateConstants(scene, materialIds);
    const uniforms = this.generateUniforms(paramUsage);
    const objectSDFs = this.generateObjectSDFs(scene.objects);
    const dispatch = this.generateDispatch(scene.objects, materialIds);
    const materialAt = this.generateMaterialAt(scene.objects, materialIds);
    const materialProps = this.generateMaterialProperties(scene.materials, materialIds, paramUsage);
    const intersection = this.generateIntersection();

    // Build uniform bindings
    const uniformBindings = this.generateUniformBindings(paramUsage, scene.parameters || {});

    return {
      id: { kind: 'scene', name: 'compiled-scene', version: '1.0.0' },
      fragment: {
        constants,
        uniforms: uniforms || undefined,
        functions: [
          objectSDFs,
          dispatch,
          materialAt,
          materialProps,
          intersection
        ].join('\n\n')
      },
      uniformBindings: uniformBindings.length > 0 ? uniformBindings : undefined,
      parameters: scene.parameters
    };
  }

  /**
   * Check if a property value is a parameter reference
   */
  private isParam<T>(value: MaterialPropertyValue<T>): value is { param: string } {
    return typeof value === 'object' && value !== null && 'param' in value;
  }

  /**
   * Check if a property value is procedural GLSL code
   */
  private isProcedural<T>(value: MaterialPropertyValue<T>): value is { glsl: string } {
    return typeof value === 'object' && value !== null && 'glsl' in value;
  }

  /**
   * Get uniform name for a parameter
   */
  private paramToUniform(paramPath: string): string {
    return 'u_scene_' + paramPath.replace(/\./g, '_');
  }

  /**
   * Analyze which parameters are used and their types
   * Includes both explicit parameter references AND all scene parameters
   * (for use in procedural GLSL code)
   */
  private analyzeParameterUsage(
    materials: Map<string, MaterialDescription>,
    parameters: Record<string, any>
  ): Map<string, 'vec3' | 'float'> {
    const usage = new Map<string, 'vec3' | 'float'>();

    // First, check for explicit parameter references in materials
    for (const [_, mat] of materials) {
      if (this.isParam(mat.albedo)) {
        usage.set(mat.albedo.param, 'vec3');
      }
      if (this.isParam(mat.emission)) {
        usage.set(mat.emission.param, 'vec3');
      }
      if (this.isParam(mat.roughness)) {
        usage.set(mat.roughness.param, 'float');
      }
      if (this.isParam(mat.metallic)) {
        usage.set(mat.metallic.param, 'float');
      }
      if (this.isParam(mat.ior)) {
        usage.set(mat.ior.param, 'float');
      }
      if (this.isParam(mat.emission_strength)) {
        usage.set(mat.emission_strength.param, 'float');
      }
    }

    // Second, add ALL scene parameters (for procedural GLSL usage)
    // Procedural code can reference any parameter via uniforms
    for (const [paramPath, paramMeta] of Object.entries(parameters)) {
      if (!usage.has(paramPath)) {
        // Infer type from parameter metadata
        const type = paramMeta.type;
        if (type === 'color' || type === 'vec3') {
          usage.set(paramPath, 'vec3');
        } else if (type === 'float' || type === 'int') {
          usage.set(paramPath, 'float');
        }
      }
    }

    return usage;
  }

  /**
   * Generate uniform declarations
   */
  private generateUniforms(paramUsage: Map<string, 'vec3' | 'float'>): string | null {
    if (paramUsage.size === 0) return null;

    const lines: string[] = [];
    for (const [paramPath, type] of paramUsage) {
      const uniformName = this.paramToUniform(paramPath);
      lines.push(`uniform ${type} ${uniformName};`);
    }

    return lines.join('\n');
  }

  /**
   * Generate uniform bindings
   */
  private generateUniformBindings(
    paramUsage: Map<string, 'vec3' | 'float'>,
    parameters: Record<string, any>
  ): UniformBinding[] {
    const bindings: UniformBinding[] = [];

    for (const [paramPath, type] of paramUsage) {
      const uniformName = this.paramToUniform(paramPath);
      const paramMeta = parameters[paramPath];
      const defaultValue = paramMeta?.default || (type === 'vec3' ? [1, 1, 1] : 1.0);

      bindings.push({
        uniform: uniformName,
        parameters: [paramPath],
        type: type,
        compute: (params) => params[paramPath] || defaultValue
      });
    }

    return bindings;
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
   * Requires full GLSL function definition with signature
   */
  private generateObjectSDFs(objects: SimpleObject[]): string {
    const functions = objects.map((obj) => {
      const funcName = `sdf_${this.sanitizeId(obj.id)}`;
      const trimmedSdf = obj.sdf.trim();

      // Parse full function definition (required!)
      const functionMatch = trimmedSdf.match(/^\s*float\s+(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*)\}\s*$/);

      if (!functionMatch) {
        throw new Error(
          `SDF for object "${obj.id}" must be a complete GLSL function.\n` +
          `Example: float sdf(vec3 p) { return length(p) - 1.0; }\n` +
          `Got: ${trimmedSdf.substring(0, 100)}...`
        );
      }

      const [, originalName, params, body] = functionMatch;

      return `
// ${obj.id}
float ${funcName}(${params}) {${body}}`.trim();
    });

    return '// ========== OBJECT SDFs ==========\n\n' + functions.join('\n\n');
  }

  /**
   * Generate dispatch function that finds closest SDF
   */
  private generateDispatch(objects: SimpleObject[], materialIds: Map<string, number>): string {
    const checks = objects.map((obj) => {
      const funcName = `sdf_${this.sanitizeId(obj.id)}`;
      const materialConst = `MATERIAL_${this.toConstantName(obj.material)}`;

      return `
  d = ${funcName}(p);
  if (d < min_d) {
    min_d = d;
    closest_material = ${materialConst};
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
   * Generate material classification (which material a point is inside)
   */
  private generateMaterialAt(objects: SimpleObject[], materialIds: Map<string, number>): string {
    const checks = objects.map((obj) => {
      const funcName = `sdf_${this.sanitizeId(obj.id)}`;
      const materialConst = `MATERIAL_${this.toConstantName(obj.material)}`;

      return `
  d = ${funcName}(p);
  if (d < 0.0 && -d > deepest) {
    deepest = -d;
    inside_material = ${materialConst};
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
   * Generate material properties lookup with procedural helper functions
   */
  private generateMaterialProperties(
    materials: Map<string, MaterialDescription>,
    materialIds: Map<string, number>,
    paramUsage: Map<string, 'vec3' | 'float'>
  ): string {
    // Generate helper functions for procedural materials
    const helperFunctions: string[] = [];

    for (const [name, mat] of materials) {
      const sanitizedName = this.sanitizeId(name);

      // Generate helper for albedo if procedural
      if (this.isProcedural(mat.albedo)) {
        helperFunctions.push(this.generateProceduralHelper(
          'vec3',
          `material_${sanitizedName}_albedo`,
          mat.albedo.glsl
        ));
      }

      // Generate helper for roughness if procedural
      if (this.isProcedural(mat.roughness)) {
        helperFunctions.push(this.generateProceduralHelper(
          'float',
          `material_${sanitizedName}_roughness`,
          mat.roughness.glsl
        ));
      }

      // Generate helper for metallic if procedural
      if (this.isProcedural(mat.metallic)) {
        helperFunctions.push(this.generateProceduralHelper(
          'float',
          `material_${sanitizedName}_metallic`,
          mat.metallic.glsl
        ));
      }

      // Generate helper for ior if procedural
      if (this.isProcedural(mat.ior)) {
        helperFunctions.push(this.generateProceduralHelper(
          'float',
          `material_${sanitizedName}_ior`,
          mat.ior.glsl
        ));
      }

      // Generate helper for emission if procedural
      if (this.isProcedural(mat.emission)) {
        helperFunctions.push(this.generateProceduralHelper(
          'vec3',
          `material_${sanitizedName}_emission`,
          mat.emission.glsl
        ));
      }

      // Generate helper for emission_strength if procedural
      if (this.isProcedural(mat.emission_strength)) {
        helperFunctions.push(this.generateProceduralHelper(
          'float',
          `material_${sanitizedName}_emission_strength`,
          mat.emission_strength.glsl
        ));
      }
    }

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
      const sanitizedName = this.sanitizeId(name);

      // Generate property assignments (constant, uniform, or procedural function call)
      const albedoValue = this.isProcedural(mat.albedo)
        ? `material_${sanitizedName}_albedo(p)`
        : this.isParam(mat.albedo)
        ? this.paramToUniform(mat.albedo.param)
        : `vec3(${mat.albedo.map(v => this.toGLSLFloat(v)).join(', ')})`;

      const roughnessValue = this.isProcedural(mat.roughness)
        ? `material_${sanitizedName}_roughness(p)`
        : this.isParam(mat.roughness)
        ? this.paramToUniform(mat.roughness.param)
        : this.toGLSLFloat(mat.roughness);

      const metallicValue = this.isProcedural(mat.metallic)
        ? `material_${sanitizedName}_metallic(p)`
        : this.isParam(mat.metallic)
        ? this.paramToUniform(mat.metallic.param)
        : this.toGLSLFloat(mat.metallic);

      const iorValue = this.isProcedural(mat.ior)
        ? `material_${sanitizedName}_ior(p)`
        : this.isParam(mat.ior)
        ? this.paramToUniform(mat.ior.param)
        : this.toGLSLFloat(mat.ior);

      const emissionValue = this.isProcedural(mat.emission)
        ? `material_${sanitizedName}_emission(p)`
        : this.isParam(mat.emission)
        ? this.paramToUniform(mat.emission.param)
        : `vec3(${mat.emission.map(v => this.toGLSLFloat(v)).join(', ')})`;

      const emissionStrengthValue = this.isProcedural(mat.emission_strength)
        ? `material_${sanitizedName}_emission_strength(p)`
        : this.isParam(mat.emission_strength)
        ? this.paramToUniform(mat.emission_strength.param)
        : this.toGLSLFloat(mat.emission_strength);

      cases.push(`
  else if (mat_id == ${constName}) {
    props.albedo = ${albedoValue};
    props.roughness = ${roughnessValue};
    props.metallic = ${metallicValue};
    props.ior = ${iorValue};
    props.emission = ${emissionValue};
    props.emission_strength = ${emissionStrengthValue};
    props.light_id = -1;  // No lights yet
  }`.trim());
    }

    const helperSection = helperFunctions.length > 0
      ? '// ========== PROCEDURAL MATERIAL HELPERS ==========\n\n' + helperFunctions.join('\n\n') + '\n\n'
      : '';

    return helperSection + `
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
   * Generate a procedural helper function
   * Requires full GLSL function definition with signature
   */
  private generateProceduralHelper(returnType: string, functionName: string, glslCode: string): string {
    const trimmedCode = glslCode.trim();

    // Parse full function definition (required!)
    const functionMatch = trimmedCode.match(/^\s*(float|vec3|vec2|vec4|int)\s+(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*)\}\s*$/);

    if (!functionMatch) {
      throw new Error(
        `Procedural GLSL code must be a complete function.\n` +
        `Expected: ${returnType} functionName(...) { ... }\n` +
        `Example: vec3 myColor(vec3 p) { return vec3(1.0, 0.0, 0.0); }\n` +
        `Got: ${trimmedCode.substring(0, 100)}...`
      );
    }

    const [, declaredReturnType, originalName, params, body] = functionMatch;

    // Validate return type matches expected
    if (declaredReturnType !== returnType) {
      throw new Error(
        `Procedural function has wrong return type.\n` +
        `Expected: ${returnType}\n` +
        `Got: ${declaredReturnType}\n` +
        `Function: ${originalName}`
      );
    }

    return `
${returnType} ${functionName}(${params}) {${body}}`.trim();
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
   * Utility: Convert name to CONSTANT_NAME format
   */
  private toConstantName(name: string): string {
    return name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  }

  /**
   * Utility: Sanitize ID for function names
   */
  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Utility: Ensure number is formatted as GLSL float
   */
  private toGLSLFloat(value: number): string {
    const str = value.toString();
    return str.includes('.') ? str : str + '.0';
  }
}
