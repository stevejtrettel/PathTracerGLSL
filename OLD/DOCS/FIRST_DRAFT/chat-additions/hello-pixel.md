# “Hello Pixel” — Minimal Working Example

A tiny end-to-end configuration that exercises the full pipeline with the simplest possible choices. This is deliberately minimal, meant to validate the wiring, not to be photorealistic.

---

## Goals

- Verify **App ↔ Engine ↔ Photography ↔ World** contracts end-to-end.
- Keep **Estimator** simple (direct-only), **Film** non-accumulating (or simple average), **Developer** identity/ACES.
- Use **one SDF sphere** scene in **Euclidean** geometry.
- Render a **sky gradient** when no hit occurs.

---

## File Tree (conceptual)

```
hello-pixel/
  recipe.json
  modules/
    geometry/euclidean.glsl
    scene/sdf_scene.glsl
    material/lambert.glsl
    lights/sky_env.glsl
    camera/pinhole.glsl
    estimator/direct_only.glsl
    film/simple_average.glsl
    developer/aces.glsl
```

You can place these descriptor snippets wherever your ModuleRegistry expects them.

---

## Recipe

```json
{
  "id": "hello-pixel",
  "name": "Hello Pixel",
  "version": "1.0.0",
  "world": {
    "geometry": {"kind":"Geometry","name":"Euclidean"},
    "material": {"kind":"Material","name":"Lambert"},
    "scene": {"kind":"Scene","name":"SDFScene"},
    "lights": {"kind":"Lights","name":"SkyEnv"}
  },
  "photography": {
    "camera": {"kind":"Camera","name":"Pinhole"},
    "estimator": {"kind":"Estimator","name":"DirectOnly"},
    "film": {"kind":"Film","name":"SimpleAverage"},
    "developer": {"kind":"Developer","name":"ACES"}
  },
  "parameters": {
    "camera.position": [0, 1, 5],
    "camera.target":   [0, 0, 0],
    "camera.fov": 45,
    "material.albedo": [0.8, 0.2, 0.2]
  }
}
```

---

## Module Contracts — Minimal GLSL Stubs

Below are intentionally tiny, **prefix-free** bodies; your compiler will add `g_/sc_/m_/l_/c_/e_/f_/d_` prefixes and wire calls per your pipeline.

### Geometry: Euclidean

```
struct Ray { vec3 o; vec3 d; };
vec3 geodesic(vec3 o, vec3 d, float t){ return o + t*d; }
float dot_metric(vec3 a, vec3 b){ return dot(a,b); }
mat3 parallel_transport(mat3 F, vec3 o, vec3 d, float t){ return F; }
mat3 frame(vec3 o, vec3 d){
  vec3 w = normalize(d);
  vec3 u = normalize(abs(w.y)<0.999 ? cross(vec3(0,1,0), w) : cross(vec3(1,0,0), w));
  vec3 v = cross(w,u);
  return mat3(u,v,w);
}
```

### Scene: Single SDF Sphere (+ plane), closest-hit via sphere tracing

```
float sdSphere(vec3 p, float r){ return length(p) - r; }
float sdPlane(vec3 p){ return p.y; }
float map(vec3 p){ return min(sdSphere(p-vec3(0,0,0),1.0), sdPlane(p)); }

bool intersect(in Ray ray, out vec3 p, out vec3 n, out int matId){
  float t=0.0;
  for(int i=0;i<128;i++){
    vec3 x = ray.o + t*ray.d;
    float d = map(x);
    if(d<1e-3){ p=x; n=normalize(vec3(
      map(x+vec3(1e-3,0,0))-map(x-vec3(1e-3,0,0)),
      map(x+vec3(0,1e-3,0))-map(x-vec3(0,1e-3,0)),
      map(x+vec3(0,0,1e-3))-map(x-vec3(0,0,1e-3))
    )); matId = (abs(sdPlane(x))<1e-3)?1:0; return true; }
    if(t>100.0) break;
    t += d;
  }
  return false;
}
```

### Material: Lambert (eval/sample/pdf triplet)

```
struct Sample { vec3 wi; vec3 f; float pdf; bool delta; };

vec3  m_eval(vec3 wo, vec3 n, vec3 wi, vec3 albedo){
  float cosI = max(0.0, dot(n, wi));
  return albedo * (1.0/3.14159265) * cosI;
}
float m_pdf(vec3 wo, vec3 n, vec3 wi){
  float cosI = max(0.0, dot(n, wi));
  return cosI > 0.0 ? cosI / 3.14159265 : 0.0;
}
Sample m_sample(vec3 wo, vec3 n, vec3 albedo, vec2 xi){
  // cosine-weighted hemisphere (Malley)
  float r = sqrt(xi.x), phi = 6.28318530718*xi.y;
  vec3 t = normalize(abs(n.y)<0.999? cross(vec3(0,1,0),n):cross(vec3(1,0,0),n));
  vec3 b = cross(n,t);
  vec3 wi = normalize(t*(r*cos(phi)) + b*(r*sin(phi)) + n*sqrt(max(0.0,1.0-xi.x)));
  float pdf = m_pdf(wo,n,wi);
  vec3  f   = m_eval(wo,n,wi,albedo);
  return Sample(wi,f,pdf,false);
}
```

### Lights: Sky environment (analytic gradient)

```
struct LightSample { vec3 wi; vec3 Le; float pdf; };
vec3 sky(vec3 d){
  float t = clamp(0.5*(d.y+1.0), 0.0, 1.0);
  return mix(vec3(0.7,0.8,1.0), vec3(0.1,0.2,0.4), 1.0 - t);
}
LightSample sample_light(vec3 p, vec2 xi){
  // Uniform dir; better: importance sample sky if desired
  float z = 1.0 - 2.0*xi.x;
  float r = sqrt(max(0.0,1.0 - z*z));
  float phi = 6.28318530718*xi.y;
  vec3 wi = normalize(vec3(r*cos(phi), z, r*sin(phi)));
  float pdf = 1.0 / (4.0*3.14159265);
  return LightSample(wi, sky(wi), pdf);
}
vec3 eval_light(vec3 p, vec3 wi){ return sky(wi); }
float pdf_light(vec3 p, vec3 wi){ return 1.0 / (4.0*3.14159265); }
```

### Camera: Pinhole

```
struct Camera { vec3 pos; mat3 frame; float tanFov; };
Ray generate_ray(vec2 pixel, vec2 xi){
  // Assume engine sets: u_camera.pos, u_camera.frame, u_camera.tanFov, u_resolution
  vec2 uv = (pixel + xi - 0.5) / u_resolution;  // simple AA jitter
  vec2 ndc = (uv * 2.0 - 1.0) * vec2(u_aspect, 1.0) * u_camera.tanFov;
  vec3 dCam = normalize(vec3(ndc, 1.0));
  vec3 dWorld = normalize(u_camera.frame * dCam);
  return Ray(u_camera.pos, dWorld);
}
```

### Estimator: Direct-only

```
vec3 e_estimate(Ray ray){
  vec3 L = vec3(0);
  vec3 p,n; int matId;
  if(!intersect(ray, p, n, matId)){
    L += eval_light(ray.o, ray.d);  // sky
    return L;
  }
  // NEE: one light sample
  vec2 xi = next_2d();
  LightSample ls = sample_light(p + 1e-3*n, xi);
  float cosI = max(0.0, dot(n, ls.wi));
  vec3  f = m_eval(-ray.d, n, ls.wi, u_material.albedo);
  float bsdfPdf = m_pdf(-ray.d, n, ls.wi);
  if(ls.pdf > 0.0 && bsdfPdf > 0.0 && cosI>0.0){
    // Shadow ignored for MVP; add occlusion for realism
    L += f * ls.Le * (cosI / ls.pdf);
  }
  return L;
}
```

### Film: Simple average (no variance)

```
vec3 f_accumulate(vec3 L, vec2 pixel){
  // If non-accumulating, just return L; if accumulating, read previous + incremental mean
  return L;
}
```

### Developer: ACES (or Identity)

```
vec3 rrt_and_odt_fit(vec3 v){
  // Approximate ACES tone map (classic Narkowicz)
  const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((v*(a*v+b))/(v*(c*v+d)+e), 0.0, 1.0);
}
vec3 develop(vec3 HDR){ return rrt_and_odt_fit(HDR); }
```

---

## Engine Expectations (wire-up hints)

- **Uniforms**: the Engine provides `u_resolution`, `u_aspect`, `u_frame_index`, `u_sample_count`, and camera uniforms (`u_camera.pos`, `u_camera.frame`, `u_camera.tanFov`).  
- **Prefixing**: the compiler will prefix functions by kind and resolve cross‑module calls.  
- **Manifest**: Film declares whether it needs persistent textures (this MVP doesn’t).

---

## First Image Checklist

- Compile recipe → program OK.  
- Ensure camera frame/pos uniforms are set.  
- See a sky gradient if nothing is hit.  
- See a red-ish sphere/ground lit by the sky when intersecting.  
- Toggle interactive vs progressive to test accumulation wiring.