# Recipe Cookbook
_Copy‑paste configurations for common tasks_

Each recipe uses module names from the templates/examples in these docs. Adjust names to your registry.

---

## 1) Preview — Interactive Sky + Sphere (fast)

```json
{
  "id": "preview-sphere",
  "name": "Preview (Sky + Sphere)",
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
    "camera.position": [0,1.5,5],
    "camera.target": [0,0,0],
    "camera.fov": 45,
    "material.lambert.albedo": [0.8,0.2,0.2]
  },
  "mode": "interactive"
}
```

**Use when**: quick iteration; no accumulation; sanity checks.

---

## 2) MIS Study — Direct + BSDF (balanced heuristic)

```json
{
  "id": "mis-study",
  "name": "MIS Study (Balance Heuristic)",
  "world": {
    "geometry": {"kind":"Geometry","name":"Euclidean"},
    "material": {"kind":"Material","name":"GGXDielectric"},
    "scene": {"kind":"Scene","name":"SDFScene"},
    "lights": {"kind":"Lights","name":"SkyEnv"}
  },
  "photography": {
    "camera": {"kind":"Camera","name":"Pinhole"},
    "estimator": {"kind":"Estimator","name":"PathTracerMIS"},
    "film": {"kind":"Film","name":"MeanVariance"},
    "developer": {"kind":"Developer","name":"ACES"}
  },
  "parameters": {
    "camera.position": [0,1,4],
    "camera.target": [0,0,0],
    "camera.fov": 50,
    "estimator.maxBounces": 6,
    "estimator.misHeuristic": "balance"
  },
  "mode": "progressive"
}
```

**Use when**: comparing MIS on/off and heuristic variants.

---

## 3) Glass-in-Fog — Layered Media Demo

```json
{
  "id": "glass-in-fog",
  "name": "Glass in Fog (Layered Media)",
  "world": {
    "geometry": {"kind":"Geometry","name":"Euclidean"},
    "material": {"kind":"Material","name":"Dielectric"},
    "scene": {"kind":"Scene","name":"LayeredStackScene"},
    "lights": {"kind":"Lights","name":"SkyEnv"}
  },
  "photography": {
    "camera": {"kind":"Camera","name":"Pinhole"},
    "estimator": {"kind":"Estimator","name":"SurfaceVolumePT"},
    "film": {"kind":"Film","name":"MeanVariance"},
    "developer": {"kind":"Developer","name":"ACES"}
  },
  "parameters": {
    "camera.position": [0,0.8,3],
    "camera.target": [0,0,0],
    "estimator.maxBounces": 8,
    "estimator.enableMedia": true,
    "scene.fog.sigma_t": 2.0,
    "scene.fog.albedo": [0.9,0.9,0.9]
  },
  "mode": "progressive"
}
```

**Use when**: validating the Layered Media Stack & medium transitions.

---

## 4) Variance‑Driven Progressive — Adaptive Sampling

```json
{
  "id": "variance-adaptive",
  "name": "Variance-Driven Adaptive",
  "world": {
    "geometry": {"kind":"Geometry","name":"Euclidean"},
    "material": {"kind":"Material","name":"Lambert"},
    "scene": {"kind":"Scene","name":"SDFScene"},
    "lights": {"kind":"Lights","name":"SkyEnv"}
  },
  "photography": {
    "camera": {"kind":"Camera","name":"Pinhole"},
    "estimator": {"kind":"Estimator","name":"PathTracer"},
    "film": {"kind":"Film","name":"MeanVariance"},
    "developer": {"kind":"Developer","name":"ACES"}
  },
  "parameters": {
    "estimator.maxBounces": 5,
    "film.adaptive.targetVariance": 0.0025,
    "film.adaptive.minSpp": 8,
    "film.adaptive.maxSpp": 256
  },
  "mode": "progressive"
}
```

**Use when**: you want auto‑stop based on variance across pixels.

---

## 5) Production Tiled 4K — Checkpointed

```json
{
  "id": "prod-4k-tiled",
  "name": "Production Tiled 4K (Checkpointed)",
  "world": {
    "geometry": {"kind":"Geometry","name":"Euclidean"},
    "material": {"kind":"Material","name":"MixedSceneMaterials"},
    "scene": {"kind":"Scene","name":"LargeSceneBVH"},
    "lights": {"kind":"Lights","name":"HDRIEnv"}
  },
  "photography": {
    "camera": {"kind":"Camera","name":"ThinLens"},
    "estimator": {"kind":"Estimator","name":"PathTracerMIS"},
    "film": {"kind":"Film","name":"MeanVariance"},
    "developer": {"kind":"Developer","name":"ACES"}
  },
  "parameters": {
    "camera.fov": 35,
    "camera.aperture": 4.0,
    "camera.focusDistance": 10.0,
    "estimator.maxBounces": 8
  },
  "mode": "production",
  "production": {
    "resolution": [3840, 2160],
    "tileSize": [256, 256],
    "samplesPerTile": 512,
    "checkpoint": {"enabled": true, "everyTiles": 8}
  }
}
```

**Use when**: rendering finals; supports resume from checkpoints.