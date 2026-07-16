# Scene Graph Transforms and Geometry Lowering

**Status:** SUPERSEDED by [fable-transforms.md](fable-transforms.md) (owner-approved July 15 2026).
Kept for history. Key departures: the internal representation is a closed-form Euclidean
similarity (s>0), not an affine Mat4 — reflections and nonuniform scale are excluded at the
type level, so the inverse-transpose/normal machinery and the §10.3 SVD-bound problem do not
exist; constant analytic transforms fold into primitive parameters (the current primitive set
is similarity-closed) instead of local-ray wrappers; driven (uniform-controlled) transforms
and the light/power-CDF constraints are designed in fable-transforms.md §6.

**Original status:** design proposal; not yet implemented  
**Scope:** a uniform transform system for SDF, analytic, and future mesh geometry  
**Primary goal:** allow a future Three.js-like scene description to contain nested groups whose transforms cascade to leaf objects, while compiling those groups away into optimized, flat GLSL

## 1. Motivation

Geometry backends should not invent separate placement rules.

An SDF sphere, analytic sphere, and mesh instance should all have the same scene-level meaning:

1. The primitive is defined in its own local object space.
2. The object has a local transform relative to its parent.
3. Parent transforms cascade through nested groups.
4. The compiler resolves the hierarchy into one final transform for each leaf object.
5. Each geometry backend lowers that transform according to its own intersection mathematics.

The current compiler does not yet have this uniformity. SDF translation is represented by transforming the query point, while analytic translation can be folded into primitive parameters such as a sphere center or quad corner. That solves individual placement bugs, but it is not a durable representation for rotations, scaling, groups, meshes, or instancing.

The intended invariant is:

> Every primitive remains in local object space. Every planned object carries a compiled local-to-world transform, regardless of geometry backend.

## 2. Authored scene graph

A future scene language could represent groups and objects as a tree:

```ts
type SceneNode = GroupNode | GeometryNode;

interface GroupNode {
    kind: 'group';
    name?: string;
    transform?: TransformDescription;
    children: SceneNode[];
}

type GeometryNode = SDFObject | AnalyticObject | MeshObject;

interface TransformDescription {
    position?: Vec3;
    rotation?: Quaternion;
    scale?: number | Vec3;
}
```

The public representation should be ergonomic. The compiler representation should be mathematical and canonical. Authored position, rotation, and scale values are therefore composed into affine matrices during planning.

The first implementation does not need to expose this tree immediately. The current flat `scene.objects` array can be lowered into the same internal representation with an identity parent transform. That establishes the backend contract before adding public group syntax.

## 3. Planned representation

The planner should flatten every geometry leaf into a shared object envelope:

```ts
interface PlannedObject {
    index: number;
    materialId: number;
    transform: PlannedTransform;
    geometry: PlannedGeometry;
}

type PlannedGeometry =
    | {
          backend: 'sdf';
          type: 'sphere' | 'plane' | 'box';
          parameters: Record<string, number | number[]>;
      }
    | {
          backend: 'analytic';
          type: 'sphere' | 'plane' | 'quad';
          parameters: Record<string, number | number[]>;
      }
    | {
          backend: 'mesh';
          meshId: string;
      };

interface PlannedTransform {
    localToWorld: Mat4;
    worldToLocal: Mat4;
    normalToWorld: Mat3;
}
```

`PlannedObject` unifies identity, material assignment, and transforms. The geometry payload remains a discriminated union because the backends still emit different intersection code.

Generators may partition the flat object list by `geometry.backend` when assembling the shader. A common planned representation does not require a common runtime intersection algorithm.

## 4. Flattening the hierarchy

With column vectors, a child transform composes as:

```text
childToWorld = parentToWorld * childToParent
```

The planner can recursively flatten the authored tree:

```ts
function flattenNode(
    node: SceneNode,
    parentToWorld: Mat4,
    output: PlannedObject[],
): void {
    const localToParent = composeTransform(node.transform);
    const localToWorld = multiply(parentToWorld, localToParent);

    if (node.kind === 'group') {
        for (const child of node.children) {
            flattenNode(child, localToWorld, output);
        }
        return;
    }

    output.push(planObject(node, localToWorld));
}
```

Group names, children, and parent pointers do not reach GLSL. They exist only in the authored scene and compiler diagnostics. Each leaf reaches code generation with one composed transform.

## 5. Why the compiler needs affine matrices

The public transform may be expressed as translation, rotation, and scale, but the internal representation should be a full affine matrix.

Even when every local node is authored as TRS, a parent with nonuniform scale followed by a rotated child can produce shear in the final world transform. An accumulated position/rotation/scale tuple cannot represent that result without loss.

The compiler needs three related matrices:

- `localToWorld` transforms local points into world space.
- `worldToLocal` transforms world queries into primitive-local space.
- `normalToWorld` is the inverse transpose of the linear local-to-world transform and correctly transforms surface normals under nonuniform scale.

Singular transforms, such as a zero scale component, have no inverse and must be rejected during validation.

## 6. Worked compound-object example

Assume a right-handed coordinate system where a positive 90-degree rotation about +Z maps +X to +Y. Local transforms compose as translation followed by rotation.

```ts
const scene = {
    kind: 'group',
    name: 'outer',
    transform: {
        position: [10, 0, 0],
        rotation: { axis: [0, 0, 1], angle: 90 },
    },
    children: [
        {
            kind: 'group',
            name: 'inner',
            transform: {
                position: [2, 0, 0],
                rotation: { axis: [0, 0, 1], angle: 90 },
            },
            children: [
                {
                    kind: 'analytic',
                    name: 'sphere',
                    transform: {
                        position: [0, 1, 0],
                    },
                    shape: {
                        type: 'sphere',
                        parameters: {
                            center: [1, 0, 0],
                            radius: 0.5,
                        },
                    },
                    material: 'glass',
                },
                {
                    kind: 'sdf',
                    name: 'box',
                    transform: {
                        position: [-1, 0, 0],
                        rotation: { axis: [0, 0, 1], angle: 90 },
                    },
                    sdf: {
                        type: 'box',
                        parameters: {
                            center: [0, 0, 0],
                            halfSize: [0.5, 1, 0.5],
                        },
                    },
                    material: 'red',
                },
            ],
        },
    ],
};
```

The hierarchy is:

```text
outer: translate [10,0,0], rotate 90 degrees
└── inner: translate [2,0,0], rotate 90 degrees
    ├── analytic sphere: translate [0,1,0]
    └── SDF box: translate [-1,0,0], rotate 90 degrees
```

### 6.1 Inner group

The inner group world transform is:

```text
M_inner = M_outer * T(2,0,0) * Rz(90 degrees)
```

The outer rotation maps the inner translation `[2,0,0]` to `[0,2,0]`. Consequently:

```text
inner world position = [10,2,0]
inner world rotation = 180 degrees
```

Its matrix is:

```text
[-1  0  0  10]
[ 0 -1  0   2]
[ 0  0  1   0]
[ 0  0  0   1]
```

### 6.2 Analytic sphere

The sphere's `[0,1,0]` object translation is rotated by the parent's 180-degree rotation:

```text
Rz(180 degrees) * [0,1,0] = [0,-1,0]
```

Its world-space object origin is therefore:

```text
[10,2,0] + [0,-1,0] = [10,1,0]
```

The final sphere object-to-world matrix is:

```text
[-1  0  0  10]
[ 0 -1  0   1]
[ 0  0  1   0]
[ 0  0  0   1]
```

Its inverse maps a world point to local space as:

```text
local.x = 10 - world.x
local.y =  1 - world.y
local.z =      world.z
```

The primitive-local sphere center remains `[1,0,0]`. Applying the object-to-world matrix places that center at `[9,1,0]` in world space.

### 6.3 SDF box

The box's `[-1,0,0]` translation is also transformed by the inner group's 180-degree rotation:

```text
Rz(180 degrees) * [-1,0,0] = [1,0,0]
```

Its world origin and rotation are:

```text
box world position = [11,2,0]
box world rotation = 270 degrees
```

The box object-to-world matrix is:

```text
[ 0  1  0  11]
[-1  0  0   2]
[ 0  0  1   0]
[ 0  0  0   1]
```

Its inverse maps a world point to local space as:

```text
local.x =  2 - world.y
local.y =      world.x - 11
local.z =      world.z
```

## 7. Analytic backend lowering

Analytic geometry should transform the ray into local space and intersect the unchanged local primitive.

The local ray direction must not be normalized. For an affine transform `A`:

```text
world ray: p(t) = origin + t * direction
local ray: A^-1 p(t) = A^-1 origin + t * A^-1 direction
```

The same `t` is preserved when the transformed direction remains unnormalized. Normalizing it would change the ray parameter and make comparisons against other world-space hits incorrect.

For the worked sphere, an optimized generated helper could be:

```glsl
bool intersect_analytic_sphere_0(
    Ray world_ray,
    out float t,
    out vec3 world_normal
) {
    Ray local_ray;

    local_ray.origin = vec3(
        10.0 - world_ray.origin.x,
         1.0 - world_ray.origin.y,
                 world_ray.origin.z
    );

    local_ray.direction = vec3(
        -world_ray.direction.x,
        -world_ray.direction.y,
         world_ray.direction.z
    );

    if (!ray_sphere(
        local_ray,
        vec3(1.0, 0.0, 0.0),
        0.5,
        t
    )) {
        return false;
    }

    vec3 local_hit =
        local_ray.origin + t * local_ray.direction;

    vec3 local_normal =
        normalize(local_hit - vec3(1.0, 0.0, 0.0));

    world_normal = normalize(vec3(
        -local_normal.x,
        -local_normal.y,
         local_normal.z
    ));

    return true;
}
```

The generated analytic dispatcher remains responsible for nearest-hit selection and world-space hit construction:

```glsl
bool analytic_intersect(Ray ray, inout Hit hit) {
    float t;
    vec3 normal;
    bool found = false;

    if (
        intersect_analytic_sphere_0(ray, t, normal)
        && t < hit.t
    ) {
        hit.t = t;
        hit.p = ambient_geodesic(
            ray.origin,
            ray.direction,
            t
        );
        hit.frame = ambient_frame(hit.p, normal);
        hit.region_owner = 0;
        found = true;
    }

    return found;
}
```

The parent groups do not appear in this GLSL. Their entire effect is contained in the final world-to-local and normal-to-world transforms.

## 8. SDF backend lowering

SDF geometry transforms the world-space query point into local space before evaluating the unchanged primitive.

For the worked box, a specialized generated wrapper could be:

```glsl
float sdf_object_1(vec3 world_p) {
    vec3 local_p = vec3(
         2.0 - world_p.y,
        world_p.x - 11.0,
        world_p.z
    );

    return sdf_box(
        local_p,
        vec3(0.0, 0.0, 0.0),
        vec3(0.5, 1.0, 0.5)
    );
}
```

Translation and rotation preserve distance, so no distance correction is required in this example. The scene marcher consumes the wrapper as a world-space field:

```glsl
float scene_march_bound(vec3 world_p, out int region) {
    float distance = 1.0e20;
    region = -1;

    float box_distance = abs(sdf_object_1(world_p));

    if (box_distance < distance) {
        distance = box_distance;
        region = 1;
    }

    return distance;
}
```

Finite-difference normals may continue to sample `sdf_object_1` in world space. Because the wrapper transforms every sample point into box-local space, the resulting world-space gradient follows the transformed box automatically.

## 9. General matrix lowering

Simple transforms should be constant-folded into direct arithmetic as shown above. More complicated affine transforms can use generated matrix constants and shared helpers:

```glsl
vec3 transform_point(mat4 m, vec3 p) {
    return (m * vec4(p, 1.0)).xyz;
}

vec3 transform_vector(mat4 m, vec3 v) {
    return (m * vec4(v, 0.0)).xyz;
}
```

An analytic object then begins with:

```glsl
Ray local_ray;
local_ray.origin = transform_point(
    OBJECT_0_WORLD_TO_LOCAL,
    world_ray.origin
);
local_ray.direction = transform_vector(
    OBJECT_0_WORLD_TO_LOCAL,
    world_ray.direction
);
```

An SDF object begins with:

```glsl
vec3 local_p = transform_point(
    OBJECT_1_WORLD_TO_LOCAL,
    world_p
);
```

The compiler can classify transforms and select the smallest lowering:

```ts
type TransformKind =
    | 'identity'
    | 'translation'
    | 'rigid'
    | 'uniform-scale'
    | 'affine';
```

- Identity emits no transform operations.
- Translation emits subtraction from the world query.
- Rigid transforms emit specialized rotation and translation arithmetic.
- Uniform scale additionally corrects SDF distance.
- General affine transforms use matrix operations and an explicitly designed SDF distance bound.

## 10. Scaling rules

### 10.1 Translation and rotation

Translation and rotation preserve Euclidean distance. Local SDF values can be returned unchanged.

### 10.2 Uniform scale

For uniform scale `s`, the world-space SDF is:

```glsl
float local_d = sdf_primitive(local_p);
float world_d = abs(s) * local_d;
```

Analytic objects need no special `t` correction when their rays are transformed affinely without direction normalization.

### 10.3 Nonuniform scale and shear

A nonuniformly transformed exact SDF is generally no longer an exact Euclidean distance field. A conservative world-space marching bound can be derived from a lower bound on the transform's singular values, but this may reduce marching efficiency and needs numerical witnesses.

The initial transform implementation should therefore support:

- translation;
- rotation;
- uniform scale.

Nonuniform SDF scale and shear should remain rejected until their bound, normal, containment, and convergence behavior are designed and tested. Analytic geometry and meshes can use general invertible affine transforms earlier because local-space ray intersection remains well-defined.

## 11. Mesh backend

Future meshes follow the analytic pattern:

1. Transform the world ray into mesh-local space.
2. Intersect the local mesh or BVH.
3. Preserve the unnormalized local ray direction so `t` remains comparable.
4. Transform the local normal with `normalToWorld`.

This allows one mesh acceleration structure to be instantiated under multiple transforms without duplicating vertices or rebuilding world-space geometry.

## 12. Compiler and GLSL responsibilities

The authored scene contains hierarchy and ergonomic transforms. The compiler:

1. validates each local transform;
2. composes parent and child matrices;
3. rejects singular or backend-incompatible transforms;
4. flattens groups into leaf objects;
5. computes inverse and normal matrices;
6. classifies transforms for specialization;
7. emits backend-specific local-space queries.

The final shader does not contain:

- group nodes;
- parent pointers;
- scene-graph traversal;
- runtime matrix composition;
- shape-specific translation conventions.

Its common flow is:

```text
world query
    -> compiled world-to-local transform
local primitive query
    -> backend-specific intersection or distance result
    -> normal-to-world transform where required
world hit
```

## 13. Relationship to the current implementation

Adopting this design would replace both current positioning representations:

- analytic translation would no longer be baked into sphere centers, quad corners, or plane offsets;
- SDF objects would no longer carry a translation-only field separate from other backends.

Both would instead carry the same planned transform. Existing translation and light-registration tests remain valuable, but they should assert final world-space behavior rather than the specific parameter-baking mechanism.

In particular, a samplable emissive analytic object must use the same planned object transform for intersection and light sampling. Light registration must not independently reconstruct an emitter position from the authored scene.

## 14. Proposed implementation stages

### Stage 1: shared internal transform contract

- Keep the public scene flat.
- Introduce `PlannedObject`, `PlannedGeometry`, and `PlannedTransform`.
- Lower identity and translation for both SDF and analytic backends.
- Remove backend-specific translation representations.
- Preserve existing generated behavior and correctness tests.

### Stage 2: rigid transforms

- Add rotation.
- Transform analytic rays into local space.
- Transform analytic normals back into world space.
- Transform SDF query points into local space.
- Add analytic/SDF cross-backend placement witnesses.

### Stage 3: uniform scale

- Add exact SDF distance correction.
- Verify hit `t`, normals, containment, and nested-region classification.

### Stage 4: public hierarchy

- Add group nodes to the scene description.
- Flatten groups during planning.
- Preserve node paths for diagnostics and provenance.

### Stage 5: general affine policy

- Decide how nonuniform scale and shear interact with SDF distance bounds.
- Add numerical and GPU witnesses before enabling them.

### Stage 6: meshes and instancing

- Reuse the same planned transform contract for mesh-local rays and normals.
- Allow shared mesh data to back multiple transformed instances.

## 15. Design decisions still open

The following choices should be settled before implementation:

1. Whether the public scene graph initially contains only geometry or also lights and cameras.
2. Whether authored rotations use quaternions only or also accept Euler-angle convenience syntax.
3. Whether the first planned transform stores full matrices immediately or uses a discriminated optimized representation with matrices as the general case.
4. Whether nonuniform SDF transforms are initially rejected or compiled using a conservative singular-value bound.
5. Whether the first scene graph is strictly a tree or supports referenced nodes and instancing as a directed acyclic graph.

The recommended starting boundary is intentionally smaller than the final scene language: build the shared internal object-transform contract first, then add hierarchy once every geometry backend consumes that contract correctly.
