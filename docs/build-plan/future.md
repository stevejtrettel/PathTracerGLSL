# FUTURE


## Acceleration Structures

### Overview

As scene complexity grows beyond simple test cases, acceleration structures become critical for performance. The Scene module will internally leverage different acceleration strategies while maintaining its clean `sc_intersect()` interface. This allows for sophisticated spatial culling without breaking the module abstraction.

### Hybrid Acceleration Architecture

Given that scenes will contain both SDFs and meshes, we need a unified acceleration strategy that handles both efficiently:

```
Top-Level BVH (all objects)
    ├── Mesh Objects → Triangle BVH
    ├── SDF Objects → Sparse Voxel Octree
    └── Compound Objects → Hierarchical Bounds
```

### Implementation Strategy

#### 1. Build-Time Structure Generation

The Scene module compiler will analyze objects and generate specialized traversal code:

```typescript
// Scene descriptor with acceleration hints
{
  acceleration: {
    strategy: "hybrid",
    bvhMaxDepth: 32,
    sdfVoxelResolution: 128,
    dynamicRebuild: false
  },
  objects: [
    {
      type: "mesh",
      path: "models/teapot.obj",
      accelerationHint: "static",
      triangleCount: 5000  // Triggers BVH build
    },
    {
      type: "sdf",
      function: "mandelbulb",
      accelerationHint: "hierarchical",
      boundingBox: [[-2,-2,-2], [2,2,2]]
    }
  ]
}
```

#### 2. GPU Memory Layout

Since WebGL2 lacks buffer pointers, we'll pack acceleration structures into textures:

```glsl
// BVH Node Layout (2 texels per node)
// Texel 0: min.xyz, left_child
// Texel 1: max.xyz, right_child (negative = leaf)
uniform sampler2D u_scene_bvh_nodes;
uniform sampler2D u_scene_bvh_leaves;  // Triangle indices

// SDF Acceleration Grid
uniform sampler3D u_scene_sdf_distance_grid;  // Distance bounds
uniform sampler3D u_scene_sdf_validity_mask;   // Valid regions

// Stack for traversal (register array)
int stack[32];  // Tunable based on depth
int stack_ptr = 0;
```

#### 3. Unified Traversal Function

The Scene module generates a traversal function that handles all object types:

```glsl
bool sc_intersect(Ray ray, out Hit hit) {
    float nearest_t = 1e10;
    bool any_hit = false;
    
    // Initialize traversal stack with root
    stack[0] = 0;
    stack_ptr = 1;
    
    while(stack_ptr > 0) {
        int node_idx = stack[--stack_ptr];
        
        // Fetch node from texture
        vec4 node0 = texelFetch(u_scene_bvh_nodes, ivec2(node_idx*2, 0), 0);
        vec4 node1 = texelFetch(u_scene_bvh_nodes, ivec2(node_idx*2+1, 0), 0);
        
        // Early out if beyond current nearest
        if(!ray_box_intersect(ray, node0.xyz, node1.xyz, nearest_t))
            continue;
            
        int left = int(node0.w);
        int right = int(node1.w);
        
        if(left < 0) {  // Leaf node
            int object_id = -left - 1;
            
            // Dispatch based on object type
            if(object_types[object_id] == TYPE_MESH) {
                if(intersect_mesh_bvh(object_id, ray, hit, nearest_t)) {
                    nearest_t = hit.t;
                    any_hit = true;
                }
            } else if(object_types[object_id] == TYPE_SDF) {
                if(march_sdf_accelerated(object_id, ray, hit, nearest_t)) {
                    nearest_t = hit.t;
                    any_hit = true;
                }
            }
        } else {  // Internal node
            // Order children by ray direction
            if(ray.d[split_axis[node_idx]] > 0.0) {
                stack[stack_ptr++] = right;
                stack[stack_ptr++] = left;
            } else {
                stack[stack_ptr++] = left;
                stack[stack_ptr++] = right;
            }
        }
    }
    
    return any_hit;
}
```

#### 4. SDF-Specific Acceleration

For SDFs, we'll use a sparse voxel octree with distance bounds:

```glsl
bool march_sdf_accelerated(int obj_id, Ray ray, out Hit hit, float max_t) {
    float t = 0.0;
    
    // Skip empty space using voxel grid
    vec3 p = g_geodesic(ray.o, ray.d, t);
    float grid_dist = texture(u_scene_sdf_distance_grid, p * 0.5 + 0.5).r;
    t += max(grid_dist - EPSILON, MIN_STEP);
    
    // Enhanced sphere tracing
    for(int i = 0; i < MAX_STEPS; i++) {
        p = g_geodesic(ray.o, ray.d, t);
        
        // Evaluate actual SDF
        float d = evaluate_sdf(obj_id, p);
        
        if(d < EPSILON) {
            populate_sdf_hit(hit, obj_id, p, t);
            return t < max_t;
        }
        
        // Adaptive stepping with safety
        float grid_bound = texture(u_scene_sdf_distance_grid, p * 0.5 + 0.5).r;
        t += min(d, grid_bound) * 0.9;  // Conservative factor
        
        if(t > max_t) break;
    }
    return false;
}
```

#### 5. Non-Euclidean Considerations

Acceleration structures in curved spaces require special handling:

```glsl
// Geodesic segment approximation for BVH traversal
bool curved_ray_box_test(Ray ray, vec3 box_min, vec3 box_max, float max_t) {
    // Subdivide geodesic into segments
    const int SEGMENTS = 4;
    float dt = max_t / float(SEGMENTS);
    
    for(int i = 0; i < SEGMENTS; i++) {
        vec3 p0 = g_geodesic(ray.o, ray.d, dt * float(i));
        vec3 p1 = g_geodesic(ray.o, ray.d, dt * float(i+1));
        
        // Conservative line-box test for segment
        if(segment_box_intersect(p0, p1, box_min, box_max))
            return true;
    }
    return false;
}
```

### Build Pipeline Integration

The acceleration structure build happens at compile time:

1. **JavaScript Preprocessing**: Build BVH from mesh/SDF bounds
2. **Texture Generation**: Pack nodes into RGBA float textures
3. **Shader Generation**: Create specialized traversal code
4. **Upload to GPU**: Transfer textures with acceleration data

### Performance Targets

- **Simple scenes** (10-100 objects): 60+ fps at 1080p
- **Complex scenes** (1000+ objects): 30+ fps at 1080p
- **Hero scenes** (100k+ triangles): 10+ fps at 1080p

### Future WebGPU Migration

When WebGPU becomes available, we can enhance with:
- Storage buffers for pointer-like BVH traversal
- Compute shaders for GPU-side BVH builds
- Persistent threads for wavefront path tracing
- Hardware ray tracing (when available)

### Implementation Priority

This is a **Phase 2** feature - after basic rendering works but before production complexity. The implementation order:

1. Simple BVH for meshes (stackless traversal)
2. Distance field caching for SDFs
3. Unified hybrid traversal
4. Dynamic scene updates (Phase 3)
