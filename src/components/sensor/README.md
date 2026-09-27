# sensor/ — measurement response

**Taxonomy:** measurement. **Kind:** pick-one.

The implemented RGB interface is:

```glsl
Spectrum sensor_response(vec2 film, Direction ray_dir);
```

`film` is the normalized film position consumed by the camera; `ray_dir` is its primary
direction. The ideal RGB sensor returns `SPECTRUM_ONE`.

The colour model's `color_to_pixel` applies this response to traced radiance before the
accumulator updates its mean or variance. RGB uses component-wise multiplication. Display
transforms remain downstream.

The sensor owns the measurement response, including spectral response curves. The colour
model owns the representation and wavelength integration. Spectral sensors will provide
responses at sampled wavelengths; that interface and colour-model compatibility validation
are not implemented yet. Sensor selection arrives with the second occupant.

The compiler includes the sole ideal occupant through `core.ts`, before the colour projection
that calls it. Exposure, vignetting and spectral sensor occupants remain deferred.
